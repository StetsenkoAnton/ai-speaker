// The talk player. Runs in the Control window the server picked as the player: plays what the
// server says into the chosen output (BlackHole 2ch), mirrors it to the monitor, and reports
// the end of each clip and the output level back.
import { onBeforeUnmount, ref } from 'vue';
import type { ServerMessage } from '@ai-speaker/protocol';
import { OutputPlayer } from './audio.ts';
import { useOutputDevices } from './useOutputDevices.ts';
import type { ServerConnection } from './useServer.ts';

const LEVEL_INTERVAL_MS = 50;

export function usePlayer(server: ServerConnection) {
  const player = new OutputPlayer();
  const devices = useOutputDevices(player);
  const active = ref(false);
  const level = ref(0);
  const audioState = ref(player.ctx.state);
  const error = devices.error;
  let current: number | undefined;
  let loading = 0;

  player.ctx.onstatechange = () => (audioState.value = player.ctx.state);

  /** Browsers start audio only after a click on the page. */
  function unlock() {
    if (player.ctx.state !== 'running') void player.ctx.resume();
  }

  async function play(message: Extract<ServerMessage, { type: 'play' }>) {
    const ticket = ++loading;
    player.stop();
    current = undefined;
    try {
      const res = await fetch(message.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await player.ctx.decodeAudioData(await res.arrayBuffer());
      if (ticket !== loading) return; // replaced or stopped while loading
      unlock();
      current = message.token;
      player.enqueue(buffer, () => {
        if (current !== message.token) return;
        current = undefined;
        server.post({ type: 'audio_ended', token: message.token });
      });
    } catch (err) {
      if (ticket !== loading) return;
      error.value = `Cannot play ${message.slideId ?? message.kind}: ${(err as Error).message}`;
      server.post({ type: 'audio_failed', token: message.token, message: (err as Error).message });
    }
  }

  function stop() {
    loading++;
    current = undefined;
    player.stop();
  }

  const off = server.onMessage((message) => {
    if (message.type === 'player') {
      active.value = message.active;
      if (!message.active) stop();
    } else if (!active.value) {
      return;
    } else if (message.type === 'play') {
      void play(message);
    } else if (message.type === 'stop') {
      stop();
    }
  });

  const levelTimer = setInterval(() => {
    level.value = player.level();
    if (active.value && current !== undefined) server.post({ type: 'level', level: Math.min(1, level.value * 3) });
  }, LEVEL_INTERVAL_MS);

  navigator.mediaDevices?.addEventListener('devicechange', () => void devices.refreshDevices());
  document.addEventListener('pointerdown', unlock);
  void devices.refreshDevices();

  onBeforeUnmount(() => {
    off();
    clearInterval(levelTimer);
    document.removeEventListener('pointerdown', unlock);
    stop();
    void player.ctx.close();
  });

  return {
    ...devices,
    active,
    level,
    audioState,
    testSignal: () => {
      unlock();
      player.playTestSignal();
    },
  };
}
