/**
 * The publishing kill switch needs a switch.
 *
 * media-studio.ts refuses to move a job into `scheduled` or `published` unless
 * `publishingEnabled` is passed, and both production callers read that from
 * `settings.mediaPublishingEnabled`. The gate is deliberate and fail-closed —
 * the problem was that nothing could ever set it. The setting defaulted to
 * false, no control existed anywhere in the UI, and the refusal told the user:
 *
 *   "Turn publishing on in Settings to allow it."
 *
 * which was an instruction they could not follow. Two of the eleven pipeline
 * states were unreachable in normal operation.
 *
 * A test that only asserted the checkbox renders would not have caught it — a
 * control that does not persist is the same defect wearing a checkbox. So this
 * drives the real chain: click the box, save, and read the file that
 * getSettings() reads back off disk.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-e2e-publishing-${Date.now()}`);
  fs.mkdirSync(path.join(base, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, telemetryEnabled: false, theme: 'dark' }, null, 2),
    'utf-8',
  );
  return base;
}

const settingsFile = (dir: string) => path.join(dir, 'config', 'user-settings.json');
const readSettings = (dir: string) => JSON.parse(fs.readFileSync(settingsFile(dir), 'utf-8'));

test('the publishing switch exists and reaches the setting the state machine reads', async () => {
  test.setTimeout(120_000);
  const tmp = makeTempProfile();
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
  await waitForAppReady(page);

  // Fail-closed to begin with: absent from a fresh profile.
  expect(readSettings(tmp).mediaPublishingEnabled).toBeUndefined();

  await page.locator('button[aria-label="Settings"]').click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const toggle = dialog.locator('input[type="checkbox"]').filter({
    has: page.locator('xpath=..').locator('text=Allow videos to reach Scheduled and Published'),
  }).first();
  const byLabel = dialog
    .locator('label.setting-label', { hasText: 'Allow videos to reach Scheduled and Published' })
    .locator('input[type="checkbox"]');

  const control = (await byLabel.count()) ? byLabel : toggle;
  await expect(control).toBeVisible();
  await expect(control).not.toBeChecked();

  await control.scrollIntoViewIfNeeded();
  await control.check();
  await expect(control).toBeChecked();

  await dialog.locator('button.button-save').click();

  // The chain that matters: the checkbox has to land in the file that
  // getSettings() reads, under the exact key both production callers use.
  await expect.poll(() => readSettings(tmp).mediaPublishingEnabled, { timeout: 15_000 })
    .toBe(true);

  await app.close();
});
