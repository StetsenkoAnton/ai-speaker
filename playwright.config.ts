import { defineConfig } from '@playwright/test';

// Separate ports so the tests never meet a running `present` or the stage-0 prototype.
const ports = { SERVER_PORT: '8797', STAGE_PORT: '3047', CONTROL_PORT: '5187' };
Object.assign(process.env, ports);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.out/results',
  timeout: 60_000,
  workers: 1,
  use: {
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    // A copy of the example with generated tones as its audio; no Inworld, no .env voice.
    command: 'node e2e/prepare.ts && node apps/server/src/cli.ts present e2e/.out/talk',
    url: `http://localhost:${ports.STAGE_PORT}/`,
    env: { ...ports, INWORLD_VOICE_ID: '' },
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
