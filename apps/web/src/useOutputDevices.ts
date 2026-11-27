// Output and monitor device choice for an OutputPlayer, remembered between sessions.
// Shared by the Control window (the talk player) and /setup (test phrases).
import { ref } from 'vue';
import { canChooseOutput, ensureDeviceLabels, listAudioDevices, type OutputPlayer } from './audio.ts';

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(`ai-speaker.${key}`) ?? '';
    } catch {
      return '';
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`ai-speaker.${key}`, value);
    } catch {
      // storage unavailable: the choice is not remembered
    }
  },
};

export interface DeviceOption {
  id: string;
  label: string;
}

export function useOutputDevices(player: OutputPlayer) {
  const supported = canChooseOutput();
  const outputs = ref<DeviceOption[]>([]);
  const output = ref('');
  const monitor = ref('');
  const error = ref<string>();

  const labelOf = (id: string) => outputs.value.find((d) => d.id === id)?.label ?? '';

  async function applyOutput() {
    if (!supported || !output.value) return;
    try {
      await player.setSink(output.value);
      store.set('output', labelOf(output.value));
      error.value = undefined;
    } catch (err) {
      error.value = `Cannot use this output: ${(err as Error).message}`;
    }
  }

  async function applyMonitor() {
    if (!supported) return;
    try {
      await player.setMonitor(monitor.value);
      store.set('monitor', monitor.value ? labelOf(monitor.value) : '');
    } catch (err) {
      error.value = `Cannot use this monitor: ${(err as Error).message}`;
    }
  }

  async function refreshDevices(askPermission = false) {
    try {
      if (askPermission) await ensureDeviceLabels();
      const { outputs: list } = await listAudioDevices();
      outputs.value = list.map((d) => ({ id: d.deviceId, label: d.label || 'Unnamed device' }));
      // Devices are remembered by label: ids change between browser sessions.
      const byLabel = (label: string) => (label ? (outputs.value.find((d) => d.label === label)?.id ?? '') : '');
      const blackhole = outputs.value.find((d) => /blackhole 2ch/i.test(d.label))?.id ?? '';
      if (!output.value) output.value = byLabel(store.get('output')) || blackhole;
      if (!monitor.value) monitor.value = byLabel(store.get('monitor'));
      await applyOutput();
      await applyMonitor();
    } catch (err) {
      error.value = `Device access failed: ${(err as Error).message}`;
    }
  }

  return { supported, outputs, output, monitor, error, refreshDevices, applyOutput, applyMonitor };
}
