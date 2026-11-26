// Web Audio plumbing: device list, output player bound to a chosen device, input capture.

export const PCM_RATE = 24000;

export async function listAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput'),
    outputs: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

/** Device labels stay empty until the page has microphone permission once. */
export async function ensureDeviceLabels() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const s of buf) sum += s * s;
  return Math.sqrt(sum / buf.length);
}

type SinkCapable = { setSinkId(id: string): Promise<void> };

/**
 * Plays agent audio into one output device (BlackHole 2ch -> Teams microphone),
 * optionally mirrored to a monitor device (headphones) so the author hears the agent.
 */
export class OutputPlayer {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private readonly bus = this.ctx.createGain();
  private readonly analyser = this.ctx.createAnalyser();
  private readonly levelBuf = new Float32Array(1024);
  private readonly monitorDest = this.ctx.createMediaStreamDestination();
  private readonly monitorEl = new Audio();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private monitorOn = false;

  constructor() {
    this.bus.connect(this.ctx.destination);
    this.bus.connect(this.analyser);
    this.analyser.fftSize = 1024;
    this.monitorEl.srcObject = this.monitorDest.stream;
  }

  async setSink(deviceId: string) {
    await (this.ctx as unknown as SinkCapable).setSinkId(deviceId);
  }

  /** deviceId === '' turns the monitor off. */
  async setMonitor(deviceId: string) {
    if (!deviceId) {
      if (this.monitorOn) this.bus.disconnect(this.monitorDest);
      this.monitorOn = false;
      this.monitorEl.pause();
      return;
    }
    await (this.monitorEl as unknown as SinkCapable).setSinkId(deviceId);
    if (!this.monitorOn) this.bus.connect(this.monitorDest);
    this.monitorOn = true;
    await this.monitorEl.play();
  }

  get isPlaying() {
    return this.sources.size > 0;
  }

  level() {
    return rms(this.analyser, this.levelBuf);
  }

  /**
   * Queue an AudioBuffer right after whatever is already queued.
   * Returns the wall-clock time (performance.now() scale) when it will start sounding.
   */
  enqueue(buffer: AudioBuffer, onEnded?: () => void): number {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.bus);
    const startAt = Math.max(this.nextTime, this.ctx.currentTime + 0.03);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      onEnded?.();
    };
    return performance.now() + (startAt - this.ctx.currentTime) * 1000 + this.ctx.outputLatency * 1000;
  }

  enqueuePcm16(bytes: Uint8Array): number {
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const buffer = this.ctx.createBuffer(1, samples.length, PCM_RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
    return this.enqueue(buffer);
  }

  async playEncoded(data: ArrayBuffer, onEnded?: () => void): Promise<{ startsAt: number; duration: number }> {
    const buffer = await this.ctx.decodeAudioData(data);
    return { startsAt: this.enqueue(buffer, onEnded), duration: buffer.duration };
  }

  /** Test signal: three rising beeps, then a short sweep. Easy to recognise on the phone. */
  playTestSignal(): number {
    const rate = this.ctx.sampleRate;
    const seconds = 2.2;
    const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const ch = buffer.getChannelData(0);
    const beep = (start: number, len: number, freq: number) => {
      for (let i = 0; i < len * rate; i++) {
        const t = i / rate;
        const env = Math.min(1, t * 50, (len - t) * 50);
        ch[Math.floor(start * rate) + i] = 0.4 * env * Math.sin(2 * Math.PI * freq * t);
      }
    };
    beep(0, 0.25, 440);
    beep(0.4, 0.25, 660);
    beep(0.8, 0.25, 880);
    let phase = 0;
    for (let i = 0; i < 1.0 * rate; i++) {
      const t = i / rate;
      const freq = 300 + 1700 * t;
      phase += (2 * Math.PI * freq) / rate;
      const env = Math.min(1, t * 50, (1 - t) * 50);
      ch[Math.floor(1.2 * rate) + i] = 0.3 * env * Math.sin(phase);
    }
    return this.enqueue(buffer);
  }

  /** Drop everything queued or playing. Synchronous: audio stops within one render quantum. */
  stop() {
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
  }
}

/** Captures a chosen input device (BlackHole 16ch) raw, with all browser processing off. */
export class InputCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private analyser?: AnalyserNode;
  private readonly levelBuf = new Float32Array(1024);
  onChunk: (pcm: Int16Array) => void = () => {};
  settings?: MediaTrackSettings;

  async start(deviceId: string) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
    this.settings = this.stream.getAudioTracks()[0]?.getSettings();
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('/pcm-worklet.js');
    const source = this.ctx.createMediaStreamSource(this.stream);
    // Teams output reaches BlackHole 16ch on channels 1-2; downmix to mono.
    const mono = this.ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';
    source.connect(mono);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    mono.connect(this.analyser);
    const node = new AudioWorkletNode(this.ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.onChunk(new Int16Array(e.data));
    mono.connect(node);
    // Keep the graph pulled by the renderer without making any sound.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(this.ctx.destination);
  }

  get running() {
    return Boolean(this.ctx);
  }

  level() {
    return this.analyser ? rms(this.analyser, this.levelBuf) : 0;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = undefined;
    this.stream = undefined;
    this.analyser = undefined;
  }
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function toDb(level: number) {
  return level > 0 ? 20 * Math.log10(level) : -Infinity;
}
