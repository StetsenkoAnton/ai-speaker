import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@ai-speaker/protocol';
import { parseBrief, parseScript, parseSlides, type Talk } from '@ai-speaker/talk-format';
import { durationMs, parseWav, silenceWav } from '@ai-speaker/providers/audio';
import type { VoiceProvider } from '@ai-speaker/providers';
import { startLiveServer, type LiveServer } from './live-server.ts';
import { cacheStatus, renderItems, type VoiceSettings } from './audio-cache.ts';

const talk: Talk = {
  dir: '',
  brief: parseBrief('---\ntitle: Demo\nlang: en\n---\n').value,
  outline: '',
  slides: parseSlides('---\nid: intro\n---\n# Hello\n\n---\nid: code\n---\n# Code\n').value,
  script: parseScript('## intro\nhi\n## code\ncode\n').value,
  knowledge: [],
  pronunciation: [],
  phrases: { closing: ['Questions?'] },
};

let server: LiveServer | undefined;
beforeEach(async () => {
  talk.dir = await mkdtemp(join(tmpdir(), 'ai-speaker-live-'));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(talk.dir, { recursive: true, force: true });
});

const voice: VoiceSettings = { provider: 'fake', voiceId: 'me', model: 'm', lang: 'en' };
const fake: VoiceProvider = {
  id: 'fake',
  languages: 'any',
  cloneVoice: async () => ({ provider: 'fake', voiceId: 'x', lang: 'en' }),
  listVoices: async () => [],
  deleteVoice: async () => {},
  synthesize: async () => {
    const data = silenceWav(200);
    return { data, mimeType: 'audio/wav', durationMs: durationMs(parseWav(data)) };
  },
};

/** Collects messages from one connection; `next(type)` waits for the next message of a type. */
async function connect(port: number, role: 'stage' | 'control', origin = 'http://localhost:3030') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    if (m.type === 'speaker' || m.type === 'player') return;
    inbox.push(m);
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', role }));
  const next = async <T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> => {
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  return { ws, next, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('live server', () => {
  it('syncs Control commands to the Stage', async () => {
    server = await startLiveServer(talk, { port: 0 });
    const stage = await connect(server.port, 'stage');
    expect((await stage.next('go_to_slide')).slideId).toBe('intro');
    const control = await connect(server.port, 'control', 'http://localhost:5173');
    const first = await control.next('snapshot');
    expect(first.snapshot.state).toBe('ready');
    expect(first.snapshot.talk.slides.map((s) => s.title)).toEqual(['Hello', 'Code']);

    control.send({ type: 'command', command: { type: 'start' } });
    control.send({ type: 'command', command: { type: 'next_slide' } });
    expect(await stage.next('go_to_slide')).toEqual({ type: 'go_to_slide', slideId: 'code', index: 1 });
    let snap = await control.next('snapshot');
    while (snap.snapshot.slideIndex !== 1) snap = await control.next('snapshot');
    expect(snap.snapshot).toMatchObject({ state: 'presenting', slideIndex: 1, stages: 1 });

    control.send({ type: 'command', command: { type: 'next_slide' } });
    expect((await control.next('error')).message).toBe('No such slide');
  });

  it('follows navigation made on the Stage', async () => {
    server = await startLiveServer(talk, { port: 0 });
    const stage = await connect(server.port, 'stage');
    await stage.next('go_to_slide');
    stage.send({ type: 'stage_slide', index: 1 });
    await expect.poll(() => server?.presentation.slideIndex).toBe(1);
  });

  it('refuses foreign origins', async () => {
    server = await startLiveServer(talk, { port: 0 });
    await expect(connect(server.port, 'control', 'https://evil.example')).rejects.toThrow();
  });

  it('plays rendered audio in the first Control window and moves on when it ends', async () => {
    await renderItems(talk, fake, voice, (await cacheStatus(talk, voice)).items);
    server = await startLiveServer(talk, { port: 0, voice, gapMs: 10 });
    const stage = await connect(server.port, 'stage');
    await stage.next('go_to_slide');
    const control = await connect(server.port, 'control', 'http://localhost:5173');
    const snap = await control.next('snapshot');
    expect(snap.snapshot.audio).toEqual({ slides: ['intro', 'code'], missing: [], closing: 1 });

    control.send({ type: 'command', command: { type: 'start' } });
    const play = await control.next('play');
    expect(play).toMatchObject({ kind: 'slide', slideId: 'intro' });
    const res = await fetch(`http://127.0.0.1:${server.port}${play.url}`);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(durationMs(parseWav(new Uint8Array(await res.arrayBuffer())))).toBe(200);

    control.send({ type: 'audio_ended', token: play.token });
    expect((await stage.next('go_to_slide')).slideId).toBe('code');
    const second = await control.next('play');
    control.send({ type: 'audio_ended', token: second.token });
    const closing = await control.next('play');
    expect(closing.kind).toBe('closing');
    control.send({ type: 'audio_ended', token: closing.token });
    await expect.poll(() => server?.presentation.state).toBe('qa');
  });

  it('refuses unknown audio files', async () => {
    server = await startLiveServer(talk, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/audio/${'0'.repeat(32)}.wav`);
    expect(res.status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/audio/..%2F..%2Fetc.wav`)).status).toBe(404);
  });
});
