import { test, expect } from '@playwright/test';
process.env.SADIE_E2E = 'true';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

test('UI -> message persistence and debug logs available', async () => {
  const { app, page } = await launchElectronApp({ SADIE_E2E: '1', NODE_ENV: 'test' });
  await waitForAppReady(page);

  // Ensure there's an active conversation; if none, create one
  const convs = await page.evaluate(async () => (window as any).electron.loadConversations?.());
  if (!convs || !convs.data || !convs.data.activeConversationId) {
    await page.getByRole('button', { name: /new chat/i }).click();
    // Wait for the async handleNewConversation IPC round-trips to complete
    await page.waitForTimeout(1000);
  }

  // Send a user message
  await page.getByLabel('Message SADIE').fill('persistence-ui-test');
  await page.getByRole('button', { name: /send/i }).click();

  // Wait for assistant placeholder to appear (message persisted on send)
  await page.waitForTimeout(500);

  // Query conversation store via preload API
  const store = await page.evaluate(async () => (window as any).electron.loadConversations?.());
  expect(store).toBeDefined();
  const activeId = store.data?.activeConversationId || (store.data?.conversations?.[0]?.id);
  expect(activeId).toBeDefined();

  const conv = await page.evaluate(async (id) => (window as any).electron.getConversation?.(id), activeId);
  expect(conv?.success).toBe(true);
  expect(conv.data?.messages?.some((m: any) => String(m.content).includes('persistence-ui-test'))).toBe(true);

  // Also fetch debug logs exposed by main/preload
  const debug = await page.evaluate(async () => (window as any).electron.readDebugLogs?.());
  expect(debug).toBeDefined();
  expect(Array.isArray(debug.rendererLogs)).toBe(true);
  expect(Array.isArray(debug.mainLogs)).toBe(true);

  await app.close();
});