import { describe, expect, it } from 'vitest';
import { concatWav, durationMs, encodeWav, parseWav, silenceWav, splitForTts, WavError } from './index.ts';

describe('wav', () => {
  it('round-trips PCM through a WAV file', () => {
    const data = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
    const parsed = parseWav(encodeWav({ sampleRate: 24000, channels: 1, data }));
    expect(parsed).toEqual({ sampleRate: 24000, channels: 1, data });
  });

  it('measures duration and joins files with a gap', () => {
    const joined = parseWav(concatWav([silenceWav(1000), silenceWav(500)], 250));
    expect(durationMs(joined)).toBe(1750);
  });

  it('rejects other formats and mismatched files', () => {
    expect(() => parseWav(new TextEncoder().encode('not a wav file at all'))).toThrow(WavError);
    expect(() => concatWav([silenceWav(10, 24000), silenceWav(10, 48000)])).toThrow(/different formats/);
  });

  it('reads files whose data size is unknown (streaming encoders)', () => {
    const wav = silenceWav(100);
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(durationMs(parseWav(wav))).toBe(100);
  });
});

describe('splitForTts', () => {
  it('keeps short text whole and normalises spaces', () => {
    expect(splitForTts('  Hello\n  world. ', 100)).toEqual(['Hello world.']);
    expect(splitForTts('   ', 100)).toEqual([]);
  });

  it('splits at sentence ends without exceeding the limit', () => {
    const text = 'One two three. Four five six! Seven eight nine? Ten.';
    const pieces = splitForTts(text, 30);
    expect(pieces).toEqual(['One two three. Four five six!', 'Seven eight nine? Ten.']);
    expect(pieces.every((p) => p.length <= 30)).toBe(true);
  });

  it('cuts a very long sentence at words', () => {
    const pieces = splitForTts('word '.repeat(50).trim(), 24);
    expect(pieces.every((p) => p.length <= 24)).toBe(true);
    expect(pieces.join(' ').split(' ')).toHaveLength(50);
  });
});
