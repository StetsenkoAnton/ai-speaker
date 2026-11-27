import { afterEach, describe, expect, it, vi } from 'vitest';
import { durationMs, parseWav, silenceWav } from '../audio/index.ts';
import { InworldClient, InworldVoiceProvider, MAX_TTS_CHARS } from './index.ts';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init: RequestInit) => unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown; method?: string }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined, method: init.method });
    return new Response(JSON.stringify(handler(url, init)), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

describe('InworldClient', () => {
  it('needs a key but not a voice id until synthesis', async () => {
    expect(() => new InworldClient({ apiKey: '' })).toThrow(/INWORLD_API_KEY/);
    await expect(new InworldClient({ apiKey: 'k' }).synthesize('hi')).rejects.toThrow(/INWORLD_VOICE_ID/);
  });

  it('lists own voices across pages', async () => {
    const calls = stubFetch((url) =>
      url.includes('pageToken')
        ? { voices: [{ voiceId: 'w__b', displayName: 'B' }] }
        : { voices: [{ voiceId: 'w__a', displayName: 'A', languageCode: 'en-US', source: 'IVC' }], nextPageToken: 'p2' },
    );
    const voices = await new InworldClient({ apiKey: 'k' }).listVoices({ ownedOnly: true });
    expect(voices.map((v) => v.voiceId)).toEqual(['w__a', 'w__b']);
    expect(decodeURIComponent(calls[0]!.url)).toContain('filter=owned="true"');
  });

  it('reports upstream errors with the status', async () => {
    stubFetch(() => ({ message: 'Current access level in API key: read (r)' }), 403);
    await expect(new InworldClient({ apiKey: 'k' }).deleteVoice('w__a')).rejects.toMatchObject({
      status: 403,
      message: 'Delete voice failed (403): Current access level in API key: read (r)',
    });
  });
});

describe('InworldVoiceProvider', () => {
  it('splits long text, synthesizes each piece and joins the audio', async () => {
    const calls = stubFetch(() => ({ audioContent: b64(silenceWav(1000)) }));
    const provider = new InworldVoiceProvider({ apiKey: 'k', voiceId: 'default' });
    const sentence = 'This sentence is about sixty characters long, more or less. ';
    const clip = await provider.synthesize({ text: sentence.repeat(50), voice: { provider: 'inworld', voiceId: 'w__me', lang: 'en' } });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => (c.body as { text: string }).text.length <= MAX_TTS_CHARS)).toBe(true);
    expect(calls.every((c) => (c.body as { voiceId: string }).voiceId === 'w__me')).toBe(true);
    expect(clip.durationMs).toBe(2250);
    expect(durationMs(parseWav(clip.data))).toBe(2250);
  });

  it('clones a voice from WAV samples', async () => {
    const calls = stubFetch(() => ({ voice: { voiceId: 'w__new', displayName: 'Me', languageCode: 'en-US' }, audioSamplesValidated: [] }));
    const ref = await new InworldVoiceProvider({ apiKey: 'k' }).cloneVoice({ name: 'Me', lang: 'en-US', samples: [silenceWav(3000)] });
    expect(ref).toEqual({ provider: 'inworld', voiceId: 'w__new', lang: 'en-US' });
    expect(calls[0]!.url).toBe('https://api.inworld.ai/voices/v1/voices:clone');
    expect((calls[0]!.body as { voiceSamples: unknown[] }).voiceSamples).toHaveLength(1);
  });
});
