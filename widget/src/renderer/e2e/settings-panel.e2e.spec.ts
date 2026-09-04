import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-e2e-settings-${Date.now()}`);
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function seedConfig(dir: string, overrides: Record<string, unknown> = {}) {
  const confDir = path.join(dir, 'config');
  fs.mkdirSync(confDir, { recursive: true });
  const base = {
    firstRun: false,
    telemetryEnabled: true,
    permissions: { delete_file: false },
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space',
    alwaysOnTop: true,
    theme: 'dark',
    ...overrides,
  };
  fs.writeFileSync(path.join(confDir, 'user-settings.json'), JSON.stringify(base, null, 2), 'utf-8');
}

test.describe('Settings panel', () => {
  test('opens and closes settings dialog', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // Settings should not be visible initially
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toHaveCount(0);

    // Click settings button
    await page.locator('button[aria-label="Settings"]').click();

    // Settings dialog should appear
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Close via close button
    await page.locator('button[aria-label="Close settings"]').click();
    await expect(dialog).toHaveCount(0);

    await app.close();
  });

  test('model grid shows selectable model cards', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    await page.locator('button[aria-label="Settings"]').click();
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // There should be model cards
    const modelCards = dialog.locator('.model-card');
    const count = await modelCards.count();
    expect(count).toBeGreaterThan(0);

    // One should be active
    const activeCard = dialog.locator('.model-card.active');
    await expect(activeCard).toHaveCount(1);

    await app.close();
  });

  test('closes settings on Escape key', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    await page.locator('button[aria-label="Settings"]').click();
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await app.close();
  });
});
