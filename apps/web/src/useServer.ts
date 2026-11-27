// One WebSocket to the local server, shared by the Control page. Reconnects on its own.
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { WS_PATH, type ClientMessage, type OperatorCommand, type ServerMessage, type Snapshot } from '@ai-speaker/protocol';

export type ServerConnection = ReturnType<typeof useServer>;

export function useServer() {
  const connected = ref(false);
  const snapshot = shallowRef<Snapshot>();
  const lastError = ref<string>();
  const listeners = new Set<(message: ServerMessage) => void>();
  let ws: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function post(message: ClientMessage) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`);
    ws.onopen = () => {
      connected.value = true;
      post({ type: 'hello', role: 'control' });
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'snapshot') snapshot.value = message.snapshot;
      else if (message.type === 'error') lastError.value = message.message;
      for (const listener of listeners) listener(message);
    };
    ws.onclose = () => {
      connected.value = false;
      for (const listener of listeners) listener({ type: 'player', active: false });
      if (!closed) retry = setTimeout(connect, 1000);
    };
  }

  function send(command: OperatorCommand) {
    lastError.value = undefined;
    post({ type: 'command', command });
  }

  /** Subscribe to every server message. Returns an unsubscribe function. */
  function onMessage(listener: (message: ServerMessage) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  onMounted(connect);
  onBeforeUnmount(() => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  });

  return { connected, snapshot, lastError, send, post, onMessage };
}
