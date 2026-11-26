import { TALK_FILES } from './parse.ts';
import type { Talk, ValidationIssue } from './types.ts';

const SLIDE_ID = /^[a-z0-9][a-z0-9-]*$/;
// Loose BCP-47 shape check: "en", "en-US", "pt-BR", "zh-Hant".
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Format rules that do not depend on how the files were read. */
export function validateTalk(talk: Talk): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { brief, slides, script } = talk;

  if (!brief.title) issues.push({ severity: 'error', file: TALK_FILES.brief, line: 1, message: '`title` is required.' });
  if (!brief.lang) issues.push({ severity: 'error', file: TALK_FILES.brief, line: 1, message: '`lang` is required, for example `lang: en`.' });
  else if (!LANG.test(brief.lang)) {
    issues.push({ severity: 'error', file: TALK_FILES.brief, line: 1, message: `\`lang: ${brief.lang}\` is not a BCP-47 language tag.` });
  }

  if (!slides.length) issues.push({ severity: 'error', file: TALK_FILES.slides, message: 'The deck has no slides.' });

  const slideIds = new Map<string, number>();
  for (const slide of slides) {
    const at = { file: TALK_FILES.slides, line: slide.line };
    if (!slide.id) {
      issues.push({ severity: 'error', ...at, message: `Slide ${slide.index + 1} has no \`id\` in its frontmatter.` });
      continue;
    }
    if (!SLIDE_ID.test(slide.id)) {
      issues.push({ severity: 'error', ...at, slideId: slide.id, message: `Slide id \`${slide.id}\` must use lowercase letters, digits and dashes.` });
    }
    const seen = slideIds.get(slide.id);
    if (seen !== undefined) {
      issues.push({ severity: 'error', ...at, slideId: slide.id, message: `Slide id \`${slide.id}\` is already used on line ${seen}.` });
    } else slideIds.set(slide.id, slide.line);
  }

  const sectionIds = new Map<string, number>();
  for (const section of script) {
    const at = { file: TALK_FILES.script, line: section.line, slideId: section.slideId };
    const seen = sectionIds.get(section.slideId);
    if (seen !== undefined) {
      issues.push({ severity: 'error', ...at, message: `Section \`${section.slideId}\` is already defined on line ${seen}.` });
      continue;
    }
    sectionIds.set(section.slideId, section.line);
    if (!slideIds.has(section.slideId)) {
      issues.push({ severity: 'error', ...at, message: `Section \`${section.slideId}\` has no slide with this id in ${TALK_FILES.slides}.` });
    }
    if (!section.text) issues.push({ severity: 'warning', ...at, message: `Section \`${section.slideId}\` is empty.` });
  }

  for (const [id, line] of slideIds) {
    if (!sectionIds.has(id)) {
      issues.push({ severity: 'error', file: TALK_FILES.slides, line, slideId: id, message: `Slide \`${id}\` has no \`## ${id}\` section in ${TALK_FILES.script}.` });
    }
  }
  return issues;
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** One line per issue: `slides.md:12 error: ...`. */
export function formatIssue(issue: ValidationIssue): string {
  const where = issue.line ? `${issue.file}:${issue.line}` : issue.file;
  return `${where} ${issue.severity}: ${issue.message}`;
}
