// One WebSocket to the local server, shared by the Control page. Reconnects on its own.
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { WS_PATH, type ClientMessage, type OperatorCommand, type ServerMessage, type Snapshot } from '@ai-speaker/protocol';

export function useServer() {
  const connected = ref(false);
  const snapshot = shallowRef<Snapshot>();
  const lastError = ref<string>();
  let ws: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`);
    ws.onopen = () => {
      connected.value = true;
      ws?.send(JSON.stringify({ type: 'hello', role: 'control' } satisfies ClientMessage));
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      // Speaker levels arrive ten times a second; the Control page does not need them.
      if (message.type === 'snapshot') snapshot.value = message.snapshot;
      else if (message.type === 'error') lastError.value = message.message;
    };
    ws.onclose = () => {
      connected.value = false;
      if (!closed) retry = setTimeout(connect, 1000);
    };
  }

  function send(command: OperatorCommand) {
    lastError.value = undefined;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'command', command } satisfies ClientMessage));
  }

  onMounted(connect);
  onBeforeUnmount(() => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  });

  return { connected, snapshot, lastError, send };
}
