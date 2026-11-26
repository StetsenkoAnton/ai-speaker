// Captures mono audio, resamples it to 24 kHz and posts PCM16 chunks of ~80 ms.
// Plain JS in /public so the browser can load it as an AudioWorklet module without bundling.
const TARGET_RATE = 24000;
const CHUNK_SAMPLES = 1920; // 80 ms at 24 kHz; Inworld recommends 60-100 ms chunks

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this.pos = 0; // fractional read position into the carried-over input
    this.carry = new Float32Array(0);
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outLen = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    // Join the tail from the previous block with the new block, then linearly interpolate.
    const buf = new Float32Array(this.carry.length + channel.length);
    buf.set(this.carry, 0);
    buf.set(channel, this.carry.length);

    let pos = this.pos;
    while (pos + 1 < buf.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s = buf[i] * (1 - frac) + buf[i + 1] * frac;
      const clamped = Math.max(-1, Math.min(1, s));
      this.out[this.outLen++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.outLen === CHUNK_SAMPLES) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(CHUNK_SAMPLES);
        this.outLen = 0;
      }
      pos += this.ratio;
    }
    const keepFrom = Math.floor(pos);
    this.carry = buf.slice(keepFrom);
    this.pos = pos - keepFrom;
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
