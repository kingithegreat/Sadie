import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `sadie-e2e-modes-${Date.now()}`);
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
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
      telemetryEnabled: true,
      permissions: { delete_file: false },
      defaultTeam: 'GSW',
      n8nUrl: 'http://localhost:5678',
      widgetHotkey: 'Ctrl+Shift+Space',
      alwaysOnTop: true,
      theme: 'dark',
    }, null, 2),
    'utf-8'
  );
}

test.describe('Mode switching', () => {
  test('switches between all four modes', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ SADIE_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // Default mode is chat — the chat mode button should be active
    const chatBtn = page.locator('button.mode-btn', { hasText: 'Chat' });
    await expect(chatBtn).toHaveClass(/active/);

    // Switch to Automation mode
    const autoBtn = page.locator('button.mode-btn', { hasText: 'Automation' });
    await autoBtn.click();
    await expect(autoBtn).toHaveClass(/active/);
    await expect(chatBtn).not.toHaveClass(/active/);

    // Switch to Image mode
    const imageBtn = page.locator('button.mode-btn', { hasText: 'Image' });
    await imageBtn.click();
    await expect(imageBtn).toHaveClass(/active/);
    await expect(autoBtn).not.toHaveClass(/active/);

    // Switch to Web mode
    const webBtn = page.locator('button.mode-btn', { hasText: 'Web' });
    await webBtn.click();
    await expect(webBtn).toHaveClass(/active/);
    await expect(imageBtn).not.toHaveClass(/active/);

    // Switch back to Chat
    await chatBtn.click();
    await expect(chatBtn).toHaveClass(/active/);
    await expect(webBtn).not.toHaveClass(/active/);

    await app.close();
  });

  test('chat mode shows message input', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ SADIE_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // In chat mode, the message input should be visible
    const input = page.getByLabel('Message HomeBot');
    await expect(input).toBeVisible();

    // Switch to Image mode — chat input should disappear
    await page.locator('button.mode-btn', { hasText: 'Image' }).click();
    await expect(input).toHaveCount(0);

    // Switch back to Chat — input should reappear
    await page.locator('button.mode-btn', { hasText: 'Chat' }).click();
    await expect(page.getByLabel('Message HomeBot')).toBeVisible();

    await app.close();
  });
});
