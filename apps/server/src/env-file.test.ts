import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setEnvVar } from './env-file.ts';

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  delete process.env.AI_SPEAKER_TEST_VAR;
});

describe('setEnvVar', () => {
  it('replaces the variable and keeps every other line', async () => {
    dir = await mkdtemp(join(tmpdir(), 'env-'));
    const path = join(dir, '.env');
    await writeFile(path, '# keys\nA=1\nAI_SPEAKER_TEST_VAR=old\nB=2');
    await setEnvVar(path, 'AI_SPEAKER_TEST_VAR', 'new');
    expect(await readFile(path, 'utf8')).toBe('# keys\nA=1\nAI_SPEAKER_TEST_VAR=new\nB=2');
    expect(process.env.AI_SPEAKER_TEST_VAR).toBe('new');
  });

  it('appends to a file without the variable, or creates the file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'env-'));
    const path = join(dir, '.env');
    await setEnvVar(path, 'AI_SPEAKER_TEST_VAR', 'x');
    expect(await readFile(path, 'utf8')).toBe('AI_SPEAKER_TEST_VAR=x\n');
    await writeFile(path, 'A=1');
    await setEnvVar(path, 'AI_SPEAKER_TEST_VAR', 'y');
    expect(await readFile(path, 'utf8')).toBe('A=1\nAI_SPEAKER_TEST_VAR=y\n');
  });

  it('refuses multi-line values', async () => {
    await expect(setEnvVar('/nonexistent/.env', 'AI_SPEAKER_TEST_VAR', 'a\nB=evil')).rejects.toThrow(/one line/);
  });
});
