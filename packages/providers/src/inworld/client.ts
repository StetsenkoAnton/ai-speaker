// Thin client for the Inworld REST API. The API key never leaves the server process.
// Moved from the stage-0 prototype (prototypes/stage-0/server/inworld.ts); it reads no
// environment variables, the server passes the configuration in.
// Docs checked 2026-11-26:
//   TTS:            https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech.md
//   Session tokens: https://docs.inworld.ai/portal/session-tokens.md (Realtime refuses one-time tokens)

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
  /** Cloned voice id. Stays out of git. */
  voiceId: string;
  ttsModel?: string;
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
    if (!config.apiKey) throw new InworldError('Inworld API key is not set', 500);
    if (!config.voiceId) throw new InworldError('Inworld voice id is not set', 500);
    this.config = { ttsModel: DEFAULT_TTS_MODEL, ...config };
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

  /** One-shot synthesis with the cloned voice. */
  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesizeResult> {
    if (!text.trim()) throw new InworldError('Text is empty', 400);
    if (text.length > MAX_TTS_CHARS) throw new InworldError(`Text is longer than ${MAX_TTS_CHARS} characters`, 400);
    const started = performance.now();
    const res = await fetch(`${API}/tts/v1/voice`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        text,
        voiceId: this.config.voiceId,
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
}
