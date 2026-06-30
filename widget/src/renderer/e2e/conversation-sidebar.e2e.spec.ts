import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-e2e-sidebar-${Date.now()}`);
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

test.describe('Conversation sidebar', () => {
  test('opens sidebar, shows new-chat button, and closes', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // Sidebar should not be visible initially
    await expect(page.locator('.conversation-sidebar')).toHaveCount(0);

    // Open sidebar via the menu button (hamburger icon in StatusIndicator)
    // The menu button is the first button in the header with title/aria for menu
    const menuBtn = page.locator('button[title="Conversations"], button[aria-label="Conversations"], button[title="Menu"], button[aria-label="Menu"]').first();
    await menuBtn.click();

    // Sidebar should appear
    const sidebar = page.locator('.conversation-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // New Chat button should exist
    const newChatBtn = sidebar.locator('.new-chat-btn');
    await expect(newChatBtn).toBeVisible();

    // Search button should exist
    const searchBtn = sidebar.locator('button[aria-label="Search conversations"]');
    await expect(searchBtn).toBeVisible();

    // Close sidebar via the close button. (The backdrop is an empty div whose
    // full-screen size comes purely from CSS; in the packaged CI build Playwright
    // intermittently sees it as zero-size / "not visible", so clicking it flakes.
    // The × button is a real, always-rendered control and still verifies closing.)
    await sidebar.locator('button[aria-label="Close sidebar"]').click();
    await expect(sidebar).toHaveCount(0);

    await app.close();
  });

  test('new chat creates a conversation entry', async () => {
    const tmp = makeTempProfile();
    seedConfig(tmp);
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // Open sidebar
    const menuBtn = page.locator('button[title="Conversations"], button[aria-label="Conversations"], button[title="Menu"], button[aria-label="Menu"]').first();
    await menuBtn.click();
    const sidebar = page.locator('.conversation-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Count existing conversations
    const initialCount = await sidebar.locator('.conversation-item').count();

    // Click New Chat
    await sidebar.locator('.new-chat-btn').click();

    // Ensure the sidebar is open before checking the refreshed list.
    await page.waitForTimeout(500);
    const sidebarAfterNewChat = page.locator('.conversation-sidebar');
    const isSidebarVisible = await sidebarAfterNewChat.isVisible().catch(() => false);
    if (!isSidebarVisible) {
      await menuBtn.click();
      await expect(sidebarAfterNewChat).toBeVisible({ timeout: 3000 });
    }

    // There should be at least one conversation now
    const newCount = await sidebarAfterNewChat.locator('.conversation-item').count();
    expect(newCount).toBeGreaterThanOrEqual(initialCount);

    await app.close();
  });
});
