export type * from './types.ts';
export { TALK_FILES, loadTalk, parseBrief, parseScript, parseSlides, type Parsed } from './parse.ts';
export { formatIssue, hasErrors, validateTalk } from './validate.ts';
export {
  DEFAULT_PHRASES,
  PHRASES_FILE,
  PRONUNCIATION_FILE,
  applyPronunciation,
  defaultPhrases,
  parsePhrases,
  parsePronunciation,
  type PronunciationEntry,
  type TalkPhrases,
} from './speech.ts';
