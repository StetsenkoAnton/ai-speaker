// Presentation state: the state machine plus the current slide. Pure logic, no I/O,
// so every transition is covered by unit tests.
import {
  canTransition,
  type OperatorCommand,
  type PresentationState,
  type SlideRef,
  type Snapshot,
  type SpeakerActivity,
} from '@ai-speaker/protocol';

export type CommandResult = { ok: true; slideChanged: boolean } | { ok: false; error: string };

export class Presentation {
  state: PresentationState = 'setup';
  slideIndex = 0;
  speaker: { activity: SpeakerActivity; level: number } = { activity: 'idle', level: 0 };
  readonly talk: Snapshot['talk'];

  constructor(talk: { title: string; lang: string; slides: SlideRef[] }) {
    this.talk = talk;
  }

  /** The talk is loaded and valid: the operator may start. */
  markReady(): CommandResult {
    return this.transition('ready');
  }

  snapshot(stages: number): Snapshot {
    return { talk: this.talk, state: this.state, slideIndex: this.slideIndex, speaker: { ...this.speaker }, stages };
  }

  get currentSlide(): SlideRef | undefined {
    return this.talk.slides[this.slideIndex];
  }

  apply(command: OperatorCommand): CommandResult {
    switch (command.type) {
      case 'start':
        return this.transition('presenting');
      case 'pause':
        return this.transition('paused');
      case 'resume':
        return this.transition('presenting');
      case 'open_qa':
        return this.transition('qa');
      case 'close_qa':
        return this.transition('presenting');
      case 'take_over':
        return this.transition('human_takeover');
      case 'finish':
        return this.transition('finished');
      case 'next_slide':
        return this.goTo(this.slideIndex + 1);
      case 'prev_slide':
        return this.goTo(this.slideIndex - 1);
      case 'go_to_slide': {
        const index = this.talk.slides.findIndex((s) => s.id === command.slideId);
        if (index < 0) return { ok: false, error: `No slide with id "${command.slideId}"` };
        return this.goTo(index);
      }
      case 'listen':
      case 'ask_text':
      case 'skip_answer':
        // Live Q&A arrives at stage 4.
        return { ok: false, error: `"${command.type}" is not available yet` };
    }
  }

  /** The Stage moved on its own (keyboard, click). Follow it unless navigation is locked. */
  followStage(index: number): CommandResult {
    return this.goTo(index);
  }

  private transition(to: PresentationState): CommandResult {
    if (this.state === to) return { ok: true, slideChanged: false };
    if (!canTransition(this.state, to)) return { ok: false, error: `Cannot go from "${this.state}" to "${to}"` };
    this.state = to;
    return { ok: true, slideChanged: false };
  }

  private goTo(index: number): CommandResult {
    if (this.state === 'finished') return { ok: false, error: 'The talk is finished' };
    if (index < 0 || index >= this.talk.slides.length) return { ok: false, error: 'No such slide' };
    const slideChanged = index !== this.slideIndex;
    this.slideIndex = index;
    return { ok: true, slideChanged };
  }
}
