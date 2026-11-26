import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@ai-speaker/protocol';
import { parseBrief, parseScript, parseSlides, type Talk } from '@ai-speaker/talk-format';
import { startLiveServer, type LiveServer } from './live-server.ts';

const talk: Talk = {
  dir: '/tmp/demo',
  brief: parseBrief('---\ntitle: Demo\nlang: en\n---\n').value,
  outline: '',
  slides: parseSlides('---\nid: intro\n---\n# Hello\n\n---\nid: code\n---\n# Code\n').value,
  script: parseScript('## intro\nhi\n## code\ncode\n').value,
  knowledge: [],
};

let server: LiveServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Collects messages from one connection; `next(type)` waits for the next message of a type. */
async function connect(port: number, role: 'stage' | 'control', origin = 'http://localhost:3030') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    if (m.type === 'speaker') return;
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
});
