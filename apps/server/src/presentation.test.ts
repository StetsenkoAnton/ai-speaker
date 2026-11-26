import { describe, expect, it } from 'vitest';
import { TRANSITIONS, type PresentationState } from '@ai-speaker/protocol';
import { Presentation } from './presentation.ts';

const talk = {
  title: 'Demo',
  lang: 'en',
  slides: [
    { id: 'intro', index: 0, title: 'Intro' },
    { id: 'code', index: 1, title: 'Code' },
    { id: 'outro', index: 2, title: 'Outro' },
  ],
};

function at(state: PresentationState): Presentation {
  const p = new Presentation(talk);
  p.state = state;
  return p;
}

describe('Presentation state machine', () => {
  it('starts in setup and becomes ready', () => {
    const p = new Presentation(talk);
    expect(p.state).toBe('setup');
    expect(p.apply({ type: 'start' }).ok).toBe(false);
    expect(p.markReady().ok).toBe(true);
    expect(p.apply({ type: 'start' })).toEqual({ ok: true, slideChanged: false });
    expect(p.state).toBe('presenting');
  });

  it('follows the transition table for every command', () => {
    const commands = {
      start: 'presenting',
      resume: 'presenting',
      close_qa: 'presenting',
      pause: 'paused',
      open_qa: 'qa',
      take_over: 'human_takeover',
      finish: 'finished',
    } as const;
    for (const from of Object.keys(TRANSITIONS) as PresentationState[]) {
      for (const [type, to] of Object.entries(commands)) {
        const p = at(from);
        const result = p.apply({ type } as { type: keyof typeof commands });
        const allowed = from === to || TRANSITIONS[from].includes(to);
        expect(result.ok, `${from} --${type}--> ${to}`).toBe(allowed);
        expect(p.state).toBe(allowed ? to : from);
      }
    }
  });

  it('keeps take-over one-way', () => {
    const p = at('human_takeover');
    expect(p.apply({ type: 'resume' }).ok).toBe(false);
    expect(p.apply({ type: 'open_qa' }).ok).toBe(false);
    expect(p.apply({ type: 'finish' }).ok).toBe(true);
  });
});

describe('Presentation slides', () => {
  it('moves forward and back within bounds', () => {
    const p = at('presenting');
    expect(p.apply({ type: 'prev_slide' })).toEqual({ ok: false, error: 'No such slide' });
    expect(p.apply({ type: 'next_slide' })).toEqual({ ok: true, slideChanged: true });
    expect(p.apply({ type: 'next_slide' })).toEqual({ ok: true, slideChanged: true });
    expect(p.apply({ type: 'next_slide' }).ok).toBe(false);
    expect(p.currentSlide?.id).toBe('outro');
  });

  it('jumps by slide id and follows the Stage', () => {
    const p = at('paused');
    expect(p.apply({ type: 'go_to_slide', slideId: 'code' })).toEqual({ ok: true, slideChanged: true });
    expect(p.apply({ type: 'go_to_slide', slideId: 'nope' }).ok).toBe(false);
    expect(p.followStage(0)).toEqual({ ok: true, slideChanged: true });
    expect(p.followStage(0)).toEqual({ ok: true, slideChanged: false });
  });

  it('does not move after the talk is finished', () => {
    expect(at('finished').apply({ type: 'next_slide' }).ok).toBe(false);
  });

  it('builds a snapshot', () => {
    const p = at('presenting');
    expect(p.snapshot(1)).toEqual({ talk, state: 'presenting', slideIndex: 0, speaker: { activity: 'idle', level: 0 }, stages: 1 });
  });
});
