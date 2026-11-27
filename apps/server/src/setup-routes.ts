// HTTP routes of the /setup page: check the Inworld key, list voices, say a test phrase,
// clone the author's voice and save the chosen voice id to .env.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { InworldError } from '@ai-speaker/providers/inworld';
import { HttpError, readJson, sendJson } from './http.ts';
import { createVoiceProvider, inworldConfigured, ttsModel } from './config.ts';
import { setEnvVar } from './env-file.ts';

/** Recorded samples arrive as base64 WAV: 30 s of 24 kHz mono is about 2 MB of base64. */
const CLONE_BODY_LIMIT = 12 * 1024 * 1024;
const MAX_TEST_PHRASE = 300;

export interface SetupOptions {
  /** Path of the .env file the chosen voice id is written to. */
  envPath: string;
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Handles `/api/setup/*`. Returns false for other paths. */
export async function handleSetup(req: IncomingMessage, res: ServerResponse, url: URL, options: SetupOptions): Promise<boolean> {
  if (!url.pathname.startsWith('/api/setup/')) return false;
  const route = `${req.method} ${url.pathname.slice('/api/setup/'.length)}`;
  try {
    switch (route) {
      case 'GET status': {
        sendJson(res, 200, { ...inworldConfigured(), ttsModel: ttsModel(), voiceIdValue: process.env.INWORLD_VOICE_ID ?? '' });
        return true;
      }
      case 'GET voices': {
        const voices = await createVoiceProvider().client.listVoices({ ownedOnly: true });
        sendJson(res, 200, { voices, current: process.env.INWORLD_VOICE_ID ?? '' });
        return true;
      }
      case 'POST speak': {
        const body = await readJson(req);
        const text = str(body, 'text');
        if (!text) throw new HttpError('Text is empty', 400);
        if (text.length > MAX_TEST_PHRASE) throw new HttpError(`A test phrase is at most ${MAX_TEST_PHRASE} characters`, 400);
        const result = await createVoiceProvider().client.synthesize(text, { voiceId: str(body, 'voiceId') || undefined });
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Characters': String(result.characters) });
        res.end(result.wav);
        return true;
      }
      case 'POST clone': {
        const body = await readJson(req, CLONE_BODY_LIMIT);
        if (body.consent !== true) throw new HttpError('Confirm that this is your own voice', 400);
        const name = str(body, 'displayName');
        const sample = str(body, 'audioBase64');
        if (!name) throw new HttpError('Give the voice a name', 400);
        if (!sample) throw new HttpError('Record or choose a voice sample first', 400);
        const result = await createVoiceProvider().client.cloneVoice({
          displayName: name,
          languageCode: str(body, 'languageCode') || 'auto',
          samples: [Buffer.from(sample, 'base64')],
        });
        sendJson(res, 200, result);
        return true;
      }
      case 'POST voice': {
        const body = await readJson(req);
        const voiceId = str(body, 'voiceId');
        if (!/^[\w.-]+$/.test(voiceId)) throw new HttpError('Invalid voice id', 400);
        await setEnvVar(options.envPath, 'INWORLD_VOICE_ID', voiceId);
        sendJson(res, 200, { ok: true, voiceId });
        return true;
      }
      default:
        sendJson(res, 404, { error: 'Not found' });
        return true;
    }
  } catch (err) {
    const status = err instanceof HttpError || err instanceof InworldError ? err.status : 500;
    sendJson(res, status >= 400 && status < 600 ? status : 502, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
