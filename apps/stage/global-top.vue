<!--
  Global layer of the Stage window. Slidev renders it once, above every slide.
  It connects to the AI Speaker server, moves the deck when the server says so,
  reports navigation made in Slidev back, and draws the speaker layer.
  Docs: https://sli.dev/features/global-layers, https://sli.dev/guide/global-context
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNav } from '@slidev/client'
import type { ClientMessage, ServerMessage, SpeakerActivity } from '@ai-speaker/protocol'
import { DEFAULT_SERVER_PORT, WS_PATH } from '@ai-speaker/protocol'
import SpeakerLayer from './components/SpeakerLayer.vue'

const { go, currentSlideNo, isPresenter, isPrintMode } = useNav()

const connected = ref(false)
const activity = ref<SpeakerActivity>('idle')
const level = ref(0)

// Only the audience view talks to the server: presenter and print views also render this layer.
const enabled = !isPresenter.value && !isPrintMode.value

let ws: WebSocket | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let closed = false
// Slide number the server asked for; its echo from Slidev is not reported back.
let pendingNo: number | undefined

function serverUrl() {
  const params = new URLSearchParams(location.search)
  const port = params.get('server') ?? String(DEFAULT_SERVER_PORT)
  return `ws://${location.hostname}:${port}${WS_PATH}`
}

function send(message: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function connect() {
  ws = new WebSocket(serverUrl())
  ws.onopen = () => {
    connected.value = true
    send({ type: 'hello', role: 'stage' })
  }
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage
    if (message.type === 'go_to_slide') {
      const no = message.index + 1
      if (no !== currentSlideNo.value) {
        pendingNo = no
        void go(no)
      }
    } else if (message.type === 'speaker') {
      activity.value = message.activity
      level.value = message.level
    }
  }
  ws.onclose = () => {
    connected.value = false
    if (!closed) retry = setTimeout(connect, 1000)
  }
}

watch(currentSlideNo, (no) => {
  if (no === pendingNo) {
    pendingNo = undefined
    return
  }
  send({ type: 'stage_slide', index: no - 1 })
})

onMounted(() => {
  if (enabled) connect()
})
onBeforeUnmount(() => {
  closed = true
  clearTimeout(retry)
  ws?.close()
})
</script>

<template>
  <div v-if="enabled" class="ai-speaker-layer">
    <SpeakerLayer :activity="activity" :level="level" />
    <span v-if="!connected" class="ai-speaker-offline" title="Not connected to the AI Speaker server">offline</span>
  </div>
</template>

<style scoped>
.ai-speaker-layer {
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 100;
}
.ai-speaker-offline {
  font: 11px/1 system-ui, sans-serif;
  color: #b00;
  background: rgba(255, 255, 255, 0.8);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
