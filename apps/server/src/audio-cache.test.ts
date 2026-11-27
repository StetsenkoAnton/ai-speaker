import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTalk, type Talk } from '@ai-speaker/talk-format';
import { durationMs, parseWav, silenceWav } from '@ai-speaker/providers/audio';
import type { AudioClip, VoiceProvider } from '@ai-speaker/providers';
import { cacheStatus, renderItems, speechItems, type VoiceSettings } from './audio-cache.ts';

const voice: VoiceSettings = { provider: 'fake', voiceId: 'me', model: 'm1', lang: 'en' };

/** Records what it was asked to say; each clip lasts 10 ms per character. */
function fakeProvider(said: string[]): VoiceProvider {
  return {
    id: 'fake',
    languages: 'any',
    cloneVoice: async () => ({ provider: 'fake', voiceId: 'x', lang: 'en' }),
    listVoices: async () => [],
    deleteVoice: async () => {},
    synthesize: async ({ text }): Promise<AudioClip> => {
      said.push(text);
      const data = silenceWav(text.length * 10);
      return { data, mimeType: 'audio/wav', durationMs: durationMs(parseWav(data)) };
    },
  };
}

let dir: string;
async function write(files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
}
async function talk(): Promise<Talk> {
  return (await loadTalk(dir)).value;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-speaker-'));
  await write({
    'brief.md': '---\ntitle: T\nlang: en\n---\n',
    'slides.md': '---\nid: a\n---\n# A\n\n---\nid: b\n---\n# B\n',
    'script.md': '## a\nHello Vite.\n## b\nBye.\n',
    'pronunciation.yaml': 'Vite: veet\n',
    'phrases.yaml': 'closing:\n  - Questions?\n',
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('audio cache', () => {
  it('lists slide sections and closing phrases after the pronunciation dictionary', async () => {
    expect(speechItems(await talk())).toEqual([
      { key: 'slide:a', kind: 'slide', slideId: 'a', text: 'Hello veet.' },
      { key: 'slide:b', kind: 'slide', slideId: 'b', text: 'Bye.' },
      { key: 'closing:0', kind: 'closing', text: 'Questions?' },
    ]);
  });

  it('renders what is missing and nothing else on the next run', async () => {
    const said: string[] = [];
    const provider = fakeProvider(said);
    let status = await cacheStatus(await talk(), voice);
    expect(status.items.map((s) => s.state)).toEqual(['missing', 'missing', 'missing']);
    await renderItems(await talk(), provider, voice, status.items);
    expect(said).toEqual(['Hello veet.', 'Bye.', 'Questions?']);

    status = await cacheStatus(await talk(), voice);
    expect(status.items.every((s) => s.state === 'cached')).toBe(true);
    const first = status.items[0]!;
    expect(first.state === 'cached' && first.entry.durationMs).toBe(110);

    await write({ 'script.md': '## a\nHello Vite.\n## b\nSee you.\n' });
    status = await cacheStatus(await talk(), voice);
    expect(status.items.map((s) => s.state)).toEqual(['cached', 'missing', 'cached']);
  });

  it('treats another voice as a full re-render and presents from the cache without a voice', async () => {
    const t = await talk();
    await renderItems(t, fakeProvider([]), voice, (await cacheStatus(t, voice)).items);
    expect((await cacheStatus(t, { ...voice, voiceId: 'other' })).items.every((s) => s.state === 'missing')).toBe(true);
    const fromCache = await cacheStatus(t);
    expect(fromCache.voice).toEqual(voice);
    expect(fromCache.items.every((s) => s.state === 'cached')).toBe(true);
  });
});
