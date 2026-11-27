// Updates one variable in the .env file, keeping every other line as it is.
import { readFile, writeFile } from 'node:fs/promises';

const NAME = /^[A-Z][A-Z0-9_]*$/;

export async function setEnvVar(path: string, name: string, value: string): Promise<void> {
  if (!NAME.test(name)) throw new Error(`Invalid variable name ${name}`);
  if (/[\r\n]/.test(value)) throw new Error('Value must be one line');
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
  const next = pattern.test(text) ? text.replace(pattern, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  await writeFile(path, next, { mode: 0o600 });
  process.env[name] = value;
}
