// Runs the talk: plays the audio of the current slide, moves to the next slide when it ends,
// says a closing phrase after the last slide and then waits for questions. The state machine
// in Presentation decides what is allowed; the conductor decides what plays.
import type { NowPlaying, OperatorCommand, ServerMessage } from '@ai-speaker/protocol';
import type { CommandResult, Presentation } from './presentation.ts';

export interface AudioClipRef {
  url: string;
  durationMs: number;
}

export interface ConductorDeps {
  presentation: Presentation;
  /** Rendered audio for a slide id, if any. */
  slideAudio(slideId: string): AudioClipRef | undefined;
  /** Rendered closing phrases. */
  closingAudio(): AudioClipRef[];
  /** Characters in a slide's script section, to hold a slide without audio for a while. */
  slideChars(slideId: string): number;
  /** Send to the player window. */
  toPlayer(message: ServerMessage): void;
  /** Something visible changed; `slideChanged` means the Stage must move. */
  changed(slideChanged: boolean): void;
  random?: () => number;
  /** Pause between the end of one slide's audio and the next slide. */
  gapMs?: number;
}

/** A slide with no rendered audio stays on screen as long as its text would take to say. */
const SILENT_CHARS_PER_SECOND = 15;
const MIN_SILENT_MS = 2000;

export class Conductor {
  private token = 0;
  private current?: { token: number } & NowPlaying;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly deps: ConductorDeps;

  constructor(deps: ConductorDeps) {
    this.deps = deps;
  }

  get playing(): NowPlaying | undefined {
    return this.current ? { kind: this.current.kind, slideId: this.current.slideId } : undefined;
  }

  private get p() {
    return this.deps.presentation;
  }

  command(command: OperatorCommand): CommandResult {
    const wasPresenting = this.p.state === 'presenting';
    const result = this.p.apply(command);
    if (!result.ok) return result;
    const presenting = this.p.state === 'presenting';
    const navigation = command.type === 'next_slide' || command.type === 'prev_slide' || command.type === 'go_to_slide';
    if (!presenting) this.silence();
    else if (!wasPresenting || (navigation && result.slideChanged)) this.playSlide();
    this.deps.changed(result.slideChanged);
    return result;
  }

  /** The Stage moved by itself (keyboard, presenter view). */
  followStage(index: number): CommandResult {
    const result = this.p.followStage(index);
    if (result.ok && result.slideChanged && this.p.state === 'presenting') this.playSlide();
    if (result.ok && result.slideChanged) this.deps.changed(true);
    return result;
  }

  audioEnded(token: number) {
    if (!this.current || token !== this.current.token) return;
    const finished = this.current;
    this.current = undefined;
    if (finished.kind === 'closing') {
      this.p.apply({ type: 'open_qa' });
      this.deps.changed(false);
      return;
    }
    if (this.p.state !== 'presenting') return;
    this.wait(this.deps.gapMs ?? 600, () => this.advance());
    this.deps.changed(false);
  }

  /** The player could not play: behave as if the clip ended, so the talk does not get stuck. */
  audioFailed(token: number) {
    this.audioEnded(token);
  }

  /** A new player window took over: whatever played in the old one is gone. */
  playerChanged() {
    if (this.p.state === 'presenting' && this.current?.kind === 'slide') this.playSlide();
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private advance() {
    const next = this.p.slideIndex + 1;
    if (next < this.p.talk.slides.length) {
      this.p.followStage(next);
      this.playSlide();
      this.deps.changed(true);
      return;
    }
    const phrases = this.deps.closingAudio();
    if (!phrases.length) {
      this.p.apply({ type: 'open_qa' });
      this.deps.changed(false);
      return;
    }
    const pick = phrases[Math.floor((this.deps.random ?? Math.random)() * phrases.length)] ?? phrases[0]!;
    this.play({ kind: 'closing' }, pick.url);
    this.deps.changed(false);
  }

  private playSlide() {
    this.silence();
    const slide = this.p.currentSlide;
    if (!slide) return;
    const audio = this.deps.slideAudio(slide.id);
    if (audio) return this.play({ kind: 'slide', slideId: slide.id }, audio.url);
    // No rendered audio: keep the slide up for a while, then go on as if it was spoken.
    const token = ++this.token;
    this.current = { token, kind: 'slide', slideId: slide.id };
    const ms = Math.max(MIN_SILENT_MS, (this.deps.slideChars(slide.id) / SILENT_CHARS_PER_SECOND) * 1000);
    this.wait(ms, () => this.audioEnded(token));
  }

  private play(what: NowPlaying, url: string) {
    const token = ++this.token;
    this.current = { token, ...what };
    this.deps.toPlayer({ type: 'play', token, url, kind: what.kind, ...(what.slideId ? { slideId: what.slideId } : {}) });
  }

  private silence() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.current) {
      this.current = undefined;
      this.deps.toPlayer({ type: 'stop' });
    }
  }

  private wait(ms: number, then: () => void) {
    clearTimeout(this.timer);
    this.timer = setTimeout(then, ms);
  }
}
