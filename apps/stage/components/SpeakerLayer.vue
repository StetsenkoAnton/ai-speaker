<!--
  First AvatarProvider implementation: a small waveform that follows the speaker's
  activity and output level. Bars react to `level` (0..1); colour shows the activity.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { SpeakerActivity } from '@ai-speaker/protocol'

const props = defineProps<{ activity: SpeakerActivity; level: number }>()

const BARS = 9
const phase = ref(0)
let raf = 0
const tick = () => {
  phase.value += 0.25
  raf = requestAnimationFrame(tick)
}
raf = requestAnimationFrame(tick)
onBeforeUnmount(() => cancelAnimationFrame(raf))

const heights = computed(() =>
  Array.from({ length: BARS }, (_, i) => {
    const shape = 0.55 + 0.45 * Math.sin(phase.value + i * 0.9)
    const base = props.activity === 'speaking' ? props.level : props.activity === 'idle' ? 0 : 0.15
    return Math.max(0.08, Math.min(1, base * shape))
  }),
)

const color = computed(() =>
  ({ speaking: '#2563eb', listening: '#16a34a', thinking: '#d97706', idle: '#9ca3af' })[props.activity],
)
</script>

<template>
  <div class="wave" :data-activity="activity" :title="`Speaker: ${activity}`">
    <span v-for="(h, i) in heights" :key="i" :style="{ height: `${h * 100}%`, background: color }" />
  </div>
</template>

<style scoped>
.wave {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 28px;
  padding: 4px 8px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.75);
}
.wave span {
  width: 4px;
  border-radius: 2px;
  transition: height 80ms linear;
}
</style>
