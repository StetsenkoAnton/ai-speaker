// Provider contracts. Moved from the planning draft (.claude/context/interfaces.ts) at stage 1.
// Implementations live next to this file, one folder per provider (see ./inworld).
import type { SpeakerActivity } from '@ai-speaker/protocol';
import type { Lang } from '@ai-speaker/talk-format';

export type { SpeakerActivity };

// ---------------------------------------------------------------------------
// LLM: used offline to generate the outline, slides and script
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/** First implementation: any OpenAI-compatible endpoint (base URL + key from `.env`). */
export interface LLMProvider {
  readonly id: string;
  complete(request: LLMRequest): Promise<string>;
}

// ---------------------------------------------------------------------------
// Voice: cloning and pre-rendering the talk
// ---------------------------------------------------------------------------

export interface VoiceRef {
  provider: string;
  voiceId: string;
  lang: Lang;
}

export interface AudioClip {
  data: Uint8Array;
  mimeType: string;
  durationMs: number;
}

/** First implementation: Inworld TTS-2, the same model the live answers use. */
export interface VoiceProvider {
  readonly id: string;
  /** Languages this provider can speak, or "any". Checked before `present`. */
  readonly languages: readonly Lang[] | 'any';
  cloneVoice(request: { name: string; lang: Lang; samples: Uint8Array[] }): Promise<VoiceRef>;
  listVoices(): Promise<VoiceRef[]>;
  deleteVoice(voice: VoiceRef): Promise<void>;
  synthesize(request: { text: string; voice: VoiceRef; signal?: AbortSignal }): Promise<AudioClip>;
}

// ---------------------------------------------------------------------------
// Live agent: answers questions during Q&A
// ---------------------------------------------------------------------------

export interface LiveAgentConfig {
  voice: VoiceRef;
  lang: Lang;
  /** Answer rules: short, on topic, defer to the author when unsure. */
  instructions: string;
  /** Outline, script and knowledge files, sent on every session start. */
  context: string;
  maxAnswerSeconds: number;
}

export type LiveAgentEvent =
  | { type: 'activity'; activity: SpeakerActivity }
  | { type: 'transcript'; role: 'participant' | 'agent'; text: string; final: boolean }
  | { type: 'audio'; chunk: Uint8Array; sampleRate: number }
  | { type: 'answer_done' }
  | { type: 'error'; message: string; recoverable: boolean };

export interface LiveAgentSession {
  /** Feed participant audio. The caller sends audio only while "Listen" is on. */
  pushAudio(chunk: Uint8Array): void;
  /** Close the participant's turn explicitly, for example when "Listen" is released. */
  endTurn(): void;
  /** Fallback when audio fails: ask a typed question. */
  askText(question: string): void;
  /** Stop the current answer at once ("Skip" and "Take over"). */
  cancel(): void;
  /** Subscribe to session events. Returns an unsubscribe function. */
  on(listener: (event: LiveAgentEvent) => void): () => void;
  close(): Promise<void>;
}

/**
 * First implementation: Inworld Realtime API (OpenAI Realtime protocol).
 * Planned fallbacks: ElevenLabs agents, and a hand-built STT -> LLM -> TTS chain.
 */
export interface LiveAgentProvider {
  readonly id: string;
  connect(config: LiveAgentConfig): Promise<LiveAgentSession>;
}

// ---------------------------------------------------------------------------
// Avatar: only the contract for now; how it is shown is undecided
// ---------------------------------------------------------------------------

/** First implementation: an audio waveform drawn in a layer above the slides. */
export interface AvatarProvider {
  readonly id: string;
  setActivity(activity: SpeakerActivity): void;
  /** Output loudness in the range 0..1, for mouth or waveform animation. */
  setLevel(level: number): void;
  dispose(): void;
}
