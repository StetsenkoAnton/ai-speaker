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

/** Pre-rendered speech the server knows about. */
export interface AudioStatus {
  /** Slide ids whose script section has rendered audio. */
  slides: string[];
  /** Slide ids with a script section but no audio: run `render`. */
  missing: string[];
  /** Number of rendered closing phrases. */
  closing: number;
}

/** What the player is playing right now. */
export interface NowPlaying {
  kind: 'slide' | 'closing';
  slideId?: string;
}

/** Everything a window needs to render. The server sends it whole on every change. */
export interface Snapshot {
  talk: { title: string; lang: string; slides: SlideRef[] };
  audio: AudioStatus;
  /** True while a Control window acts as the player. */
  player: boolean;
  playing?: NowPlaying;
  state: PresentationState;
  /** Index into `talk.slides`. */
  slideIndex: number;
  speaker: { activity: SpeakerActivity; level: number };
  /** Number of Stage windows connected right now. */
  stages: number;
  /** URL of the Stage audience view, for links in the Control window. Set by `present`. */
  stageUrl?: string;
}

/** Server -> any window. `play`, `stop` and `player` go to Control windows only. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  /** Play this audio now, replacing anything that plays. `token` comes back in `audio_ended`. */
  | { type: 'play'; token: number; url: string; kind: NowPlaying['kind']; slideId?: string }
  | { type: 'stop' }
  /** Whether this Control window is the player. Only one window plays at a time. */
  | { type: 'player'; active: boolean }
  | { type: 'go_to_slide'; slideId: string; index: number }
  | { type: 'speaker'; activity: SpeakerActivity; level: number }
  | { type: 'error'; message: string };

/** Window -> server. Each window says who it is first. */
export type ClientMessage =
  | { type: 'hello'; role: 'stage' | 'control' }
  | { type: 'command'; command: OperatorCommand }
  /** The Stage reports the slide it shows, for example after keyboard navigation. */
  | { type: 'stage_slide'; index: number }
  /** From the player: the audio with this token finished playing (not when stopped). */
  | { type: 'audio_ended'; token: number }
  /** From the player: the audio with this token could not be played. */
  | { type: 'audio_failed'; token: number; message: string }
  /** From the player: output loudness 0..1, about 20 times a second while playing. */
  | { type: 'level'; level: number };

export const WS_PATH = '/ws';
export const DEFAULT_SERVER_PORT = 8787;
