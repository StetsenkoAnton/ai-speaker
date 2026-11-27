// Records a voice sample from the microphone and turns it into a 24 kHz mono WAV for cloning.
import { encodeWav } from '@ai-speaker/providers/audio';

const RATE = 24000;

export class SampleRecorder {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    // Raw microphone: the clone should hear the voice, not the browser's processing.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('Not recording');
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = undefined;
    return new Blob(this.chunks, { type: recorder.mimeType });
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }
}

/** Decode any audio the browser can play and re-encode it as 24 kHz mono 16-bit WAV. */
export async function toCloneWav(data: ArrayBuffer): Promise<{ wav: Uint8Array; seconds: number }> {
  const decoder = new AudioContext();
  const decoded = await decoder.decodeAudioData(data);
  void decoder.close();
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = (await offline.startRendering()).getChannelData(0);
  const pcm = new Uint8Array(rendered.length * 2);
  const view = new DataView(pcm.buffer);
  rendered.forEach((s, i) => view.setInt16(i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return { wav: encodeWav({ sampleRate: RATE, channels: 1, data: pcm }), seconds: decoded.duration };
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
