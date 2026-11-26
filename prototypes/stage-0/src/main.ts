import {
  InputCapture,
  OutputPlayer,
  base64ToBytes,
  ensureDeviceLabels,
  int16ToBase64,
  listAudioDevices,
  toDb,
} from './audio.ts';
import { RealtimeClient, type SessionOptions, type TurnMode } from './realtime.ts';

// Input RMS above this counts as speech for the local "end of question" timestamp (~ -34 dBFS).
const SPEECH_THRESHOLD = 0.02;
// Output RMS below this counts as silence when timing the Stop button.
const SILENCE_THRESHOLD = 0.001;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sel = (id: string) => $<HTMLSelectElement>(id);

// ---------- log ----------
const logEl = $('log');
const t0 = performance.now();
function log(msg: string) {
  const line = `${((performance.now() - t0) / 1000).toFixed(2).padStart(8)}s  ${msg}\n`;
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line.trimEnd());
}
$('logClear').onclick = () => (logEl.textContent = '');
$('logCopy').onclick = () => void navigator.clipboard.writeText(logEl.textContent ?? '');

// ---------- browser check ----------
// Routing the agent voice to BlackHole needs AudioContext.setSinkId (Chrome/Edge). Safari lacks it.
if (!('setSinkId' in AudioContext.prototype)) {
  const warn = $('browserWarn');
  warn.hidden = false;
  log(`WARNING: this browser has no AudioContext.setSinkId (${navigator.userAgent}). Open the page in Google Chrome.`);
}

// ---------- persistence (per-viewer convenience only) ----------
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(`stage0.${k}`) ?? '';
    } catch {
      return '';
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`stage0.${k}`, v);
    } catch {
      // storage unavailable
    }
  },
};

// ---------- server health ----------
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const { config } = (await res.json()) as { config: { apiKey: boolean; voiceId: boolean; ttsModel: string } };
    $('health').textContent =
      `Server OK. INWORLD_API_KEY: ${config.apiKey ? 'set' : 'MISSING'}, ` +
      `INWORLD_VOICE_ID: ${config.voiceId ? 'set' : 'MISSING'}, file TTS model: ${config.ttsModel}`;
  } catch {
    $('health').textContent = 'Server is not reachable — run `npm run dev`.';
  }
}
void checkHealth();

// ---------- devices ----------
const player = new OutputPlayer();
const capture = new InputCapture();

function fillSelect(select: HTMLSelectElement, devices: MediaDeviceInfo[], key: string, allowNone = false) {
  const wanted = store.get(key);
  select.innerHTML = '';
  if (allowNone) select.add(new Option('— off —', ''));
  for (const d of devices) select.add(new Option(d.label || d.deviceId.slice(0, 8), d.deviceId));
  const match = devices.find((d) => d.label === wanted);
  if (match) select.value = match.deviceId;
  else if (!allowNone) {
    const bh = devices.find((d) => d.label.toLowerCase().includes(key === 'out' ? 'blackhole 2ch' : 'blackhole 16ch'));
    if (bh) select.value = bh.deviceId;
  }
}

async function refreshDevices() {
  const { inputs, outputs } = await listAudioDevices();
  fillSelect(sel('outDev'), outputs, 'out');
  fillSelect(sel('monDev'), outputs, 'mon', true);
  fillSelect(sel('inDev'), inputs, 'in');
  log(`devices: ${outputs.length} outputs [${outputs.map((d) => d.label).join(' | ')}]`);
  log(`devices: ${inputs.length} inputs [${inputs.map((d) => d.label).join(' | ')}]`);
  await applyOutput();
  await applyMonitor();
}

function labelOf(select: HTMLSelectElement) {
  return select.selectedOptions[0]?.textContent ?? '';
}

async function applyOutput() {
  const s = sel('outDev');
  if (!s.value) return;
  try {
    await player.setSink(s.value);
    store.set('out', labelOf(s));
    log(`agent output -> ${labelOf(s)}`);
  } catch (e) {
    log(`setSinkId failed: ${(e as Error).message}`);
  }
}

async function applyMonitor() {
  const s = sel('monDev');
  try {
    await player.setMonitor(s.value);
    store.set('mon', s.value ? labelOf(s) : '');
    log(`monitor -> ${s.value ? labelOf(s) : 'off'}`);
    if (s.value && labelOf(s).toLowerCase().includes('multi')) {
      log('WARNING: monitor on a Multi-Output device feeds the agent its own voice through BlackHole 16ch.');
    }
  } catch (e) {
    log(`monitor failed: ${(e as Error).message}`);
  }
}

$('refresh').onclick = async () => {
  try {
    await ensureDeviceLabels();
    await refreshDevices();
  } catch (e) {
    log(`device access failed: ${(e as Error).message}`);
  }
};
sel('outDev').onchange = () => void applyOutput();
sel('monDev').onchange = () => void applyMonitor();
sel('inDev').onchange = () => store.set('in', labelOf(sel('inDev')));
navigator.mediaDevices.addEventListener('devicechange', () => {
  log('EVENT devicechange (a device appeared or disappeared)');
  void refreshDevices();
});
player.ctx.onstatechange = () => log(`output AudioContext state: ${player.ctx.state}`);
void refreshDevices().catch(() => {});

// ---------- output test ----------
$('testSignal').onclick = () => {
  player.playTestSignal();
  log('test signal queued');
};

// ---------- input capture ----------
$('inStart').onclick = async () => {
  const s = sel('inDev');
  try {
    await capture.start(s.value);
    store.set('in', labelOf(s));
    const st = capture.settings;
    $('inSettings').textContent =
      `capturing ${labelOf(s)}: echoCancellation=${st?.echoCancellation}, noiseSuppression=${st?.noiseSuppression}, ` +
      `autoGainControl=${st?.autoGainControl}, channels=${st?.channelCount}, rate=${st?.sampleRate}`;
    log(`input capture started: ${$('inSettings').textContent}`);
  } catch (e) {
    log(`capture failed: ${(e as Error).message}`);
  }
};
$('inStop').onclick = () => {
  capture.stop();
  log('input capture stopped');
};

let echoPeak = 0;
let idlePeak = 0;
$('peakReset').onclick = () => {
  echoPeak = 0;
  idlePeak = 0;
};

// ---------- live session state ----------
const rt = new RealtimeClient();
let voiceId = '';
let listening = false;
let lastVoiceAt = 0;
let activeResponseId: string | undefined;
const cancelled = new Set<string>();
const audioSeen = new Set<string>();

interface Pending {
  kind: 'voice' | 'text';
  endAt: number;
  serverStoppedAt?: number;
}
let pending: Pending | undefined;

function sessionOptions(): SessionOptions {
  return {
    model: $<HTMLInputElement>('model').value.trim(),
    ttsModel: sel('ttsModel').value,
    voiceId,
    instructions: $<HTMLTextAreaElement>('instructions').value,
    turnMode: sel('turnMode').value as TurnMode,
    interruptResponse: $<HTMLInputElement>('interrupt').checked,
    eagerness: sel('eagerness').value as SessionOptions['eagerness'],
  };
}

capture.onChunk = (pcm) => {
  if (!rt.open) return;
  const mode = sel('turnMode').value as TurnMode;
  if (mode === 'vad-always' || listening) rt.appendAudio(int16ToBase64(pcm));
};

// ---------- input level summaries in the log (0.8) ----------
// Per agent playback: the loudest meeting input while the agent was playing (echo check).
// Per meeting voice burst while the agent is silent: duration and peak.
const ECHO_LIMIT_DB = -60;
let playPeak = -1; // < 0 means "agent not playing"
let burstStart = 0;
let burstPeak = 0;
let burstLastLoud = 0;
function trackInputForLog(inLevel: number, agentPlaying: boolean) {
  const now = performance.now();
  if (agentPlaying) {
    playPeak = Math.max(playPeak, inLevel, 0);
  } else if (playPeak >= 0) {
    const db = toDb(playPeak);
    const verdict = db < ECHO_LIMIT_DB ? 'OK, no echo' : 'ECHO: agent audio comes back to the meeting input';
    log(`echo check: meeting input peak while agent played ${Number.isFinite(db) ? db.toFixed(0) : '-inf'} dBFS (${verdict})`);
    playPeak = -1;
  }
  if (agentPlaying) return;
  if (inLevel > SPEECH_THRESHOLD) {
    if (!burstStart) burstStart = now;
    burstPeak = Math.max(burstPeak, inLevel);
    burstLastLoud = now;
  } else if (burstStart && now - burstLastLoud > 1000) {
    log(`meeting input: sound for ${((burstLastLoud - burstStart) / 1000).toFixed(1)} s, peak ${toDb(burstPeak).toFixed(0)} dBFS`);
    burstStart = 0;
    burstPeak = 0;
  }
}

// ---------- meters loop ----------
function meter(el: HTMLElement, dbEl: HTMLElement, level: number) {
  const db = toDb(level);
  const pct = Number.isFinite(db) ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) : 0;
  el.style.width = `${pct}%`;
  dbEl.textContent = Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : '-∞';
}
function tick() {
  const outLevel = player.level();
  meter($('outMeter'), $('outDb'), outLevel);
  if (capture.running) {
    const inLevel = capture.level();
    meter($('inMeter'), $('inDb'), inLevel);
    if (player.isPlaying) echoPeak = Math.max(echoPeak, inLevel);
    else idlePeak = Math.max(idlePeak, inLevel);
    trackInputForLog(inLevel, player.isPlaying);
    $('echoPeak').textContent = `${toDb(echoPeak).toFixed(0)} dBFS`;
    $('idlePeak').textContent = `${toDb(idlePeak).toFixed(0)} dBFS`;
    if (listening && inLevel > SPEECH_THRESHOLD) lastVoiceAt = performance.now();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- latency table ----------
const stopTimes: number[] = [];
const latencies: number[] = [];
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function recordLatency(p: Pending, firstChunkAt: number, firstSoundAt: number) {
  const n = latencies.length + 1;
  const sound = Math.round(firstSoundAt - p.endAt);
  latencies.push(sound);
  const row = document.createElement('tr');
  const server = p.serverStoppedAt ? String(Math.round(firstSoundAt - p.serverStoppedAt)) : '—';
  row.innerHTML = `<td>${n}</td><td>${p.kind}</td><td>${Math.round(firstChunkAt - p.endAt)}</td><td>${sound}</td><td>${server}</td>`;
  $('latRows').appendChild(row);
  $('latMedian').textContent = `${Math.round(median(latencies))} ms over ${latencies.length}`;
  log(`LATENCY #${n} (${p.kind}): end->first sound ${sound} ms`);
}
$('latReset').onclick = () => {
  latencies.length = 0;
  $('latRows').innerHTML = '';
  $('latMedian').textContent = '—';
};

// ---------- realtime events ----------
const NOISY = /\.delta$/;
rt.onEvent = (e) => {
  const type = e.type;
  if (!NOISY.test(type)) {
    const extra =
      type === 'error'
        ? ` ${JSON.stringify(e.error)}`
        : type === 'response.done'
          ? ` status=${(e.response as { status?: string })?.status} usage=${JSON.stringify((e.response as { usage?: unknown })?.usage)}`
          : '';
    log(`<- ${type}${extra}`);
  }
  switch (type) {
    case 'session.created':
      rt.updateSession(sessionOptions());
      log(`-> session.update (mode ${sel('turnMode').value}, voice set: ${Boolean(voiceId)})`);
      break;
    case 'session.updated': {
      const td = (e.session as { audio?: { input?: { turn_detection?: unknown } } })?.audio?.input?.turn_detection;
      log(`   server turn_detection now: ${JSON.stringify(td)}`);
      $('rtState').textContent = 'connected';
      break;
    }
    case 'input_audio_buffer.speech_stopped':
      if (sel('turnMode').value !== 'manual') {
        pending = { kind: 'voice', endAt: lastVoiceAt || performance.now(), serverStoppedAt: performance.now() };
      }
      break;
    case 'conversation.item.input_audio_transcription.completed':
      $('lastQ').textContent = String(e.transcript ?? '');
      break;
    case 'response.created': {
      activeResponseId = (e.response as { id?: string })?.id;
      $('lastA').textContent = '';
      break;
    }
    case 'response.output_audio.delta':
    case 'response.audio.delta': {
      const rid = String(e.response_id ?? activeResponseId ?? '');
      if (cancelled.has(rid)) return;
      const startsAt = player.enqueuePcm16(base64ToBytes(String(e.delta)));
      if (!audioSeen.has(rid)) {
        audioSeen.add(rid);
        if (pending) {
          recordLatency(pending, performance.now(), startsAt);
          pending = undefined;
        }
      }
      break;
    }
    case 'response.output_audio_transcript.delta':
    case 'response.output_text.delta':
      $('lastA').textContent += String(e.delta ?? '');
      break;
    case 'response.done': {
      const id = (e.response as { id?: string })?.id;
      if (id === activeResponseId) activeResponseId = undefined;
      break;
    }
  }
};
rt.onClose = (info) => {
  log(`realtime ${info}`);
  $('rtState').textContent = `disconnected (${info})`;
  setListening(false);
};

$('connect').onclick = async () => {
  try {
    $('rtState').textContent = 'minting token…';
    const res = await fetch('/api/realtime-token', { method: 'POST', cache: 'no-store' });
    const body = (await res.json()) as { token?: string; voiceId?: string; error?: string };
    if (!res.ok || !body.token) throw new Error(body.error ?? `token endpoint ${res.status}`);
    voiceId = body.voiceId ?? '';
    $('rtState').textContent = 'connecting…';
    await rt.connect(body.token);
    log('realtime websocket open');
    if (!capture.running) log('NOTE: input capture is off — start it in section 3 to send meeting audio.');
  } catch (e) {
    $('rtState').textContent = `error: ${(e as Error).message}`;
    log(`connect failed: ${(e as Error).message}`);
  }
};
$('disconnect').onclick = () => {
  rt.close();
  $('rtState').textContent = 'disconnected';
};

for (const id of ['turnMode', 'eagerness', 'interrupt']) {
  $(id).addEventListener('change', () => {
    setListening(false);
    if (!rt.open) return;
    rt.setTurnDetection(sessionOptions());
    log(`-> session.update turn_detection for mode ${sel('turnMode').value}`);
  });
}
for (const id of ['model', 'ttsModel', 'instructions']) {
  $(id).addEventListener('change', () => {
    if (!rt.open) return;
    rt.updateSession(sessionOptions());
    log('-> session.update (model / voice / instructions)');
  });
}

// ---------- Listen ----------
function setListening(on: boolean) {
  if (on === listening) return;
  const mode = sel('turnMode').value as TurnMode;
  listening = on;
  $('listen').classList.toggle('on', on);
  $('listen').textContent = on ? 'Listening… (click to close the question)' : 'Listen';
  if (!rt.open) return;
  if (on) {
    lastVoiceAt = 0;
    rt.clearInput();
    log(`LISTEN on (${mode})`);
  } else if (mode === 'manual') {
    rt.commit();
    rt.createResponse();
    pending = { kind: 'voice', endAt: lastVoiceAt || performance.now() };
    log('LISTEN off -> input_audio_buffer.commit + response.create');
  } else {
    log(`LISTEN off (${mode}); no more audio is sent`);
  }
}
$('listen').onclick = () => {
  if (!rt.open) return log('connect the live session first');
  if (!capture.running) return log('start input capture first (section 3)');
  setListening(!listening);
};

// ---------- Stop ----------
$('stop').onclick = () => {
  const pressedAt = performance.now();
  if (rt.open && activeResponseId) {
    cancelled.add(activeResponseId);
    rt.cancel(activeResponseId);
    log(`STOP -> response.cancel ${activeResponseId}`);
  }
  // Also drop late chunks of responses that already finished generating but are still queued.
  for (const id of audioSeen) cancelled.add(id);
  player.stop();
  pending = undefined;
  const wait = () => {
    if (player.level() < SILENCE_THRESHOLD) {
      const ms = Math.round(performance.now() - pressedAt);
      stopTimes.push(ms);
      $('stopInfo').textContent = `silent after ${ms} ms; all: [${stopTimes.join(', ')}]`;
      log(`STOP: output silent after ${ms} ms`);
    } else requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
};

// ---------- text question ----------
function ask() {
  const input = $<HTMLInputElement>('question');
  const text = input.value.trim();
  if (!text) return;
  if (!rt.open) return log('connect the live session first');
  rt.sendText(text);
  pending = { kind: 'text', endAt: performance.now() };
  $('lastQ').textContent = text;
  log(`-> input_text: ${text}`);
  input.value = '';
}
$('ask').onclick = ask;
$('question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ask();
});

$('speakSame').onclick = () => {
  if (!rt.open) return log('connect the live session first');
  pending = undefined;
  const text = $<HTMLTextAreaElement>('ttsText').value;
  rt.speak(text);
  log('-> response.speak (same text as file TTS)');
};

// ---------- file TTS ----------
let lastTts: AudioBuffer | undefined;
$('ttsPlay').onclick = async () => {
  const text = $<HTMLTextAreaElement>('ttsText').value;
  $('ttsInfo').textContent = 'synthesizing…';
  try {
    const started = performance.now();
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    lastTts = await player.ctx.decodeAudioData(data);
    player.enqueue(lastTts);
    const info =
      `${res.headers.get('X-Characters')} chars, synthesis ${res.headers.get('X-Synthesis-Ms')} ms, ` +
      `round trip ${Math.round(performance.now() - started)} ms, ${lastTts.duration.toFixed(1)} s audio`;
    $('ttsInfo').textContent = info;
    log(`file TTS: ${info}`);
  } catch (e) {
    $('ttsInfo').textContent = `error: ${(e as Error).message}`;
    log(`file TTS failed: ${(e as Error).message}`);
  }
};
$('ttsReplay').onclick = () => {
  if (lastTts) player.enqueue(lastTts);
  else log('nothing synthesized yet');
};

// ---------- soak ----------
let soakTimer: number | undefined;
let soakRunning = false;
$('soakStart').onclick = () => {
  if (!lastTts) return log('synthesize a TTS clip first (section 4)');
  if (soakRunning) return;
  soakRunning = true;
  const clip = lastTts;
  const startedAt = performance.now();
  const endAt = startedAt + 20 * 60 * 1000;
  let n = 0;
  let worstDrift = 0;
  log(`SOAK start: clip ${clip.duration.toFixed(1)} s, 20 min`);
  const once = () => {
    if (!soakRunning) return;
    if (performance.now() > endAt) {
      soakRunning = false;
      log(`SOAK done: ${n} plays, worst drift ${worstDrift} ms, ctx state ${player.ctx.state}`);
      return;
    }
    n++;
    const startsAt = player.enqueue(clip, () => {
      const drift = Math.round(performance.now() - (startsAt + clip.duration * 1000));
      worstDrift = Math.max(worstDrift, Math.abs(drift));
      const mins = ((performance.now() - startedAt) / 60000).toFixed(1);
      $('soakInfo').textContent = `${mins} min, ${n} plays, worst end drift ${worstDrift} ms, ctx ${player.ctx.state}`;
      if (n % 10 === 0) log(`SOAK ${mins} min: ${n} plays, worst drift ${worstDrift} ms, outputLatency ${(player.ctx.outputLatency * 1000).toFixed(0)} ms`);
      soakTimer = window.setTimeout(once, 1500);
    });
  };
  once();
};
$('soakStop').onclick = () => {
  soakRunning = false;
  window.clearTimeout(soakTimer);
  log('SOAK stopped');
};
