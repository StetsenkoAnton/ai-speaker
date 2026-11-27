// What the talk says besides the script: pronunciation fixes and prepared phrases.
import { parse as parseYaml } from 'yaml';
import type { Lang, ValidationIssue } from './types.ts';

export interface PronunciationEntry {
  /** Text as written in the script, matched as whole words, case-sensitive. */
  term: string;
  /** What the voice should read instead: a respelling, or IPA for one word in slashes (/viːt/). */
  say: string;
}

export interface TalkPhrases {
  /** Said after the last slide, before the talk waits for questions. One is picked at random. */
  closing: string[];
}

export const PRONUNCIATION_FILE = 'pronunciation.yaml';
export const PHRASES_FILE = 'phrases.yaml';

/** Built-in phrases per language. A talk can replace them with its own `phrases.yaml`. */
export const DEFAULT_PHRASES: Record<string, TalkPhrases> = {
  en: {
    closing: [
      "That's the end of the talk. Thank you! I'm happy to take your questions now.",
      "And that's all I had for today. Thanks for listening! What would you like to ask?",
      'Thank you for your attention. The floor is yours: any questions?',
      "That wraps up the talk. Thanks, everyone! Let's move on to your questions.",
      "Thanks for staying with me until the end. Now it's your turn: feel free to ask anything.",
    ],
  },
};

/** Default phrases for a language: "en-US" falls back to "en". */
export function defaultPhrases(lang: Lang): TalkPhrases | undefined {
  return DEFAULT_PHRASES[lang] ?? DEFAULT_PHRASES[lang.split('-')[0] ?? ''];
}

function readYaml(text: string, file: string, issues: ValidationIssue[]): unknown {
  try {
    return parseYaml(text);
  } catch (err) {
    issues.push({ severity: 'error', file, message: `Not valid YAML: ${(err as Error).message}` });
    return undefined;
  }
}

/** `pronunciation.yaml`: a map of `term: what to say`. */
export function parsePronunciation(text: string): { value: PronunciationEntry[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const file = PRONUNCIATION_FILE;
  const data = readYaml(text, file, issues);
  const value: PronunciationEntry[] = [];
  if (data === undefined || data === null) return { value, issues };
  if (typeof data !== 'object' || Array.isArray(data)) {
    issues.push({ severity: 'error', file, message: 'Expected a map of `term: what to say`.' });
    return { value, issues };
  }
  for (const [term, raw] of Object.entries(data as Record<string, unknown>)) {
    const say = typeof raw === 'string' ? raw.trim() : '';
    if (!term.trim() || !say) {
      issues.push({ severity: 'error', file, message: `\`${term}\` needs a non-empty text to say.` });
      continue;
    }
    if (/^\/.*\/$/.test(say) && /\s/.test(say)) {
      issues.push({ severity: 'error', file, message: `\`${term}\`: IPA in slashes works for one word only.` });
      continue;
    }
    value.push({ term: term.trim(), say });
  }
  return { value, issues };
}

/** `phrases.yaml`: `closing:` with a list of phrases. */
export function parsePhrases(text: string): { value: Partial<TalkPhrases>; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const data = readYaml(text, PHRASES_FILE, issues) as { closing?: unknown } | undefined | null;
  if (!data) return { value: {}, issues };
  const closing = data.closing;
  if (closing === undefined) return { value: {}, issues };
  if (!Array.isArray(closing) || !closing.every((p) => typeof p === 'string' && p.trim())) {
    issues.push({ severity: 'error', file: PHRASES_FILE, message: '`closing` must be a list of non-empty phrases.' });
    return { value: {}, issues };
  }
  return { value: { closing: closing.map((p: string) => p.trim()) }, issues };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace terms with what the voice should say. Longer terms win over their parts. */
export function applyPronunciation(text: string, entries: readonly PronunciationEntry[]): string {
  if (!entries.length) return text;
  const sorted = [...entries].sort((a, b) => b.term.length - a.term.length);
  const byTerm = new Map(sorted.map((e) => [e.term, e.say]));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${sorted.map((e) => escape(e.term)).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(pattern, (match) => byTerm.get(match) ?? match);
}
