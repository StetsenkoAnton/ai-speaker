import { describe, expect, it } from 'vitest';
import { applyPronunciation, defaultPhrases, parsePhrases, parsePronunciation } from './speech.ts';

describe('pronunciation', () => {
  it('parses a map and reports bad entries', () => {
    const { value, issues } = parsePronunciation('Slidev: slide-dev\nVite: /viːt/\nEmpty: ""\nBad: /two words/\n');
    expect(value).toEqual([
      { term: 'Slidev', say: 'slide-dev' },
      { term: 'Vite', say: '/viːt/' },
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      '`Empty` needs a non-empty text to say.',
      '`Bad`: IPA in slashes works for one word only.',
    ]);
    expect(parsePronunciation('- a\n- b').issues[0]?.message).toMatch(/map/);
    expect(parsePronunciation('').value).toEqual([]);
  });

  it('replaces whole words, longest term first, case-sensitive', () => {
    const entries = [
      { term: 'Vite', say: '/viːt/' },
      { term: 'Vite plugin', say: 'veet plugin' },
      { term: 'npm', say: 'N P M' },
    ];
    expect(applyPronunciation('Vite and Vitest, a Vite plugin, npm, npmjs, vite.', entries)).toBe(
      '/viːt/ and Vitest, a veet plugin, N P M, npmjs, vite.',
    );
    expect(applyPronunciation('unchanged', [])).toBe('unchanged');
  });
});

describe('phrases', () => {
  it('has five built-in closing phrases for English, also for regional tags', () => {
    expect(defaultPhrases('en')?.closing).toHaveLength(5);
    expect(defaultPhrases('en-GB')).toBe(defaultPhrases('en'));
    expect(defaultPhrases('de')).toBeUndefined();
  });

  it('reads custom closing phrases', () => {
    expect(parsePhrases('closing:\n  - Thanks!\n  - Questions?\n').value).toEqual({ closing: ['Thanks!', 'Questions?'] });
    expect(parsePhrases('closing: nope').issues[0]?.message).toMatch(/list/);
    expect(parsePhrases('').value).toEqual({});
  });
});
