// Pre-rendered speech for a talk: one WAV per slide section and per closing phrase.
// Files live in <talk>/.cache/audio/<hash>.wav; the hash covers everything that changes the
// sound, so editing one section re-renders only that section.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyPronunciation, type Talk } from '@ai-speaker/talk-format';
import { TTS_SAMPLE_RATE } from '@ai-speaker/providers/inworld';
import type { VoiceProvider, VoiceRef } from '@ai-speaker/providers';

export const CACHE_DIR = join('.cache', 'audio');
const MANIFEST = 'manifest.json';

export interface SpeechItem {
  /** `slide:<id>` or `closing:<n>`. */
  key: string;
  kind: 'slide' | 'closing';
  slideId?: string;
  /** Text sent to the voice, after the pronunciation dictionary. */
  text: string;
}

export interface VoiceSettings {
  provider: string;
  voiceId: string;
  model: string;
  lang: string;
}

export interface ManifestEntry {
  hash: string;
  chars: number;
  durationMs: number;
}

export interface Manifest {
  voice?: VoiceSettings;
  items: Record<string, ManifestEntry>;
}

export type ItemStatus = { item: SpeechItem; hash: string; state: 'cached'; entry: ManifestEntry } | { item: SpeechItem; hash: string; state: 'missing' };

export function speechItems(talk: Talk): SpeechItem[] {
  const say = (text: string) => applyPronunciation(text, talk.pronunciation);
  const sections = new Map(talk.script.map((s) => [s.slideId, s.text]));
  const items: SpeechItem[] = [];
  for (const slide of talk.slides) {
    const text = sections.get(slide.id)?.trim();
    if (text) items.push({ key: `slide:${slide.id}`, kind: 'slide', slideId: slide.id, text: say(text) });
  }
  talk.phrases.closing.forEach((phrase, i) => items.push({ key: `closing:${i}`, kind: 'closing', text: say(phrase) }));
  return items;
}

export function speechHash(text: string, voice: VoiceSettings): string {
  const input = JSON.stringify({ text, provider: voice.provider, voiceId: voice.voiceId, model: voice.model, lang: voice.lang, rate: TTS_SAMPLE_RATE });
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export function cacheDir(talk: Talk): string {
  return join(talk.dir, CACHE_DIR);
}

export function audioPath(talk: Talk, hash: string): string {
  return join(cacheDir(talk), `${hash}.wav`);
}

export async function readManifest(talk: Talk): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(join(cacheDir(talk), MANIFEST), 'utf8')) as Manifest;
  } catch {
    return { items: {} };
  }
}

async function writeManifest(talk: Talk, manifest: Manifest) {
  const path = join(cacheDir(talk), MANIFEST);
  await writeFile(`${path}.tmp`, JSON.stringify(manifest, null, 2));
  await rename(`${path}.tmp`, path);
}

/**
 * What is rendered for the given voice. Without a voice (no INWORLD_VOICE_ID), the voice the
 * cache was rendered with is used, so a talk can be presented from its cache alone.
 */
export async function cacheStatus(talk: Talk, voice?: VoiceSettings): Promise<{ voice?: VoiceSettings; items: ItemStatus[] }> {
  const manifest = await readManifest(talk);
  const used = voice ?? manifest.voice;
  const items = speechItems(talk).map((item): ItemStatus => {
    const hash = used ? speechHash(item.text, used) : '';
    const entry = manifest.items[item.key];
    if (used && entry?.hash === hash && existsSync(audioPath(talk, hash))) return { item, hash, state: 'cached', entry };
    return { item, hash, state: 'missing' };
  });
  return { voice: used, items };
}

/** Rough speech length for planning: about 15 characters a second. */
export function estimateSeconds(chars: number): number {
  return Math.round(chars / 15);
}

export async function renderItems(
  talk: Talk,
  provider: VoiceProvider,
  voice: VoiceSettings,
  items: ItemStatus[],
  onProgress: (done: number, total: number, item: SpeechItem, durationMs: number) => void = () => {},
): Promise<void> {
  await mkdir(cacheDir(talk), { recursive: true });
  const manifest = await readManifest(talk);
  // A new voice or model makes the old entries useless; start over instead of mixing voices.
  if (manifest.voice && JSON.stringify(manifest.voice) !== JSON.stringify(voice)) manifest.items = {};
  manifest.voice = voice;
  const ref: VoiceRef = { provider: voice.provider, voiceId: voice.voiceId, lang: voice.lang };
  let done = 0;
  for (const status of items) {
    const clip = await provider.synthesize({ text: status.item.text, voice: ref });
    const hash = speechHash(status.item.text, voice);
    await writeFile(audioPath(talk, hash), clip.data);
    manifest.items[status.item.key] = { hash, chars: status.item.text.length, durationMs: clip.durationMs };
    // Saved after each item: an interrupted render keeps what it already paid for.
    await writeManifest(talk, manifest);
    onProgress(++done, items.length, status.item, clip.durationMs);
  }
}
