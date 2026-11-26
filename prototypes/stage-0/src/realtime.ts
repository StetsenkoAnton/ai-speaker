// Minimal Inworld Realtime API client over WebSocket (OpenAI Realtime-compatible events).
// Docs checked 2026-11-26: https://docs.inworld.ai/realtime/connect/websocket.md

export type TurnMode =
  | 'manual' // turn_detection: null; Listen opens the buffer, releasing it commits (not documented)
  | 'vad-gated' // semantic_vad; audio is sent only while Listen is on
  | 'vad-always'; // semantic_vad; audio always sent (echo test only)

export interface SessionOptions {
  model: string;
  ttsModel: string;
  voiceId: string;
  instructions: string;
  turnMode: TurnMode;
  interruptResponse: boolean;
  eagerness: 'low' | 'medium' | 'high';
}

type ServerEvent = { type: string; [k: string]: unknown };

const URL_BASE = 'wss://api.inworld.ai/api/v1/realtime/session';

export function turnDetectionFor(opts: Pick<SessionOptions, 'turnMode' | 'interruptResponse' | 'eagerness'>) {
  if (opts.turnMode === 'manual') return null;
  return {
    type: 'semantic_vad',
    eagerness: opts.eagerness,
    create_response: true,
    interrupt_response: opts.interruptResponse,
  };
}

export class RealtimeClient {
  private ws?: WebSocket;
  onEvent: (e: ServerEvent) => void = () => {};
  onClose: (info: string) => void = () => {};

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(token: string): Promise<void> {
    this.close();
    const url = `${URL_BASE}?key=${encodeURIComponent(crypto.randomUUID())}&protocol=realtime`;
    // Browsers cannot set Authorization headers on WebSockets; Inworld accepts the
    // token as a "bearer_<token>" subprotocol instead (never put it in the URL).
    const ws = new WebSocket(url, [`bearer_${token}`]);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error (see console / network tab)'));
      ws.onclose = (e) => {
        this.onClose(`closed code=${e.code}${e.reason ? ` reason=${e.reason}` : ''}`);
        reject(new Error(`WebSocket closed before open (code ${e.code})`));
      };
      ws.onmessage = (msg) => {
        try {
          this.onEvent(JSON.parse(msg.data as string));
        } catch {
          // ignore non-JSON frames
        }
      };
    });
  }

  send(event: Record<string, unknown>) {
    if (!this.open) throw new Error('Realtime session is not connected');
    this.ws!.send(JSON.stringify(event));
  }

  updateSession(opts: SessionOptions) {
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: opts.model,
        instructions: opts.instructions,
        output_modalities: ['audio', 'text'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: turnDetectionFor(opts),
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: opts.voiceId,
            model: opts.ttsModel,
          },
        },
      },
    });
  }

  setTurnDetection(opts: Pick<SessionOptions, 'turnMode' | 'interruptResponse' | 'eagerness'>) {
    this.send({ type: 'session.update', session: { audio: { input: { turn_detection: turnDetectionFor(opts) } } } });
  }

  appendAudio(base64: string) {
    this.send({ type: 'input_audio_buffer.append', audio: base64 });
  }

  clearInput() {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  commit() {
    this.send({ type: 'input_audio_buffer.commit' });
  }

  createResponse() {
    this.send({ type: 'response.create' });
  }

  cancel(responseId?: string) {
    this.send(responseId ? { type: 'response.cancel', response_id: responseId } : { type: 'response.cancel' });
  }

  sendText(text: string) {
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    });
    this.createResponse();
  }

  /** Speak exact text in the session voice, no LLM. Used to compare timbre with file TTS. */
  speak(text: string) {
    this.send({ type: 'response.speak', text });
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = undefined;
  }
}
