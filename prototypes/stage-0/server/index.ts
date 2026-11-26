// Local server for the stage-0 prototype. Holds the Inworld key; the browser gets
// only a short-lived session token (for Realtime) and synthesized audio (for TTS).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { InworldError, configStatus, mintSessionToken, synthesize, voiceId } from './inworld.ts';

const PORT = Number(process.env.SERVER_PORT ?? 8787);
const HOST = '127.0.0.1';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new InworldError('Request body too large', 413);
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InworldError('Body is not valid JSON', 400);
  }
}

// Only same-machine pages may call us: the Vite proxy forwards from localhost.
function isLocalOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  try {
    if (!isLocalOrigin(req)) return send(res, 403, { error: 'Forbidden origin' });

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, config: configStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/realtime-token') {
      const { token, expirationTime } = await mintSessionToken();
      // The voice id is not a secret credential, but it stays out of git; the page needs it
      // for session.update, so it travels together with the token over localhost only.
      return send(res, 200, { token, expirationTime, voiceId: voiceId() });
    }

    if (req.method === 'POST' && url.pathname === '/api/tts') {
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text : '';
      const result = await synthesize(text);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
        'X-Characters': String(result.characters),
        'X-Synthesis-Ms': String(result.ms),
      });
      return res.end(result.wav);
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof InworldError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${req.method} ${url.pathname}]`, message);
    send(res, status >= 400 && status < 600 ? status : 502, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  const c = configStatus();
  console.log(`stage-0 server on http://${HOST}:${PORT}`);
  console.log(`  INWORLD_API_KEY: ${c.apiKey ? 'set' : 'MISSING'}, INWORLD_VOICE_ID: ${c.voiceId ? 'set' : 'MISSING'}, TTS model: ${c.ttsModel}`);
});
