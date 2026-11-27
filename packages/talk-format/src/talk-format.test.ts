import { describe, expect, it } from 'vitest';
import { parseBrief, parseScript, parseSlides } from './parse.ts';
import { formatIssue, hasErrors, validateTalk } from './validate.ts';
import type { Talk } from './types.ts';

const BRIEF = `---
title: Demo talk
lang: en
audience: JS developers
durationMin: 10
---

Keep it light.
`;

const SLIDES = `---
theme: default
id: intro
---

# Hello

---
id: code
layout: center
---

## Code
`;

const SCRIPT = `# Script

## intro

Hi everyone.

## code

Here is some code.
`;

function talk(slides = SLIDES, script = SCRIPT, brief = BRIEF): Talk {
  return {
    dir: '/tmp/demo',
    brief: parseBrief(brief).value,
    outline: '',
    slides: parseSlides(slides).value,
    script: parseScript(script).value,
    knowledge: [],
    pronunciation: [],
    phrases: { closing: ['Questions?'] },
  };
}

describe('parseBrief', () => {
  it('reads frontmatter and notes', () => {
    const { value, issues } = parseBrief(BRIEF);
    expect(issues).toEqual([]);
    expect(value).toEqual({ title: 'Demo talk', lang: 'en', audience: 'JS developers', durationMin: 10, notes: 'Keep it light.' });
  });

  it('reports missing frontmatter and a bad duration', () => {
    expect(parseBrief('just text').issues[0]?.message).toMatch(/frontmatter/);
    expect(parseBrief('---\ntitle: x\nlang: en\ndurationMin: soon\n---\n').issues[0]?.message).toMatch(/durationMin/);
  });
});

describe('parseSlides', () => {
  it('splits like Slidev and keeps ids, lines and frontmatter', () => {
    const slides = parseSlides(SLIDES).value;
    expect(slides.map((s) => [s.id, s.index, s.line])).toEqual([
      ['intro', 0, 1],
      ['code', 1, 8],
    ]);
    expect(slides[1]?.frontmatter.layout).toBe('center');
    expect(slides[1]?.markdown).toBe('## Code');
  });
});

describe('parseScript', () => {
  it('splits sections by `## id` headings', () => {
    const { value, issues } = parseScript(SCRIPT);
    expect(issues).toEqual([]);
    expect(value).toEqual([
      { slideId: 'intro', line: 3, text: 'Hi everyone.' },
      { slideId: 'code', line: 7, text: 'Here is some code.' },
    ]);
  });

  it('warns about text before the first section', () => {
    expect(parseScript('stray\n## intro\nhi').issues[0]?.line).toBe(1);
  });
});

describe('validateTalk', () => {
  it('accepts a consistent talk', () => {
    expect(validateTalk(talk())).toEqual([]);
  });

  it('requires title and a valid lang', () => {
    const issues = validateTalk(talk(SLIDES, SCRIPT, '---\nlang: english\n---\n'));
    expect(issues.map((i) => i.message)).toEqual([
      '`title` is required.',
      '`lang: english` is not a BCP-47 language tag.',
    ]);
  });

  it('finds slides without ids, bad and duplicate ids', () => {
    const slides = `---\nid: intro\n---\n# A\n\n---\nid: Intro_2\n---\n# B\n\n---\nid: intro\n---\n# C\n\n---\n\n# D\n`;
    const messages = validateTalk(talk(slides, '## intro\nhi\n## Intro_2\nhi\n')).map(formatIssue);
    expect(messages).toContain('slides.md:6 error: Slide id `Intro_2` must use lowercase letters, digits and dashes.');
    expect(messages).toContain('slides.md:11 error: Slide id `intro` is already used on line 1.');
    expect(messages.some((m) => m.includes('Slide 4 has no `id`'))).toBe(true);
  });

  it('matches slides and script sections both ways', () => {
    const issues = validateTalk(talk(SLIDES, '## intro\nhi\n## intro\nagain\n## outro\nbye\n## code\n'));
    expect(issues.map((i) => [i.severity, i.slideId, i.message])).toEqual([
      ['error', 'intro', 'Section `intro` is already defined on line 1.'],
      ['error', 'outro', 'Section `outro` has no slide with this id in slides.md.'],
      ['warning', 'code', 'Section `code` is empty.'],
    ]);
    const missing = validateTalk(talk(SLIDES, '## intro\nhi\n'));
    expect(missing.map(formatIssue)).toEqual(['slides.md:8 error: Slide `code` has no `## code` section in script.md.']);
    expect(hasErrors(missing)).toBe(true);
  });
});
