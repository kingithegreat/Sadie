/**
 * The brand and the chat icons actually render.
 *
 * Two things this guards. First, the logo: `.header-logo` was styled in five
 * places in the stylesheet and no element ever carried the class, so the app
 * had a logo slot and no logo. A rule with no element is invisible in review
 * and invisible on screen, which is how it stayed that way.
 *
 * Second, the composer icons. Emoji and SVG both "render", so a test that only
 * checked the buttons exist would pass either way. This counts .hb-icon nodes
 * inside the composer and asserts the emoji are gone from it — the two halves
 * of the swap, which can fail independently.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-brand-${Date.now()}`);
  fs.mkdirSync(path.join(base, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, telemetryEnabled: false, theme: 'dark' }, null, 2),
    'utf-8',
  );
  return base;
}

/** The emoji that used to be the composer's controls. */
const RETIRED = ['📷', '📄', '📎', '🎤', '⏳', '⚡', '⏸'];

test('the logo renders and the composer is drawn icons, not emoji', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchElectronApp(
    { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
  );
  await waitForAppReady(page);

  // The mark, in the titlebar slot the stylesheet was already dressed for.
  const logo = page.locator('.hb-logo').first();
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(8);
  expect(box?.height ?? 0).toBeGreaterThan(8);

  // Every control in the composer is a drawn icon.
  const composerIcons = page.locator('.input-container .hb-icon');
  expect(await composerIcons.count()).toBeGreaterThanOrEqual(4);

  const composerText = (await page.locator('.input-container').innerText()) || '';
  for (const emoji of RETIRED) {
    expect(composerText).not.toContain(emoji);
  }

  await page.screenshot({
    path: path.join(process.env.HOMEBOT_SHOT_DIR || 'test-results', 'brand-and-icons.png'),
  });

  await app.close();
});
