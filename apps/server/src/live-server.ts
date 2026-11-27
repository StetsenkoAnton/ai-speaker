// Local server for a talk: HTTP (health, snapshot, rendered audio) plus one WebSocket that the
// Stage and Control windows share. The server owns the presentation; windows send commands,
// and the first Control window plays the audio.
import { createReadStream, existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH, type AudioStatus, type ClientMessage, type ServerMessage, type SlideRef, type Snapshot } from '@ai-speaker/protocol';
import type { Slide, Talk } from '@ai-speaker/talk-format';
import { HttpError, isLocalOrigin, sendJson } from './http.ts';
import { Presentation } from './presentation.ts';
import { Conductor, type AudioClipRef } from './conductor.ts';
import { audioPath, cacheDir, cacheStatus, type VoiceSettings } from './audio-cache.ts';
import { handleSetup } from './setup-routes.ts';

export interface LiveServer {
  readonly port: number;
  readonly presentation: Presentation;
  /** Re-read the audio cache, for example after `render`. Also runs when the cache changes. */
  reloadAudio(): Promise<void>;
  close(): Promise<void>;
}

export interface LiveServerOptions {
  port: number;
  host?: string;
  /** Audience view URL, for links in the Control window. */
  stageUrl?: string;
  /** Current voice; without it the server plays whatever the cache was rendered with. */
  voice?: VoiceSettings;
  /** Pause between slides, in ms. */
  gapMs?: number;
  /** .env path for /setup; without it the setup routes are off. */
  envPath?: string;
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
  since: number;
}

const AUDIO_URL = /^\/api\/audio\/([0-9a-f]{32})\.wav$/;

export async function startLiveServer(talk: Talk, options: LiveServerOptions): Promise<LiveServer> {
  const host = options.host ?? '127.0.0.1';
  const presentation = new Presentation({ title: talk.brief.title, lang: talk.brief.lang, slides: slideRefs(talk) });
  presentation.markReady();
  const clients = new Set<Client>();
  let player: Client | undefined;

  // ---- audio cache ----
  let slideAudio = new Map<string, AudioClipRef>();
  let closingAudio: AudioClipRef[] = [];
  let audioStatus: AudioStatus = { slides: [], missing: [], closing: 0 };
  const knownHashes = new Set<string>();
  const sectionChars = new Map(talk.script.map((s) => [s.slideId, s.text.length]));

  async function reloadAudio() {
    const { items } = await cacheStatus(talk, options.voice);
    const slides = new Map<string, AudioClipRef>();
    const closing: AudioClipRef[] = [];
    const missing: string[] = [];
    knownHashes.clear();
    for (const s of items) {
      if (s.state !== 'cached') {
        if (s.item.slideId) missing.push(s.item.slideId);
        continue;
      }
      knownHashes.add(s.hash);
      const ref = { url: `/api/audio/${s.hash}.wav`, durationMs: s.entry.durationMs };
      if (s.item.slideId) slides.set(s.item.slideId, ref);
      else closing.push(ref);
    }
    slideAudio = slides;
    closingAudio = closing;
    audioStatus = { slides: [...slides.keys()], missing, closing: closing.length };
    broadcastSnapshot();
  }

  // ---- messaging ----
  const stageCount = () => [...clients].filter((c) => c.role === 'stage').length;
  const snapshot = (): Snapshot => ({
    ...presentation.snapshot(stageCount()),
    audio: audioStatus,
    player: Boolean(player),
    ...(conductor?.playing ? { playing: conductor.playing } : {}),
    ...(options.stageUrl ? { stageUrl: options.stageUrl } : {}),
  });
  const send = (client: Client, message: ServerMessage) => {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage, role?: Client['role'], except?: Client) => {
    for (const c of clients) if (c !== except && c.role && (!role || c.role === role)) send(c, message);
  };
  function broadcastSnapshot() {
    broadcast({ type: 'snapshot', snapshot: snapshot() });
  }
  const broadcastSlide = (except?: Client) => {
    const slide = presentation.currentSlide;
    if (slide) broadcast({ type: 'go_to_slide', slideId: slide.id, index: slide.index }, 'stage', except);
  };
  const speaker = (level = 0) => {
    const activity = conductor.playing ? 'speaking' : presentation.state === 'qa' ? 'listening' : 'idle';
    presentation.speaker = { activity, level: activity === 'speaking' ? level : 0 };
    broadcast({ type: 'speaker', ...presentation.speaker }, 'stage');
  };

  const conductor: Conductor = new Conductor({
    presentation,
    slideAudio: (id) => slideAudio.get(id),
    closingAudio: () => closingAudio,
    slideChars: (id) => sectionChars.get(id) ?? 0,
    toPlayer: (message) => player && send(player, message),
    changed: (slideChanged) => {
      if (slideChanged) broadcastSlide();
      broadcastSnapshot();
      speaker();
    },
    gapMs: options.gapMs,
  });

  /** The oldest Control window plays. When it closes, the next one takes over. */
  function choosePlayer() {
    const next = [...clients].filter((c) => c.role === 'control').sort((a, b) => a.since - b.since)[0];
    if (next === player) return;
    if (player) send(player, { type: 'player', active: false });
    player = next;
    if (player) send(player, { type: 'player', active: true });
    conductor.playerChanged();
    broadcastSnapshot();
  }

  // ---- HTTP ----
  const http: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (!isLocalOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'Forbidden origin' });
      if (options.envPath && (await handleSetup(req, res, url, { envPath: options.envPath }))) return;
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, talk: talk.brief.title, state: presentation.state });
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') return sendJson(res, 200, snapshot());
      const audio = AUDIO_URL.exec(url.pathname);
      if (req.method === 'GET' && audio) {
        const hash = audio[1]!;
        const path = audioPath(talk, hash);
        if (!knownHashes.has(hash) || !existsSync(path)) return sendJson(res, 404, { error: 'No such audio' });
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=31536000, immutable' });
        createReadStream(path).pipe(res);
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- WebSocket ----
  const wss = new WebSocketServer({
    server: http,
    path: WS_PATH,
    maxPayload: 64 * 1024,
    verifyClient: ({ origin }: { origin: string }) => isLocalOrigin(origin),
  });
  // Listen errors (a busy port) are reported by the HTTP server below; the WebSocket server
  // re-emits them, and an unhandled 'error' event would crash the process.
  wss.on('error', () => {});

  let seq = 0;
  wss.on('connection', (ws) => {
    const client: Client = { ws, since: ++seq };
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
        if (client.role === 'control') {
          send(client, { type: 'player', active: false });
          choosePlayer();
        }
        return broadcastSnapshot();
      }
      if (!client.role) return send(client, { type: 'error', message: 'Say hello first' });
      switch (message.type) {
        case 'command': {
          const result = conductor.command(message.command);
          if (!result.ok) send(client, { type: 'error', message: result.error });
          return;
        }
        case 'stage_slide':
          if (client.role === 'stage') conductor.followStage(message.index);
          return;
        case 'audio_ended':
          if (client === player) conductor.audioEnded(message.token);
          return;
        case 'audio_failed':
          if (client === player) {
            broadcast({ type: 'error', message: `Audio failed: ${message.message}` }, 'control');
            conductor.audioFailed(message.token);
          }
          return;
        case 'level':
          if (client === player && conductor.playing) speaker(Math.max(0, Math.min(1, message.level)));
          return;
      }
    });
    ws.on('close', () => {
      clients.delete(client);
      if (client === player) {
        player = undefined;
        choosePlayer();
      }
      broadcastSnapshot();
    });
  });

  // ---- cache watcher: pick up `render` while the server runs ----
  await mkdir(cacheDir(talk), { recursive: true });
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const watcher: FSWatcher = watch(cacheDir(talk), () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reloadAudio(), 300);
  });
  await reloadAudio();

  await new Promise<void>((resolve, reject) => {
    http.once('error', (err: NodeJS.ErrnoException) => {
      watcher.close();
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
    reloadAudio,
    close: async () => {
      conductor.dispose();
      clearTimeout(reloadTimer);
      watcher.close();
      for (const c of clients) c.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
