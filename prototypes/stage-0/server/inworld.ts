// Thin wrappers over the Inworld REST API. The API key never leaves this process.
// Docs checked 2026-11-26:
//   TTS:            https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech.md
//   Session tokens: https://docs.inworld.ai/portal/session-tokens.md (Realtime refuses one-time tokens)

const API = 'https://api.inworld.ai';

export const TTS_MODEL = process.env.INWORLD_TTS_MODEL || 'inworld-tts-2';
export const TTS_SAMPLE_RATE = 24000;

export class InworldError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.INWORLD_API_KEY;
  if (!key) throw new InworldError('INWORLD_API_KEY is not set in .env', 500);
  return key;
}

export function voiceId(): string {
  const id = process.env.INWORLD_VOICE_ID;
  if (!id) throw new InworldError('INWORLD_VOICE_ID is not set in .env', 500);
  return id;
}

export function configStatus() {
  return {
    apiKey: Boolean(process.env.INWORLD_API_KEY),
    voiceId: Boolean(process.env.INWORLD_VOICE_ID),
    ttsModel: TTS_MODEL,
  };
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

/** Multi-use JWT for a direct browser Realtime connection. Lives a few hours. */
export async function mintSessionToken(): Promise<{ token: string; expirationTime: string }> {
  const res = await fetch(`${API}/v1/sessionTokens/token:generate`, {
    method: 'POST',
    headers: { Authorization: `Basic ${apiKey()}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw await upstreamError(res, 'Session token mint');
  const { token, expirationTime } = (await res.json()) as { token: string; expirationTime: string };
  return { token, expirationTime };
}

export interface SynthesizeResult {
  wav: Buffer;
  characters: number;
  ms: number;
}

/** One-shot synthesis with the cloned voice. Returns a WAV file (LINEAR16 includes the header). */
export async function synthesize(text: string): Promise<SynthesizeResult> {
  if (!text.trim()) throw new InworldError('Text is empty', 400);
  if (text.length > 2000) throw new InworldError('Text is longer than 2000 characters', 400);
  const started = performance.now();
  const res = await fetch(`${API}/tts/v1/voice`, {
    method: 'POST',
    headers: { Authorization: `Basic ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceId: voiceId(),
      modelId: TTS_MODEL,
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: TTS_SAMPLE_RATE },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await upstreamError(res, 'TTS');
  const body = (await res.json()) as {
    audioContent: string;
    usage?: { processedCharactersCount?: number };
  };
  return {
    wav: Buffer.from(body.audioContent, 'base64'),
    characters: body.usage?.processedCharactersCount ?? text.length,
    ms: Math.round(performance.now() - started),
  };
}
