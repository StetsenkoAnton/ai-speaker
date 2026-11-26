#!/usr/bin/env node
// AI Speaker command line. Stage 1 commands: `check` and `present`.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_SERVER_PORT } from '@ai-speaker/protocol';
import { formatIssue, hasErrors, loadTalk, validateTalk, type ValidationIssue } from '@ai-speaker/talk-format';
import { startLiveServer } from './live-server.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const STAGE_PORT = Number(process.env.STAGE_PORT ?? 3030);
const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 5173);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? DEFAULT_SERVER_PORT);

// Slidev and Vite print startup banners with their own routes. `present` prints the addresses
// that matter and the Control window links Slidev's views, so the banners only add noise.
const SLIDEV_BANNER =
  /public slide show|presenter mode|slides overview|export slides|mcp server|remote control|shortcuts|css engine|^\s*theme\s|^\s*entry\s|●■▲|Slidev\s+v\d|VITE\s+v\d|➜/;

const USAGE = `Usage:
  ai-speaker check <talk>     validate the talk folder
  ai-speaker present <talk>   start the server, the Stage and the Control window

<talk> is a folder path or a name under talks/, for example "example".`;

/** A path to a folder, or a talk name under talks/. */
function resolveTalkDir(arg: string): string {
  const asPath = resolve(arg);
  if (existsSync(asPath) && statSync(asPath).isDirectory()) return asPath;
  const named = join(REPO_ROOT, 'talks', arg);
  if (existsSync(named)) return named;
  throw new Error(`Talk "${arg}" not found: no folder ${asPath} or ${named}`);
}

async function loadChecked(dir: string) {
  const { value: talk, issues: readIssues } = await loadTalk(dir);
  const issues: ValidationIssue[] = [...readIssues, ...validateTalk(talk)];
  return { talk, issues };
}

function printIssues(dir: string, issues: ValidationIssue[]) {
  for (const issue of issues) console.log(`  ${formatIssue(issue)}`);
  const errors = issues.filter((i) => i.severity === 'error').length;
  console.log(`${dir}: ${errors} error(s), ${issues.length - errors} warning(s)`);
}

async function check(arg: string): Promise<number> {
  const dir = resolveTalkDir(arg);
  const { talk, issues } = await loadChecked(dir);
  printIssues(dir, issues);
  if (!hasErrors(issues)) console.log(`OK: ${talk.slides.length} slides, lang ${talk.brief.lang}`);
  return hasErrors(issues) ? 1 : 0;
}

function run(name: string, command: string, args: string[], cwd: string): ChildProcess {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (chunk: Buffer) =>
    String(chunk)
      .split('\n')
      .filter((l) => l.trim() && !SLIDEV_BANNER.test(l))
      .map((l) => `[${name}] ${l}`)
      .join('\n');
  child.stdout?.on('data', (c: Buffer) => {
    const text = prefix(c);
    if (text) console.log(text);
  });
  child.stderr?.on('data', (c: Buffer) => console.error(prefix(c)));
  return child;
}

async function present(arg: string): Promise<number> {
  const dir = resolveTalkDir(arg);
  const { talk, issues } = await loadChecked(dir);
  if (issues.length) printIssues(dir, issues);
  if (hasErrors(issues)) {
    console.error('Fix the errors above, then run present again.');
    return 1;
  }

  // The audience view; `?server=` tells its layer where the server is when the port is not the default.
  const stageUrl = `http://localhost:${STAGE_PORT}/${SERVER_PORT === DEFAULT_SERVER_PORT ? '' : `?server=${SERVER_PORT}`}`;
  const server = await startLiveServer(talk, { port: SERVER_PORT, stageUrl });
  const bin = (pkg: string) => join(REPO_ROOT, 'node_modules', '.bin', pkg);
  const children = [
    run('stage', bin('slidev'), [join(dir, 'slides.md'), '--port', String(STAGE_PORT), '--log', 'warn'], REPO_ROOT),
    run('control', bin('vite'), ['--port', String(CONTROL_PORT), '--strictPort'], join(REPO_ROOT, 'apps/web')),
  ];

  console.log(`\n"${talk.brief.title}" (${talk.slides.length} slides)`);
  console.log(`  Stage:   ${stageUrl}   share this window in the meeting`);
  console.log(`  Control: http://localhost:${CONTROL_PORT}/control`);
  console.log(`  Server:  http://127.0.0.1:${server.port}/api/health`);
  console.log('Press Ctrl+C to stop.\n');

  await new Promise<void>((done) => {
    const stop = () => done();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    for (const child of children) child.once('exit', (code) => {
      if (code) console.error(`A child process exited with code ${code}; stopping.`);
      stop();
    });
  });
  for (const child of children) child.kill('SIGTERM');
  await server.close();
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, talk] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if ((command === 'check' || command === 'present') && !talk) {
    console.error(`Missing <talk>.\n\n${USAGE}`);
    return 1;
  }
  if (command === 'check') return check(talk!);
  if (command === 'present') return present(talk!);
  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
