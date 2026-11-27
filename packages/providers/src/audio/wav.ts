// Minimal WAV (RIFF, PCM 16-bit) helpers for synthesized speech. Runs in Node and browsers.

export interface Pcm16 {
  sampleRate: number;
  channels: number;
  /** Interleaved little-endian 16-bit samples, without the header. */
  data: Uint8Array;
}

export class WavError extends Error {}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/** Parse a PCM 16-bit WAV file. Other formats are rejected. */
export function parseWav(bytes: Uint8Array): Pcm16 {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') throw new WavError('Not a WAV file');
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | undefined;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset);
    let size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new WavError('WAV data chunk before fmt chunk');
      if (fmt.format !== 1 || fmt.bits !== 16) throw new WavError(`Only PCM 16-bit WAV is supported (format ${fmt.format}, ${fmt.bits} bit)`);
      // Streaming encoders may write 0 or 0xFFFFFFFF as the size: take the rest of the file.
      if (size === 0 || body + size > bytes.length) size = bytes.length - body;
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, data: bytes.slice(body, body + size - (size % 2)) };
    }
    offset = body + size + (size % 2);
  }
  throw new WavError('WAV file has no data chunk');
}

export function encodeWav(pcm: Pcm16): Uint8Array {
  const out = new Uint8Array(44 + pcm.data.length);
  const view = new DataView(out.buffer);
  const write = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.data.length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, pcm.channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * pcm.channels * 2, true);
  view.setUint16(32, pcm.channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.data.length, true);
  out.set(pcm.data, 44);
  return out;
}

export function durationMs(pcm: Pcm16): number {
  return Math.round((pcm.data.length / (pcm.channels * 2) / pcm.sampleRate) * 1000);
}

/** Join WAV files with the same format, with `gapMs` of silence between them. */
export function concatWav(files: Uint8Array[], gapMs = 0): Uint8Array {
  const parts = files.map(parseWav);
  const first = parts[0];
  if (!first) throw new WavError('Nothing to join');
  for (const p of parts) {
    if (p.sampleRate !== first.sampleRate || p.channels !== first.channels) throw new WavError('WAV files have different formats');
  }
  const frame = first.channels * 2;
  const gap = new Uint8Array(Math.round((first.sampleRate * gapMs) / 1000) * frame);
  const total = parts.reduce((n, p) => n + p.data.length, 0) + gap.length * (parts.length - 1);
  const data = new Uint8Array(total);
  let at = 0;
  parts.forEach((p, i) => {
    if (i > 0) {
      data.set(gap, at);
      at += gap.length;
    }
    data.set(p.data, at);
    at += p.data.length;
  });
  return encodeWav({ sampleRate: first.sampleRate, channels: first.channels, data });
}

/** A WAV of silence, for tests and placeholders. */
export function silenceWav(ms: number, sampleRate = 24000): Uint8Array {
  return encodeWav({ sampleRate, channels: 1, data: new Uint8Array(Math.round((sampleRate * ms) / 1000) * 2) });
}
