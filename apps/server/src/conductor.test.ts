import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@ai-speaker/protocol';
import { Conductor, type AudioClipRef } from './conductor.ts';
import { Presentation } from './presentation.ts';

const talk = {
  title: 'Demo',
  lang: 'en',
  slides: [
    { id: 'a', index: 0, title: 'A' },
    { id: 'b', index: 1, title: 'B' },
    { id: 'c', index: 2, title: 'C' },
  ],
};

function setup(options: { audio?: Record<string, AudioClipRef>; closing?: AudioClipRef[]; chars?: number } = {}) {
  const p = new Presentation(talk);
  p.markReady();
  const sent: ServerMessage[] = [];
  const changes: boolean[] = [];
  const audio = options.audio ?? { a: { url: '/a', durationMs: 1000 }, b: { url: '/b', durationMs: 1000 }, c: { url: '/c', durationMs: 1000 } };
  const c = new Conductor({
    presentation: p,
    slideAudio: (id) => audio[id],
    closingAudio: () => options.closing ?? [{ url: '/end0', durationMs: 1 }, { url: '/end1', durationMs: 1 }],
    slideChars: () => options.chars ?? 60,
    toPlayer: (m) => sent.push(m),
    changed: (slideChanged) => changes.push(slideChanged),
    random: () => 0.99,
    gapMs: 500,
  });
  const lastPlay = () => [...sent].reverse().find((m) => m.type === 'play') as Extract<ServerMessage, { type: 'play' }> | undefined;
  return { p, c, sent, changes, lastPlay };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Conductor', () => {
  it('plays the talk to the end, says a closing phrase and waits for questions', () => {
    const { p, c, lastPlay } = setup();
    c.command({ type: 'start' });
    expect(lastPlay()).toMatchObject({ url: '/a', kind: 'slide', slideId: 'a' });

    c.audioEnded(lastPlay()!.token);
    expect(p.slideIndex).toBe(0); // the gap between slides
    vi.advanceTimersByTime(500);
    expect(p.slideIndex).toBe(1);
    expect(lastPlay()).toMatchObject({ url: '/b', slideId: 'b' });

    c.audioEnded(lastPlay()!.token);
    vi.advanceTimersByTime(500);
    c.audioEnded(lastPlay()!.token);
    vi.advanceTimersByTime(500);
    expect(lastPlay()).toMatchObject({ url: '/end1', kind: 'closing' });
    expect(p.state).toBe('presenting');

    c.audioEnded(lastPlay()!.token);
    expect(p.state).toBe('qa');
    expect(c.playing).toBeUndefined();
  });

  it('ignores the end of audio that was replaced or stopped', () => {
    const { p, c, lastPlay } = setup();
    c.command({ type: 'start' });
    const old = lastPlay()!.token;
    c.command({ type: 'next_slide' });
    expect(lastPlay()).toMatchObject({ slideId: 'b' });
    c.audioEnded(old);
    vi.advanceTimersByTime(5000);
    expect(p.slideIndex).toBe(1);
  });

  it('stops on pause and replays the slide on resume', () => {
    const { p, c, sent, lastPlay } = setup();
    c.command({ type: 'start' });
    const token = lastPlay()!.token;
    c.command({ type: 'pause' });
    expect(sent.at(-1)).toEqual({ type: 'stop' });
    c.audioEnded(token);
    vi.advanceTimersByTime(5000);
    expect(p.slideIndex).toBe(0);
    c.command({ type: 'resume' });
    expect(lastPlay()).toMatchObject({ slideId: 'a' });
    expect(lastPlay()!.token).toBeGreaterThan(token);
  });

  it('moves without playing while paused, and plays the new slide while presenting', () => {
    const { c, sent, lastPlay } = setup();
    c.command({ type: 'start' });
    c.command({ type: 'pause' });
    const before = sent.length;
    c.command({ type: 'next_slide' });
    expect(sent.length).toBe(before);
    c.command({ type: 'resume' });
    expect(lastPlay()).toMatchObject({ slideId: 'b' });
    c.followStage(2);
    expect(lastPlay()).toMatchObject({ slideId: 'c' });
  });

  it('holds a slide without audio for its reading time', () => {
    const { p, c, lastPlay } = setup({ audio: { b: { url: '/b', durationMs: 1 } }, chars: 75 });
    c.command({ type: 'start' });
    expect(lastPlay()).toBeUndefined();
    vi.advanceTimersByTime(4999);
    expect(p.slideIndex).toBe(0);
    vi.advanceTimersByTime(1 + 500);
    expect(p.slideIndex).toBe(1);
    expect(lastPlay()).toMatchObject({ slideId: 'b' });
  });

  it('goes straight to questions when there are no closing phrases', () => {
    const { p, c, lastPlay } = setup({ closing: [] });
    c.command({ type: 'start' });
    c.command({ type: 'go_to_slide', slideId: 'c' });
    c.audioEnded(lastPlay()!.token);
    vi.advanceTimersByTime(500);
    expect(p.state).toBe('qa');
  });

  it('stops audio on finish and take-over', () => {
    const { c, sent } = setup();
    c.command({ type: 'start' });
    c.command({ type: 'take_over' });
    expect(sent.at(-1)).toEqual({ type: 'stop' });
  });
});
