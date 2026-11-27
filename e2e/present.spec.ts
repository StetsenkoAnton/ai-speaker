// End-to-end checks of `present`: the Control window drives the Slidev Stage through the
// server, plays the rendered audio and runs the talk to the end by itself.
// Playwright starts `present` on its own ports with a generated audio cache (playwright.config.ts).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const SERVER_PORT = process.env.SERVER_PORT ?? '8787';
const STAGE = `http://localhost:${process.env.STAGE_PORT ?? '3030'}/?server=${SERVER_PORT}`;
const CONTROL = `http://localhost:${process.env.CONTROL_PORT ?? '5173'}/control`;

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let stage: Page;
let control: Page;

async function open(browser: Browser) {
  // One browser profile, like a real Chrome window: Slidev syncs its views inside it.
  ctx = await browser.newContext();
  stage = await ctx.newPage();
  await stage.goto(STAGE);
  control = await ctx.newPage();
  await control.goto(CONTROL);
  await expect(control.getByTestId('stages')).toHaveText(/Stage open/);
}

test.beforeAll(async ({ browser }) => open(browser));
test.afterAll(async () => ctx.close());

test('Control moves the Stage and the Stage reports back', async () => {
  await expect(stage.locator('.ai-speaker-layer .wave')).toBeVisible();
  await expect(stage.locator('.ai-speaker-offline')).toHaveCount(0);
  await expect(control.getByTestId('slide-title')).toHaveText('A talk delivered by an agent in my voice');
  await expect(control.getByTestId('views').getByRole('link', { name: 'Stage' })).toHaveAttribute('href', STAGE);
  await expect(control.getByTestId('player-role')).toHaveText(/This window plays the talk/);
  await expect(control.getByTestId('audio-status')).toHaveText(/Rendered: 6 of 6 slides, 5 closing/);

  // Before Start the deck can be browsed without any audio.
  await control.getByRole('button', { name: 'Next ▶' }).click();
  await expect(stage).toHaveURL(/\/2(\?|$)/);
  await expect(stage.getByRole('heading', { name: 'The idea' })).toBeVisible();

  // Images come from the talk's own public/ folder.
  await control.getByRole('button', { name: 'How the sound gets into the call' }).click();
  const image = stage.getByAltText(/Agent voice goes to BlackHole 2ch/);
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Keyboard navigation on the Stage goes back to the server and the Control window.
  await stage.locator('body').click();
  await stage.keyboard.press('ArrowRight');
  await expect(stage).toHaveURL(/\/4(\?|$)/);
  await expect(control.getByTestId('slide-title')).toHaveText('A talk is a folder of text files');

  // Slidev's presenter view syncs the audience view, which reports to the server.
  const presenter = await ctx.newPage();
  await presenter.goto(STAGE.replace(/\/\?.*$/, '/presenter/4'));
  await presenter.locator('button[title*="Next" i]').first().click();
  await expect(stage).toHaveURL(/\/5(\?|$)/);
  await expect(control.getByTestId('slide-title')).toHaveText('Moving the slides from the server');
  await presenter.close();
});

test('the talk plays to the end by itself and waits for questions', async () => {
  await control.getByRole('button', { name: 'A talk delivered by an agent in my voice' }).click();
  await expect(stage).toHaveURL(/\/1(\?|$)/);

  await control.getByRole('button', { name: 'Start' }).click();
  await expect(control.getByTestId('state')).toHaveText('Presenting');
  await expect(control.getByTestId('playing')).toHaveText(/Slide audio: intro/);
  await expect(stage.locator('.wave')).toHaveAttribute('data-activity', 'speaking');

  // Each slide's audio ends, the server moves the deck on; then a closing phrase plays.
  await expect(stage).toHaveURL(/\/3(\?|$)/, { timeout: 10_000 });
  await expect(control.getByTestId('playing')).toHaveText(/Closing phrase/, { timeout: 15_000 });
  await expect(stage).toHaveURL(/\/6(\?|$)/);
  await expect(control.getByTestId('state')).toHaveText('Waiting for questions', { timeout: 10_000 });
  await expect(stage.locator('.wave')).toHaveAttribute('data-activity', 'listening');
  await stage.screenshot({ path: 'e2e/.out/stage.png' });
  await control.screenshot({ path: 'e2e/.out/control.png', fullPage: true });

  // Only the author ends the session.
  await control.getByRole('button', { name: 'Finish' }).click();
  await expect(control.getByTestId('state')).toHaveText('Finished');
  await expect(stage.locator('.wave')).toHaveAttribute('data-activity', 'idle');
});

test('/setup shows the Inworld status and guards cloning', async () => {
  const setup = await ctx.newPage();
  await setup.goto(CONTROL.replace('/control', '/setup'));
  await expect(setup.getByRole('heading', { name: 'AI Speaker setup' })).toBeVisible();
  await expect(setup.getByTestId('setup-status')).toHaveText(/API key: (set|missing) · voice: not chosen/);
  // Without a sample and without the consent box, cloning stays disabled.
  const cloneButton = setup.getByRole('button', { name: 'Clone voice' });
  await expect(cloneButton).toBeDisabled();
  await setup.getByTestId('consent').check();
  await expect(cloneButton).toBeDisabled();
  await setup.close();
});
