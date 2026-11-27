<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { OutputPlayer } from './audio.ts';
import { useOutputDevices } from './useOutputDevices.ts';
import { SampleRecorder, toBase64, toCloneWav } from './recording.ts';

interface Voice {
  voiceId: string;
  displayName: string;
  languageCode?: string;
  source?: string;
}

const player = new OutputPlayer();
const devices = useOutputDevices(player);
const status = ref<{ apiKey: boolean; voiceId: boolean; ttsModel: string; voiceIdValue: string }>();
const voices = ref<Voice[]>([]);
const voicesError = ref<string>();
const chosen = ref('');
const message = ref<string>();
const error = ref<string>();

const phrase = ref("Hi everyone, thanks for joining. Today I'll show you how a talk can be given by an agent in my own voice.");
const speaking = ref(false);

const recorder = new SampleRecorder();
const recording = ref(false);
const recordStarted = ref(0);
const elapsed = ref(0);
let tick: ReturnType<typeof setInterval> | undefined;
const sample = ref<{ wav: Uint8Array; seconds: number; url: string }>();
const cloneName = ref('My voice');
const cloneLang = ref('en-US');
const consent = ref(false);
const cloning = ref(false);
const cloneWarnings = ref<string[]>([]);

const MAX_SECONDS = 30;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/setup/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadStatus() {
  try {
    status.value = await api('status');
    chosen.value = status.value?.voiceIdValue ?? '';
  } catch (err) {
    error.value = `Server: ${(err as Error).message}. Is \`npm run setup\` or \`present\` running?`;
  }
}

async function loadVoices() {
  voicesError.value = undefined;
  try {
    const result = await api<{ voices: Voice[]; current: string }>('voices');
    voices.value = result.voices;
  } catch (err) {
    voicesError.value = (err as Error).message;
  }
}

async function say(voiceId?: string) {
  error.value = undefined;
  speaking.value = true;
  try {
    const res = await fetch('/api/setup/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: phrase.value, voiceId: voiceId || chosen.value || undefined }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
    message.value = `Test phrase: ${res.headers.get('X-Characters')} characters of TTS used.`;
    await player.ctx.resume();
    await player.playEncoded(await res.arrayBuffer());
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    speaking.value = false;
  }
}

async function useVoice(voiceId: string) {
  if (!confirm(`Write INWORLD_VOICE_ID=${voiceId} to .env? The next render and present use this voice.`)) return;
  try {
    await api('voice', { method: 'POST', body: JSON.stringify({ voiceId }) });
    chosen.value = voiceId;
    message.value = 'Saved to .env. Restart `present` to use it; `render` will re-render the talk in this voice.';
    await loadStatus();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function startRecording() {
  error.value = undefined;
  try {
    await recorder.start();
    recording.value = true;
    recordStarted.value = performance.now();
    elapsed.value = 0;
    tick = setInterval(() => {
      elapsed.value = (performance.now() - recordStarted.value) / 1000;
      if (elapsed.value >= MAX_SECONDS) void stopRecording();
    }, 200);
  } catch (err) {
    error.value = `Microphone: ${(err as Error).message}`;
  }
}

async function stopRecording() {
  clearInterval(tick);
  recording.value = false;
  const blob = await recorder.stop();
  await setSample(await blob.arrayBuffer());
}

async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) await setSample(await file.arrayBuffer());
}

async function setSample(data: ArrayBuffer) {
  try {
    const { wav, seconds } = await toCloneWav(data);
    if (sample.value) URL.revokeObjectURL(sample.value.url);
    sample.value = { wav, seconds, url: URL.createObjectURL(new Blob([wav.slice()], { type: 'audio/wav' })) };
  } catch (err) {
    error.value = `Cannot read this audio: ${(err as Error).message}`;
  }
}

async function clone() {
  if (!sample.value) return;
  error.value = undefined;
  cloning.value = true;
  cloneWarnings.value = [];
  try {
    const result = await api<{ voice: Voice; warnings: string[] }>('clone', {
      method: 'POST',
      body: JSON.stringify({
        displayName: cloneName.value,
        languageCode: cloneLang.value,
        consent: consent.value,
        audioBase64: toBase64(sample.value.wav),
      }),
    });
    cloneWarnings.value = result.warnings;
    message.value = `Voice cloned: ${result.voice.displayName} (${result.voice.voiceId}).`;
    await loadVoices();
    await useVoice(result.voice.voiceId);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    cloning.value = false;
  }
}

const sampleHint = computed(() => {
  const s = sample.value?.seconds ?? 0;
  if (!sample.value) return '';
  if (s < 3) return 'Too short: Inworld needs at least 3 seconds.';
  if (s < 10) return 'Works, but 10–30 seconds sound more like you.';
  return 'Good length.';
});

onMounted(() => {
  void loadStatus();
  void devices.refreshDevices();
});
onBeforeUnmount(() => {
  clearInterval(tick);
  void player.ctx.close();
});
</script>

<template>
  <main class="control setup">
    <h1>AI Speaker setup</h1>
    <p class="muted"><a href="/control">Control window</a></p>

    <section class="current">
      <h2>1. Inworld</h2>
      <p v-if="status" data-testid="setup-status">
        API key: <b :class="status.apiKey ? 'ok' : 'bad'">{{ status.apiKey ? 'set' : 'missing' }}</b> ·
        voice: <b :class="status.voiceId ? 'ok' : 'bad'">{{ status.voiceId ? 'chosen' : 'not chosen' }}</b> ·
        TTS model: <code>{{ status.ttsModel }}</code>
      </p>
      <p v-if="status && !status.apiKey" class="warn small">
        Add <code>INWORLD_API_KEY</code> to <code>.env</code> in the repository root (Inworld Portal → API Keys), then restart.
      </p>
    </section>

    <section class="audio">
      <h2>2. Devices</h2>
      <p v-if="!devices.supported" class="error">This browser cannot choose an output device. Open this page in Google Chrome.</p>
      <div class="row">
        <label>
          Output (meeting microphone)
          <select v-model="devices.output.value" @change="devices.applyOutput()">
            <option value="" disabled>Choose…</option>
            <option v-for="d in devices.outputs.value" :key="d.id" :value="d.id">{{ d.label }}</option>
          </select>
        </label>
        <label>
          Monitor (your headphones)
          <select v-model="devices.monitor.value" @change="devices.applyMonitor()">
            <option value="">off</option>
            <option v-for="d in devices.outputs.value" :key="d.id" :value="d.id">{{ d.label }}</option>
          </select>
        </label>
      </div>
      <div class="row">
        <button class="secondary" @click="devices.refreshDevices(true)">Show device names</button>
        <button class="secondary" @click="player.ctx.resume().then(() => player.playTestSignal())">Test signal</button>
      </div>
      <p class="muted small">The same choice is used by the Control window. Check the test signal on the phone in a Teams test call.</p>
    </section>

    <section class="audio">
      <h2>3. Voice</h2>
      <div class="row">
        <button class="secondary" @click="loadVoices()">Load my voices</button>
        <span v-if="voicesError" class="error small">{{ voicesError }}</span>
      </div>
      <ul v-if="voices.length" class="views">
        <li v-for="v in voices" :key="v.voiceId">
          <label class="inline">
            <input v-model="chosen" type="radio" :value="v.voiceId" />
            {{ v.displayName }} <span class="muted small">{{ v.languageCode }} · {{ v.source }}</span>
          </label>
          <span v-if="v.voiceId === status?.voiceIdValue" class="ok small"> current</span>
          <button v-else class="link small" @click="useVoice(v.voiceId)">use this voice</button>
        </li>
      </ul>
      <p v-else-if="!voicesError" class="muted small">Your cloned voices from Inworld appear here.</p>

      <h3>Test phrase</h3>
      <textarea v-model="phrase" rows="2" maxlength="300" />
      <div class="row">
        <button :disabled="speaking || !phrase.trim()" @click="say()">{{ speaking ? 'Synthesizing…' : 'Say it' }}</button>
        <span class="muted small">Uses Inworld TTS characters (free minutes are one-time).</span>
      </div>
    </section>

    <section class="audio">
      <h2>4. Clone your voice</h2>
      <p class="small">
        Read any text aloud for 10–30 seconds in a quiet room, in the language of your talks. You can clone
        <b>only your own voice</b>. Cloning needs an Inworld API key with <b>Write</b> access.
      </p>
      <div class="row">
        <button v-if="!recording" @click="startRecording()">● Record</button>
        <button v-else class="danger" @click="stopRecording()">■ Stop ({{ elapsed.toFixed(0) }} / {{ MAX_SECONDS }} s)</button>
        <label class="inline small">or a file: <input type="file" accept="audio/*" @change="chooseFile" /></label>
      </div>
      <div v-if="sample" class="row">
        <audio :src="sample.url" controls />
        <span class="small" :class="sample.seconds < 3 ? 'bad' : 'muted'">{{ sample.seconds.toFixed(1) }} s. {{ sampleHint }}</span>
      </div>
      <div class="row">
        <label>Voice name <input v-model="cloneName" type="text" /></label>
        <label>Language <input v-model="cloneLang" type="text" size="8" /></label>
      </div>
      <label class="inline small">
        <input v-model="consent" type="checkbox" data-testid="consent" />
        This is my own voice, and I agree to clone it.
      </label>
      <div class="row">
        <button :disabled="!sample || sample.seconds < 3 || !consent || cloning || !cloneName.trim()" @click="clone()">
          {{ cloning ? 'Cloning…' : 'Clone voice' }}
        </button>
      </div>
      <ul v-if="cloneWarnings.length" class="small warn">
        <li v-for="w in cloneWarnings" :key="w">{{ w }}</li>
      </ul>
    </section>

    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="error || devices.error.value" class="error" role="alert">{{ error ?? devices.error.value }}</p>
  </main>
</template>
