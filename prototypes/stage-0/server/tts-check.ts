// Task 0.3: synthesize a phrase with the cloned voice from the terminal and play it.
// Usage: npm run tts-check -- "Optional text to speak"
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { synthesize, TTS_MODEL } from './inworld.ts';

const text =
  process.argv.slice(2).join(' ').trim() ||
  'Hi everyone. This is a quick check of my cloned voice before the talk.';

const outDir = join(import.meta.dirname, '..', 'out');
await mkdir(outDir, { recursive: true });

try {
  const { wav, characters, ms } = await synthesize(text);
  const file = join(outDir, 'tts-check.wav');
  await writeFile(file, wav);
  console.log(`OK: ${TTS_MODEL}, ${characters} characters, ${ms} ms, ${wav.length} bytes -> ${file}`);
  if (process.platform === 'darwin') {
    execFile('afplay', [file], (err) => {
      if (err) console.error('afplay failed:', err.message);
    });
  }
} catch (err) {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
