// Presentation state machine and the WebSocket messages between the server, the Stage
// (Slidev) and the Control window. Moved from the planning draft (.claude/context/interfaces.ts).
// Kept free of Node and browser APIs: all three sides import it.

export type SpeakerActivity = 'idle' | 'listening' | 'thinking' | 'speaking';

export type PresentationState =
  | 'setup'
  | 'ready'
  | 'presenting'
  | 'qa'
  | 'paused'
  | 'human_takeover'
  | 'finished';

export const TRANSITIONS: Record<PresentationState, readonly PresentationState[]> = {
  setup: ['ready'],
  ready: ['presenting', 'finished'],
  presenting: ['qa', 'paused', 'human_takeover', 'finished'],
  qa: ['presenting', 'paused', 'human_takeover', 'finished'],
  paused: ['presenting', 'qa', 'human_takeover', 'finished'],
  // One-way on purpose: after the author takes over, the agent stays silent.
  human_takeover: ['finished'],
  finished: [],
};

export function canTransition(from: PresentationState, to: PresentationState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Commands sent by the operator from the Control window. */
export type OperatorCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next_slide' }
  | { type: 'prev_slide' }
  | { type: 'go_to_slide'; slideId: string }
  | { type: 'open_qa' }
  | { type: 'listen'; on: boolean }
  | { type: 'ask_text'; question: string }
  | { type: 'skip_answer' }
  | { type: 'close_qa' }
  | { type: 'take_over' }
  | { type: 'finish' };

/**
 * The only actions the live model may request. The server checks each one
 * against the current state; the model never controls the app directly.
 */
export type ModelAction = { type: 'defer_to_author' } | { type: 'end_answer' };

export interface SlideRef {
  id: string;
  index: number;
  title: string;
}

/** Everything a window needs to render. The server sends it whole on every change. */
export interface Snapshot {
  talk: { title: string; lang: string; slides: SlideRef[] };
  state: PresentationState;
  /** Index into `talk.slides`. */
  slideIndex: number;
  speaker: { activity: SpeakerActivity; level: number };
  /** Number of Stage windows connected right now. */
  stages: number;
  /** URL of the Stage audience view, for links in the Control window. Set by `present`. */
  stageUrl?: string;
}

/** Server -> any window. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'go_to_slide'; slideId: string; index: number }
  | { type: 'speaker'; activity: SpeakerActivity; level: number }
  | { type: 'error'; message: string };

/** Window -> server. Each window says who it is first. */
export type ClientMessage =
  | { type: 'hello'; role: 'stage' | 'control' }
  | { type: 'command'; command: OperatorCommand }
  /** The Stage reports the slide it shows, for example after keyboard navigation. */
  | { type: 'stage_slide'; index: number };

export const WS_PATH = '/ws';
export const DEFAULT_SERVER_PORT = 8787;
