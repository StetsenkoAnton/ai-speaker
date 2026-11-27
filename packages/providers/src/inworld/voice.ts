// VoiceProvider for Inworld TTS-2. The same model speaks the talk and, at stage 4, the live
// answers, so the voice does not change between the two.
import type { Lang } from '@ai-speaker/talk-format';
import type { AudioClip, VoiceProvider, VoiceRef } from '../index.ts';
import { concatWav, durationMs, parseWav, splitForTts } from '../audio/index.ts';
import { InworldClient, MAX_TTS_CHARS, type InworldConfig } from './client.ts';

/** Pause between pieces of one long section, so the joins sound like sentence breaks. */
const PIECE_GAP_MS = 250;

export class InworldVoiceProvider implements VoiceProvider {
  readonly id = 'inworld';
  // TTS-2 is multilingual; the talk language is checked against the voice in /setup.
  readonly languages = 'any' as const;
  readonly client: InworldClient;

  constructor(config: InworldConfig | InworldClient) {
    this.client = config instanceof InworldClient ? config : new InworldClient(config);
  }

  get model(): string {
    return this.client.config.ttsModel;
  }

  async synthesize(request: { text: string; voice: VoiceRef; signal?: AbortSignal }): Promise<AudioClip> {
    const pieces = splitForTts(request.text, MAX_TTS_CHARS);
    if (!pieces.length) throw new Error('Nothing to synthesize: the text is empty');
    const wavs: Uint8Array[] = [];
    for (const piece of pieces) {
      const result = await this.client.synthesize(piece, { voiceId: request.voice.voiceId, signal: request.signal });
      wavs.push(result.wav);
    }
    const data = wavs.length === 1 ? wavs[0]! : concatWav(wavs, PIECE_GAP_MS);
    return { data, mimeType: 'audio/wav', durationMs: durationMs(parseWav(data)) };
  }

  async listVoices(): Promise<VoiceRef[]> {
    const voices = await this.client.listVoices({ ownedOnly: true });
    return voices.map((v) => ({ provider: this.id, voiceId: v.voiceId, lang: v.languageCode ?? 'auto' }));
  }

  async cloneVoice(request: { name: string; lang: Lang; samples: Uint8Array[] }): Promise<VoiceRef> {
    const { voice } = await this.client.cloneVoice({ displayName: request.name, languageCode: request.lang, samples: request.samples });
    return { provider: this.id, voiceId: voice.voiceId, lang: voice.languageCode ?? request.lang };
  }

  async deleteVoice(voice: VoiceRef): Promise<void> {
    await this.client.deleteVoice(voice.voiceId);
  }
}
