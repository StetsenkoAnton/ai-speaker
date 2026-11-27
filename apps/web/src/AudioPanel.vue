<script setup lang="ts">
import { computed } from 'vue';
import type { Snapshot } from '@ai-speaker/protocol';
import type { usePlayer } from './usePlayer.ts';
import { toDb } from './audio.ts';

const props = defineProps<{ player: ReturnType<typeof usePlayer>; snapshot: Snapshot }>();

const meter = computed(() => {
  const db = toDb(props.player.level.value);
  return Number.isFinite(db) ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) : 0;
});
const blackholeChosen = computed(() =>
  /blackhole 2ch/i.test(props.player.outputs.value.find((d) => d.id === props.player.output.value)?.label ?? ''),
);
const monitorIsMulti = computed(() =>
  /multi-output/i.test(props.player.outputs.value.find((d) => d.id === props.player.monitor.value)?.label ?? ''),
);
const audio = computed(() => props.snapshot.audio);
</script>

<template>
  <section class="audio" data-testid="audio">
    <h2>Audio</h2>
    <p v-if="!player.supported" class="error">
      This browser cannot send audio to a chosen device. Open this page in Google Chrome.
    </p>
    <p v-if="player.active.value" class="ok small" data-testid="player-role">This window plays the talk. Keep it open.</p>
    <p v-else class="muted small" data-testid="player-role">
      {{ snapshot.player ? 'Another Control window plays the talk.' : 'No player yet.' }}
    </p>

    <div class="row">
      <label>
        Output (meeting microphone)
        <select v-model="player.output.value" @change="player.applyOutput()">
          <option value="" disabled>Choose…</option>
          <option v-for="d in player.outputs.value" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
      </label>
      <label>
        Monitor (your headphones)
        <select v-model="player.monitor.value" @change="player.applyMonitor()">
          <option value="">off</option>
          <option v-for="d in player.outputs.value" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
      </label>
    </div>
    <p v-if="player.outputs.value.length && !blackholeChosen" class="warn small">
      Output is not BlackHole 2ch: the meeting will not hear the talk.
    </p>
    <p v-if="monitorIsMulti" class="warn small">
      Do not monitor through the Multi-Output device: the agent would hear itself. Pick your headphones.
    </p>

    <div class="row">
      <button class="secondary" @click="player.refreshDevices(true)">Show device names</button>
      <button class="secondary" @click="player.testSignal()">Test signal</button>
      <span class="meter"><span :style="{ width: `${meter}%` }" /></span>
      <span v-if="player.audioState.value !== 'running'" class="muted small">click anywhere to enable sound</span>
    </div>
    <p v-if="player.error.value" class="error small">{{ player.error.value }}</p>

    <p class="small" :class="audio.missing.length ? 'warn' : 'muted'" data-testid="audio-status">
      Rendered: {{ audio.slides.length }} of {{ audio.slides.length + audio.missing.length }} slides,
      {{ audio.closing }} closing phrase(s).
      <template v-if="audio.missing.length">
        Run <code>npm run render -- &lt;talk&gt;</code>; slides without audio stay up for their reading time.
      </template>
    </p>
  </section>
</template>
