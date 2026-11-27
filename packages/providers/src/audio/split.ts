// Split speech text into pieces a TTS request accepts, at sentence boundaries when possible.

const SENTENCE = /[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g;

export function splitForTts(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.match(SENTENCE) ?? [clean];
  const pieces: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxChars) {
      current += sentence;
      continue;
    }
    push();
    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }
    // A single sentence longer than the limit: cut at word boundaries.
    for (const word of sentence.split(' ')) {
      if ((current + ' ' + word).length > maxChars) push();
      current = current ? `${current} ${word}` : word;
    }
  }
  push();
  return pieces;
}
