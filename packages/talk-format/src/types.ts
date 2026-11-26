// Talk format: a talk is a folder of text files, and the files are the source of truth.
// Moved from the planning draft (.claude/context/interfaces.ts) at stage 1.

/** BCP-47 language tag of a talk, for example "en". Read from `brief.md`. */
export type Lang = string;

export interface TalkBrief {
  title: string;
  lang: Lang;
  audience?: string;
  durationMin?: number;
  /** Free-form wishes and context written by the author (the body of `brief.md`). */
  notes: string;
}

export interface Slide {
  /** Stable id shared with the matching script section. Empty when the slide has none. */
  id: string;
  /** Position in the deck, 0-based, as Slidev counts slides. */
  index: number;
  /** 1-based line in `slides.md` where the slide starts. */
  line: number;
  /** Slide frontmatter, including `id`. */
  frontmatter: Record<string, unknown>;
  /** Slide body in Slidev-flavoured Markdown, without frontmatter. */
  markdown: string;
}

export interface ScriptSection {
  slideId: string;
  /** 1-based line of the section heading in `script.md`. */
  line: number;
  /** What the speaker says while this slide is shown. */
  text: string;
}

export interface KnowledgeDoc {
  /** Path relative to `knowledge/`, for example "faq.md". */
  path: string;
  text: string;
}

export interface Talk {
  dir: string;
  brief: TalkBrief;
  /** Empty until `plan` creates `outline.md`. */
  outline: string;
  slides: Slide[];
  script: ScriptSection[];
  knowledge: KnowledgeDoc[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  /** File name relative to the talk folder, for example "slides.md". */
  file: string;
  line?: number;
  slideId?: string;
  message: string;
}
