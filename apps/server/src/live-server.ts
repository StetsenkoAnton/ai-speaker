// Local server for a talk: HTTP health endpoint plus one WebSocket that the Stage and
// Control windows share. The server owns the presentation state; windows only send commands.
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH, type ClientMessage, type ServerMessage, type SlideRef } from '@ai-speaker/protocol';
import type { Slide, Talk } from '@ai-speaker/talk-format';
import { HttpError, isLocalOrigin, sendJson } from './http.ts';
import { Presentation } from './presentation.ts';

export interface LiveServer {
  readonly port: number;
  readonly presentation: Presentation;
  close(): Promise<void>;
}

/** Slide title for the Control window: frontmatter `title`, else the first heading. */
export function slideTitle(slide: Slide): string {
  if (typeof slide.frontmatter.title === 'string' && slide.index > 0) return slide.frontmatter.title;
  const heading = /^#{1,6}\s+(.+)$/m.exec(slide.markdown);
  return heading?.[1]?.trim() ?? slide.id;
}

export function slideRefs(talk: Talk): SlideRef[] {
  return talk.slides.map((s) => ({ id: s.id, index: s.index, title: slideTitle(s) }));
}

interface Client {
  ws: WebSocket;
  role?: 'stage' | 'control';
}

export async function startLiveServer(
  talk: Talk,
  options: { port: number; host?: string; stageUrl?: string },
): Promise<LiveServer> {
  const host = options.host ?? '127.0.0.1';
  const presentation = new Presentation({ title: talk.brief.title, lang: talk.brief.lang, slides: slideRefs(talk) });
  presentation.markReady();
  const clients = new Set<Client>();

  const stageCount = () => [...clients].filter((c) => c.role === 'stage').length;
  const snapshot = () => ({ ...presentation.snapshot(stageCount()), ...(options.stageUrl ? { stageUrl: options.stageUrl } : {}) });
  const send = (client: Client, message: ServerMessage) => {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage, except?: Client) => {
    for (const c of clients) if (c !== except && c.role) send(c, message);
  };
  const broadcastSnapshot = () => broadcast({ type: 'snapshot', snapshot: snapshot() });
  const broadcastSlide = (except?: Client) => {
    const slide = presentation.currentSlide;
    if (!slide) return;
    for (const c of clients) if (c !== except && c.role === 'stage') send(c, { type: 'go_to_slide', slideId: slide.id, index: slide.index });
  };

  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (!isLocalOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'Forbidden origin' });
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, talk: talk.brief.title, state: presentation.state });
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        return sendJson(res, 200, snapshot());
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  const wss = new WebSocketServer({
    server: http,
    path: WS_PATH,
    maxPayload: 64 * 1024,
    verifyClient: ({ origin }: { origin: string }) => isLocalOrigin(origin),
  });

  // Listen errors (a busy port) are reported by the HTTP server below; the WebSocket server
  // re-emits them, and an unhandled 'error' event would crash the process.
  wss.on('error', () => {});

  wss.on('connection', (ws) => {
    const client: Client = { ws };
    clients.add(client);
    ws.on('message', (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return send(client, { type: 'error', message: 'Message is not valid JSON' });
      }
      if (message.type === 'hello') {
        client.role = message.role;
        send(client, { type: 'snapshot', snapshot: snapshot() });
        if (client.role === 'stage' && presentation.currentSlide) {
          send(client, { type: 'go_to_slide', slideId: presentation.currentSlide.id, index: presentation.currentSlide.index });
        }
        return broadcastSnapshot();
      }
      if (!client.role) return send(client, { type: 'error', message: 'Say hello first' });
      if (message.type === 'command') {
        const result = presentation.apply(message.command);
        if (!result.ok) return send(client, { type: 'error', message: result.error });
        if (result.slideChanged) broadcastSlide();
        return broadcastSnapshot();
      }
      if (message.type === 'stage_slide' && client.role === 'stage') {
        const result = presentation.followStage(message.index);
        if (result.ok && result.slideChanged) {
          broadcastSlide(client);
          broadcastSnapshot();
        }
      }
    });
    ws.on('close', () => {
      clients.delete(client);
      if (client.role === 'stage') broadcastSnapshot();
    });
  });

  // Stage 1 has no audio yet: drive the speaker layer with a synthetic level so the layer
  // can be checked. Stage 2 replaces this with the real output level of the player.
  const started = Date.now();
  const speakerTimer = setInterval(() => {
    const t = (Date.now() - started) / 1000;
    const activity = presentation.state === 'presenting' ? 'speaking' : presentation.state === 'qa' ? 'listening' : 'idle';
    const level = activity === 'speaking' ? Math.abs(Math.sin(t * 7) * Math.sin(t * 2.3)) : 0;
    presentation.speaker = { activity, level };
    broadcast({ type: 'speaker', activity, level });
  }, 100);

  await new Promise<void>((resolve, reject) => {
    http.once('error', (err: NodeJS.ErrnoException) => {
      clearInterval(speakerTimer);
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${options.port} is busy (is another AI Speaker or the stage-0 prototype running?). Stop it or set SERVER_PORT.`)
          : err,
      );
    });
    http.listen(options.port, host, () => resolve());
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    port,
    presentation,
    close: async () => {
      clearInterval(speakerTimer);
      for (const c of clients) c.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
