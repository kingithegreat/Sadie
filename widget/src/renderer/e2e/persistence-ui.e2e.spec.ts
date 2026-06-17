import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
process.env.HOMEBOT_E2E = 'true';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-e2e-persistence-${Date.now()}`);
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
      modelRoutingMode: 'off',
      widgetHotkey: 'Ctrl+Shift+Space',
      alwaysOnTop: true,
      theme: 'dark',
    }, null, 2),
    'utf-8'
  );
}

test('UI -> message persistence and debug logs available', async () => {
  const tmp = makeTempProfile();
  seedConfig(tmp);
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
  await waitForAppReady(page);

  await page.waitForFunction(async () => {
    const store = await (window as any).electron.loadConversations?.();
    const conversations = store?.data?.conversations || [];
    return Boolean(store?.data?.activeConversationId || conversations.length > 0);
  }, null, { timeout: 10000 });

  // Send a user message
  await page.getByLabel('Message HomeBot').fill('persistence-ui-test');
  await page.getByRole('button', { name: /send/i }).click();

  // Query conversation store via preload API
  const store = await page.evaluate(async () => (window as any).electron.loadConversations?.());
  expect(store).toBeDefined();

  // Persistence is async; poll until the just-sent user message is observable in any stored conversation.
  let persisted = false;
  let matchedConversation: any = null;
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const snapshot = await page.evaluate(async () => (window as any).electron.loadConversations?.());
    const conversationIds = snapshot?.data?.conversations?.map((c: any) => c.id) || [];

    for (const id of conversationIds) {
      const conv = await page.evaluate(async (conversationId) => (window as any).electron.getConversation?.(conversationId), id);
      if (conv?.success && conv.data?.messages?.some((m: any) => String(m.content).includes('persistence-ui-test'))) {
        persisted = true;
        matchedConversation = conv;
        break;
      }
    }

    if (persisted) {
      break;
    }

    await page.waitForTimeout(100);
  }
  expect(persisted).toBe(true);
  expect(matchedConversation?.success).toBe(true);
  expect(matchedConversation.data?.messages?.some((m: any) => String(m.content).includes('persistence-ui-test'))).toBe(true);

  // Also fetch debug logs exposed by main/preload
  const debug = await page.evaluate(async () => (window as any).electron.readDebugLogs?.());
  expect(debug).toBeDefined();
  expect(Array.isArray(debug.rendererLogs)).toBe(true);
  expect(Array.isArray(debug.mainLogs)).toBe(true);

  await app.close();
});