import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseSync } from '@slidev/parser/core';
import { parse as parseYaml } from 'yaml';
import { PHRASES_FILE, PRONUNCIATION_FILE, defaultPhrases, parsePhrases, parsePronunciation } from './speech.ts';
import type { KnowledgeDoc, ScriptSection, Slide, Talk, TalkBrief, ValidationIssue } from './types.ts';

export const TALK_FILES = {
  brief: 'brief.md',
  outline: 'outline.md',
  slides: 'slides.md',
  script: 'script.md',
  knowledge: 'knowledge',
} as const;

/** Parse result plus the problems found while reading. Parsing never throws on bad content. */
export interface Parsed<T> {
  value: T;
  issues: ValidationIssue[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** `brief.md`: YAML frontmatter (`title`, `lang`, `audience`, `durationMin`) and free-form notes. */
export function parseBrief(text: string): Parsed<TalkBrief> {
  const issues: ValidationIssue[] = [];
  const file = TALK_FILES.brief;
  const match = FRONTMATTER.exec(text);
  let data: Record<string, unknown> = {};
  if (!match) {
    issues.push({ severity: 'error', file, line: 1, message: 'Missing YAML frontmatter with `title` and `lang`.' });
  } else {
    try {
      const parsed: unknown = parseYaml(match[1] ?? '');
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch (err) {
      issues.push({ severity: 'error', file, line: 1, message: `Frontmatter is not valid YAML: ${(err as Error).message}` });
    }
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const duration = data.durationMin;
  const brief: TalkBrief = {
    title: str(data.title),
    lang: str(data.lang),
    notes: (match ? text.slice(match[0].length) : text).trim(),
  };
  if (str(data.audience)) brief.audience = str(data.audience);
  if (typeof duration === 'number' && duration > 0) brief.durationMin = duration;
  else if (duration !== undefined) {
    issues.push({ severity: 'error', file, line: 1, message: '`durationMin` must be a positive number of minutes.' });
  }
  return { value: brief, issues };
}

/** `slides.md`: Slidev Markdown. Split with Slidev's own parser so indexes match the Stage. */
export function parseSlides(text: string): Parsed<Slide[]> {
  const issues: ValidationIssue[] = [];
  const md = parseSync(text, TALK_FILES.slides);
  const slides = md.slides.map((s): Slide => {
    const fm = (s.frontmatter ?? {}) as Record<string, unknown>;
    const id = fm.id === undefined || fm.id === null ? '' : String(fm.id).trim();
    return { id, index: s.index, line: s.start + 1, frontmatter: fm, markdown: s.content };
  });
  return { value: slides, issues };
}

const SECTION = /^##\s+(.+?)\s*$/;

/**
 * `script.md`: one section per slide. A section starts with a `## <slide-id>` heading;
 * everything until the next such heading is what the speaker says. An optional `# Title`
 * line may come before the first section.
 */
export function parseScript(text: string): Parsed<ScriptSection[]> {
  const issues: ValidationIssue[] = [];
  const file = TALK_FILES.script;
  const sections: ScriptSection[] = [];
  const lines = text.split(/\r?\n/);
  let current: { slideId: string; line: number; body: string[] } | undefined;
  const flush = () => {
    if (current) sections.push({ slideId: current.slideId, line: current.line, text: current.body.join('\n').trim() });
  };
  lines.forEach((raw, i) => {
    const heading = SECTION.exec(raw);
    if (heading) {
      flush();
      current = { slideId: heading[1] ?? '', line: i + 1, body: [] };
    } else if (current) {
      current.body.push(raw);
    } else if (raw.trim() && !/^#\s/.test(raw)) {
      issues.push({ severity: 'warning', file, line: i + 1, message: 'Text before the first `## <slide-id>` section is ignored.' });
    }
  });
  flush();
  return { value: sections, issues };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function readKnowledge(dir: string): Promise<KnowledgeDoc[]> {
  const root = join(dir, TALK_FILES.knowledge);
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const docs: KnowledgeDoc[] = [];
  for (const entry of entries.sort()) {
    if (!/\.(md|txt)$/i.test(entry)) continue;
    const full = join(root, entry);
    docs.push({ path: relative(root, full), text: await readFile(full, 'utf8') });
  }
  return docs;
}

/** Read a talk folder from disk. Missing required files are reported as issues. */
export async function loadTalk(dir: string): Promise<Parsed<Talk>> {
  const issues: ValidationIssue[] = [];
  const read = async (name: string, required: boolean) => {
    const text = await readOptional(join(dir, name));
    if (text === undefined && required) issues.push({ severity: 'error', file: name, message: 'File is missing.' });
    return text ?? '';
  };
  const brief = parseBrief(await read(TALK_FILES.brief, true));
  const slides = parseSlides(await read(TALK_FILES.slides, true));
  const script = parseScript(await read(TALK_FILES.script, true));
  const pronunciation = parsePronunciation(await read(PRONUNCIATION_FILE, false));
  const phrases = parsePhrases(await read(PHRASES_FILE, false));
  issues.push(...brief.issues, ...slides.issues, ...script.issues, ...pronunciation.issues, ...phrases.issues);
  const closing = phrases.value.closing ?? defaultPhrases(brief.value.lang)?.closing ?? [];
  if (!closing.length && brief.value.lang) {
    issues.push({
      severity: 'warning',
      file: PHRASES_FILE,
      message: `No built-in closing phrases for \`${brief.value.lang}\`: add \`closing:\` to ${PHRASES_FILE}.`,
    });
  }
  const talk: Talk = {
    dir,
    brief: brief.value,
    outline: await read(TALK_FILES.outline, false),
    slides: slides.value,
    script: script.value,
    knowledge: await readKnowledge(dir),
    pronunciation: pronunciation.value,
    phrases: { closing },
  };
  return { value: talk, issues };
}
