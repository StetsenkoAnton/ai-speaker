import { defineConfig } from '@playwright/test';

// Separate ports so the tests never meet a running `present` or the stage-0 prototype.
const ports = { SERVER_PORT: '8797', STAGE_PORT: '3047', CONTROL_PORT: '5187' };
Object.assign(process.env, ports);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.out/results',
  timeout: 60_000,
  use: { viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'node apps/server/src/cli.ts present example',
    url: `http://localhost:${ports.STAGE_PORT}/`,
    env: ports,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
