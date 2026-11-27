// Prepares the talk the end-to-end tests present: a copy of talks/example whose audio cache
// holds short generated tones instead of Inworld speech. No network, no TTS characters.
import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadTalk } from '@ai-speaker/talk-format';
import { durationMs, encodeWav, parseWav } from '@ai-speaker/providers/audio';
import type { VoiceProvider } from '@ai-speaker/providers';
import { cacheStatus, renderItems } from '../apps/server/src/audio-cache.ts';

const root = resolve(import.meta.dirname, '..');
export const E2E_TALK = join(root, 'e2e/.out/talk');

function tone(ms: number, hz = 440, rate = 24000): Uint8Array {
  const n = Math.round((rate * ms) / 1000);
  const data = new Uint8Array(n * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < n; i++) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000), true);
  return encodeWav({ sampleRate: rate, channels: 1, data });
}

const toneProvider: VoiceProvider = {
  id: 'e2e',
  languages: 'any',
  cloneVoice: async () => ({ provider: 'e2e', voiceId: 'tone', lang: 'en' }),
  listVoices: async () => [],
  deleteVoice: async () => {},
  synthesize: async () => {
    const data = tone(700);
    return { data, mimeType: 'audio/wav', durationMs: durationMs(parseWav(data)) };
  },
};

await rm(E2E_TALK, { recursive: true, force: true });
await cp(join(root, 'talks/example'), E2E_TALK, { recursive: true, filter: (src) => !src.includes('.cache') });
const { value: talk } = await loadTalk(E2E_TALK);
const voice = { provider: 'e2e', voiceId: 'tone', model: 'tone', lang: talk.brief.lang };
await renderItems(talk, toneProvider, voice, (await cacheStatus(talk, voice)).items);
console.log(`e2e talk ready: ${E2E_TALK}`);
