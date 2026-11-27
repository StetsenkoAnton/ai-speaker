// Settings that come from .env. Keys never leave the server process.
import { DEFAULT_TTS_MODEL, InworldVoiceProvider } from '@ai-speaker/providers/inworld';
import type { VoiceSettings } from './audio-cache.ts';

export function inworldConfigured() {
  return { apiKey: Boolean(process.env.INWORLD_API_KEY), voiceId: Boolean(process.env.INWORLD_VOICE_ID) };
}

export function ttsModel(): string {
  return process.env.INWORLD_TTS_MODEL || DEFAULT_TTS_MODEL;
}

/** Voice settings for a talk, or undefined when no voice is chosen yet. */
export function voiceSettings(lang: string): VoiceSettings | undefined {
  const voiceId = process.env.INWORLD_VOICE_ID;
  if (!voiceId) return undefined;
  return { provider: 'inworld', voiceId, model: ttsModel(), lang };
}

export function createVoiceProvider(): InworldVoiceProvider {
  return new InworldVoiceProvider({
    apiKey: process.env.INWORLD_API_KEY ?? '',
    voiceId: process.env.INWORLD_VOICE_ID ?? '',
    ttsModel: ttsModel(),
  });
}
