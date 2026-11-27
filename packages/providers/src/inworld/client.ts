// Thin client for the Inworld REST API. The API key never leaves the server process.
// Moved from the stage-0 prototype (prototypes/stage-0/server/inworld.ts); it reads no
// environment variables, the server passes the configuration in.
// Docs checked 2026-11-26:
//   TTS:            https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech.md
//   Session tokens: https://docs.inworld.ai/portal/session-tokens.md (Realtime refuses one-time tokens)
//   Voices:         https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/clone-voice.md,
//                   list-voices.md, delete-voice.md (clone and delete need a key with Write access)

const API = 'https://api.inworld.ai';

export const DEFAULT_TTS_MODEL = 'inworld-tts-2';
export const TTS_SAMPLE_RATE = 24000;
/** Longest text one synthesis request accepts. */
export const MAX_TTS_CHARS = 2000;

export class InworldError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface InworldConfig {
  /** Base64 credential from Inworld Portal -> API Keys. */
  apiKey: string;
  /** Cloned voice id. Stays out of git. Empty until a voice is chosen in /setup. */
  voiceId?: string;
  ttsModel?: string;
}

export interface InworldVoice {
  voiceId: string;
  displayName: string;
  languageCode?: string;
  /** "IVC" for an instant voice clone, "SYSTEM" for built-in voices. */
  source?: string;
}

export interface SynthesizeResult {
  /** WAV file: LINEAR16 output includes the header. */
  wav: Uint8Array;
  characters: number;
  ms: number;
}

async function upstreamError(res: Response, what: string): Promise<InworldError> {
  // Inworld error bodies carry a message but never echo credentials.
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string; error?: { message?: string } };
    detail = body.message ?? body.error?.message ?? '';
  } catch {
    // body was not JSON
  }
  return new InworldError(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}`, res.status);
}

export class InworldClient {
  readonly config: Required<InworldConfig>;

  constructor(config: InworldConfig) {
    if (!config.apiKey) throw new InworldError('INWORLD_API_KEY is not set in .env', 500);
    this.config = { ttsModel: DEFAULT_TTS_MODEL, voiceId: '', ...config };
  }

  private headers() {
    return { Authorization: `Basic ${this.config.apiKey}`, 'Content-Type': 'application/json' };
  }

  /** Multi-use JWT for a direct browser Realtime connection. Lives a few hours. */
  async mintSessionToken(): Promise<{ token: string; expirationTime: string }> {
    const res = await fetch(`${API}/v1/sessionTokens/token:generate`, {
      method: 'POST',
      headers: this.headers(),
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw await upstreamError(res, 'Session token mint');
    const { token, expirationTime } = (await res.json()) as { token: string; expirationTime: string };
    return { token, expirationTime };
  }

  /** One-shot synthesis. Uses the configured voice unless another one is given. */
  async synthesize(text: string, options: { voiceId?: string; signal?: AbortSignal } = {}): Promise<SynthesizeResult> {
    const { signal } = options;
    const voiceId = options.voiceId || this.config.voiceId;
    if (!voiceId) throw new InworldError('INWORLD_VOICE_ID is not set in .env: choose a voice in /setup', 500);
    if (!text.trim()) throw new InworldError('Text is empty', 400);
    if (text.length > MAX_TTS_CHARS) throw new InworldError(`Text is longer than ${MAX_TTS_CHARS} characters`, 400);
    const started = performance.now();
    const res = await fetch(`${API}/tts/v1/voice`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        text,
        voiceId,
        modelId: this.config.ttsModel,
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: TTS_SAMPLE_RATE },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw await upstreamError(res, 'TTS');
    const body = (await res.json()) as { audioContent: string; usage?: { processedCharactersCount?: number } };
    return {
      wav: Buffer.from(body.audioContent, 'base64'),
      characters: body.usage?.processedCharactersCount ?? text.length,
      ms: Math.round(performance.now() - started),
    };
  }

  /** Voices of this workspace (clones), or all voices including the built-in ones. */
  async listVoices(options: { ownedOnly?: boolean } = {}): Promise<InworldVoice[]> {
    const voices: InworldVoice[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ pageSize: '500' });
      if (options.ownedOnly) params.set('filter', 'owned="true"');
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`${API}/voices/v1/voices?${params}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw await upstreamError(res, 'List voices');
      const body = (await res.json()) as { voices?: InworldVoice[]; nextPageToken?: string };
      for (const v of body.voices ?? []) {
        voices.push({ voiceId: v.voiceId, displayName: v.displayName, languageCode: v.languageCode, source: v.source });
      }
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return voices;
  }

  /** Instant voice clone from WAV or MP3 samples (3 to 30 seconds in total works best). */
  async cloneVoice(request: { displayName: string; languageCode?: string; samples: Uint8Array[] }): Promise<{ voice: InworldVoice; warnings: string[] }> {
    const res = await fetch(`${API}/voices/v1/voices:clone`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        displayName: request.displayName,
        languageCode: request.languageCode ?? 'auto',
        voiceSamples: request.samples.map((s) => ({ audioData: Buffer.from(s).toString('base64') })),
        audioProcessingConfig: { removeBackgroundNoise: true },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw await upstreamError(res, 'Clone voice');
    const body = (await res.json()) as {
      voice: InworldVoice;
      audioSamplesValidated?: Array<{ errors?: Array<{ text?: string }>; warnings?: Array<{ text?: string }> }>;
    };
    const warnings = (body.audioSamplesValidated ?? []).flatMap((s) => [...(s.errors ?? []), ...(s.warnings ?? [])].map((w) => w.text ?? ''));
    return { voice: body.voice, warnings: warnings.filter(Boolean) };
  }

  async deleteVoice(voiceId: string): Promise<void> {
    const res = await fetch(`${API}/voices/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw await upstreamError(res, 'Delete voice');
  }
}
