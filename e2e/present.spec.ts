// End-to-end check of stage 1: the Control window drives the Slidev Stage through the server,
// and navigation made on the Stage comes back to the Control window.
// Needs `ai-speaker present example` running; ports come from the same env variables.
import { expect, test } from '@playwright/test';

const SERVER_PORT = process.env.SERVER_PORT ?? '8787';
const STAGE = `http://localhost:${process.env.STAGE_PORT ?? '3030'}/?server=${SERVER_PORT}`;
const CONTROL = `http://localhost:${process.env.CONTROL_PORT ?? '5173'}/control`;

test('Control moves the Stage and the Stage reports back', async ({ browser }) => {
  // One browser profile, like a real Chrome window: Slidev syncs its views inside it.
  const ctx = await browser.newContext();
  const stage = await ctx.newPage();
  await stage.goto(STAGE);
  await expect(stage.locator('.ai-speaker-layer .wave')).toBeVisible();
  await expect(stage.locator('.ai-speaker-offline')).toHaveCount(0);

  const control = await ctx.newPage();
  await control.goto(CONTROL);
  await expect(control.getByTestId('stages')).toHaveText(/Stage open/);
  await expect(control.getByTestId('slide-title')).toHaveText('A talk delivered by an agent in my voice');
  await expect(control.getByTestId('views').getByRole('link', { name: 'Stage' })).toHaveAttribute('href', STAGE);
  await expect(control.getByTestId('views').getByRole('link', { name: 'Overview' })).toHaveAttribute('href', /\/overview\/$/);

  await control.getByRole('button', { name: 'Start' }).click();
  await expect(control.getByTestId('state')).toHaveText('Presenting');
  await expect(stage.locator('.wave')).toHaveAttribute('data-activity', 'speaking');

  await control.getByRole('button', { name: 'Next ▶' }).click();
  await expect(stage).toHaveURL(/\/2(\?|$)/);
  await expect(stage.getByRole('heading', { name: 'The idea' })).toBeVisible();

  // Images come from the talk's own public/ folder.
  await control.getByRole('button', { name: 'How the sound gets into the call' }).click();
  const image = stage.getByAltText(/Agent voice goes to BlackHole 2ch/);
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await control.getByRole('button', { name: 'Moving the slides from the server' }).click();
  await expect(stage).toHaveURL(/\/5(\?|$)/);
  await expect(stage.getByRole('heading', { name: 'Moving the slides from the server' })).toBeVisible();

  // Keyboard navigation on the Stage goes back to the server and the Control window.
  await stage.locator('body').click();
  await stage.keyboard.press('ArrowLeft');
  await expect(stage).toHaveURL(/\/4(\?|$)/);
  await expect(control.getByTestId('slide-title')).toHaveText('A talk is a folder of text files');

  // Slidev's presenter view syncs the audience view, which reports to the server.
  const presenter = await ctx.newPage();
  await presenter.goto(STAGE.replace(/\/\?.*$/, '/presenter/4'));
  await presenter.locator('button[title*="Next" i]').first().click();
  await expect(stage).toHaveURL(/\/5(\?|$)/);
  await expect(control.getByTestId('slide-title')).toHaveText('Moving the slides from the server');
  await presenter.close();

  await control.getByRole('button', { name: 'Pause' }).click();
  await expect(control.getByTestId('state')).toHaveText('Paused');
  await expect(stage.locator('.wave')).toHaveAttribute('data-activity', 'idle');
  await stage.screenshot({ path: 'e2e/.out/stage.png' });
  await control.screenshot({ path: 'e2e/.out/control.png' });
});
