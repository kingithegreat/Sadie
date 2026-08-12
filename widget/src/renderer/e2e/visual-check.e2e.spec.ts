/**
 * Visual check — launch the real app and look at the new surfaces.
 *
 * The mode-switching spec asserts a button gets an `active` class. That proves
 * state, not that anything rendered: a mode whose panel throws still flips the
 * class. These screenshots are the check the class cannot make.
 *
 * Writes PNGs to test-results/visual/ for a human (or me) to open.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

const OUT = path.resolve(__dirname, '../../../test-results/visual');

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-visual-${Date.now()}`);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function seedConfig(dir: string) {
  const confDir = path.join(dir, 'config');
  fs.mkdirSync(confDir, { recursive: true });
  fs.writeFileSync(
    path.join(confDir, 'user-settings.json'),
    JSON.stringify({
      firstRun: false,
      telemetryEnabled: false,
      n8nUrl: 'http://localhost:5678',
      theme: 'dark',
    }, null, 2),
    'utf-8',
  );
}

test.describe('visual check', () => {
  test('the new modes render, not just activate', async () => {
    test.setTimeout(120_000);
    fs.mkdirSync(OUT, { recursive: true });

    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    await page.screenshot({ path: path.join(OUT, '1-launch.png') });

    // Every mode button that should exist after today's work.
    const labels = await page.locator('button.mode-btn').allInnerTexts();
    console.log('mode buttons:', JSON.stringify(labels));
    expect(labels.join(' ')).toContain('Studio');
    expect(labels.join(' ')).toContain('Browser');

    // Media Studio: the panel must actually paint its own header.
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '2-studio.png') });
    await expect(page.getByText('Media Studio')).toBeVisible();
    // The line that states the guardrail — if this is missing the panel
    // rendered something else.
    await expect(page.getByText(/without your approval/i)).toBeVisible();

    // Browser: the BrowserView floats ABOVE the DOM, so the screenshot is the
    // only way to tell an attached page from an empty placeholder.
    await page.locator('button.mode-btn', { hasText: 'Browser' }).click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, '3-browser.png') });

    console.log('screenshots written to', OUT);
    await app.close();
  });
});
