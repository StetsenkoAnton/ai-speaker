#!/usr/bin/env node
// AI Speaker command line. Stage 1 commands: `check` and `present`.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { DEFAULT_SERVER_PORT } from '@ai-speaker/protocol';
import { formatIssue, hasErrors, loadTalk, validateTalk, type ValidationIssue } from '@ai-speaker/talk-format';
import { startLiveServer } from './live-server.ts';
import { cacheStatus, estimateSeconds, renderItems } from './audio-cache.ts';
import { createVoiceProvider, inworldConfigured, voiceSettings } from './config.ts';
import { handleSetup } from './setup-routes.ts';
import { isLocalOrigin, sendJson } from './http.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const ENV_PATH = join(REPO_ROOT, '.env');
const STAGE_PORT = Number(process.env.STAGE_PORT ?? 3030);
const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 5173);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? DEFAULT_SERVER_PORT);

// Slidev and Vite print startup banners with their own routes. `present` prints the addresses
// that matter and the Control window links Slidev's views, so the banners only add noise.
const SLIDEV_BANNER =
  /public slide show|presenter mode|slides overview|export slides|mcp server|remote control|shortcuts|css engine|^\s*theme\s|^\s*entry\s|●■▲|Slidev\s+v\d|VITE\s+v\d|➜/;

const USAGE = `Usage:
  ai-speaker setup            open /setup: Inworld key, devices, voice clone
  ai-speaker check <talk>     validate the talk folder
  ai-speaker render <talk>    synthesize the speech that changed since the last render
      --dry-run               only show what would be synthesized
      --yes                   do not ask for confirmation
      --only <slide-id>       render one slide section
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

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

const minutes = (seconds: number) => (seconds < 90 ? `${seconds} s` : `${(seconds / 60).toFixed(1)} min`);

async function render(arg: string, flags: Set<string>, only?: string): Promise<number> {
  const dir = resolveTalkDir(arg);
  const { talk, issues } = await loadChecked(dir);
  if (hasErrors(issues)) {
    printIssues(dir, issues);
    return 1;
  }
  const voice = voiceSettings(talk.brief.lang);
  if (!voice) {
    console.error('INWORLD_VOICE_ID is not set in .env: choose or clone a voice in /setup first.');
    return 1;
  }
  const { items } = await cacheStatus(talk, voice);
  if (only && !items.some((s) => s.item.slideId === only)) {
    console.error(`No script section for slide "${only}".`);
    return 1;
  }
  const todo = items.filter((s) => s.state === 'missing' && (!only || s.item.slideId === only));
  for (const s of items) {
    const mark = todo.includes(s) ? 'render' : s.state === 'cached' ? 'cached' : 'skip';
    console.log(`  ${mark.padEnd(7)} ${s.item.key.padEnd(24)} ${String(s.item.text.length).padStart(5)} chars`);
  }
  const chars = todo.reduce((n, s) => n + s.item.text.length, 0);
  if (!todo.length) {
    console.log('Everything is rendered.');
    return 0;
  }
  console.log(`\n${todo.length} item(s), ${chars} characters, about ${minutes(estimateSeconds(chars))} of speech (voice from .env, ${voice.model}).`);
  if (flags.has('--dry-run')) return 0;
  if (!flags.has('--yes')) {
    if (!process.stdin.isTTY) {
      console.error('Not a terminal: pass --yes to render without confirmation.');
      return 1;
    }
    if (!(await confirm('This uses Inworld TTS characters. Render now?'))) return 1;
  }
  const provider = createVoiceProvider();
  await renderItems(talk, provider, voice, todo, (done, total, item, ms) => {
    console.log(`  [${done}/${total}] ${item.key} ${(ms / 1000).toFixed(1)} s`);
  });
  console.log('Done.');
  return 0;
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
  const voice = voiceSettings(talk.brief.lang);
  const server = await startLiveServer(talk, { port: SERVER_PORT, stageUrl, voice, envPath: ENV_PATH });
  const audio = await cacheStatus(talk, voice);
  const missing = audio.items.filter((s) => s.state === 'missing').length;
  if (missing) console.log(`Audio: ${missing} of ${audio.items.length} items are not rendered; run \`npm run render -- ${arg}\`. Slides without audio stay up for their reading time.`);
  const bin = (pkg: string) => join(REPO_ROOT, 'node_modules', '.bin', pkg);
  const children = [
    run('stage', bin('slidev'), [join(dir, 'slides.md'), '--port', String(STAGE_PORT), '--log', 'warn'], REPO_ROOT),
    run('control', bin('vite'), ['--port', String(CONTROL_PORT), '--strictPort'], join(REPO_ROOT, 'apps/web')),
  ];

  console.log(`\n"${talk.brief.title}" (${talk.slides.length} slides)`);
  console.log(`  Stage:   ${stageUrl}   share this window in the meeting`);
  console.log(`  Control: http://localhost:${CONTROL_PORT}/control`);
  console.log(`  Setup:   http://localhost:${CONTROL_PORT}/setup`);
  console.log(`  Server:  http://127.0.0.1:${server.port}/api/health`);
  console.log('Press Ctrl+C to stop.\n');

  await untilStopped(children);
  for (const child of children) child.kill('SIGTERM');
  await server.close();
  return 0;
}

/** Ctrl+C or a child exiting ends the session. */
function untilStopped(children: ChildProcess[]): Promise<void> {
  return new Promise<void>((done) => {
    const stop = () => done();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    for (const child of children) child.once('exit', (code) => {
      if (code) console.error(`A child process exited with code ${code}; stopping.`);
      stop();
    });
  });
}

/** /setup without a talk: only the setup routes and the web app. */
async function setup(): Promise<number> {
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!isLocalOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'Forbidden origin' });
    if (await handleSetup(req, res, url, { envPath: ENV_PATH })) return;
    sendJson(res, 404, { error: 'Not found' });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'EADDRINUSE' ? new Error(`Port ${SERVER_PORT} is busy: stop the other AI Speaker or set SERVER_PORT.`) : err),
    );
    http.listen(SERVER_PORT, '127.0.0.1', () => resolve());
  });
  const web = run('setup', join(REPO_ROOT, 'node_modules', '.bin', 'vite'), ['--port', String(CONTROL_PORT), '--strictPort'], join(REPO_ROOT, 'apps/web'));
  const c = inworldConfigured();
  console.log(`\nSetup: http://localhost:${CONTROL_PORT}/setup`);
  console.log(`  INWORLD_API_KEY: ${c.apiKey ? 'set' : 'MISSING (add it to .env)'}, INWORLD_VOICE_ID: ${c.voiceId ? 'set' : 'not chosen yet'}`);
  console.log('Press Ctrl+C to stop.\n');
  await untilStopped([web]);
  web.kill('SIGTERM');
  await new Promise<void>((resolve) => http.close(() => resolve()));
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--only');
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? argv[onlyAt + 1] : undefined;
  const [command, talk] = positional;
  if (!command || flags.has('--help')) {
    console.log(USAGE);
    return flags.has('--help') ? 0 : 1;
  }
  if ((command === 'check' || command === 'present' || command === 'render') && !talk) {
    console.error(`Missing <talk>.\n\n${USAGE}`);
    return 1;
  }
  if (command === 'setup') return setup();
  if (command === 'check') return check(talk!);
  if (command === 'present') return present(talk!);
  if (command === 'render') return render(talk!, flags, only);
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
