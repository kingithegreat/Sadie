import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * IDE-2: the Workspace assistant sends the attached file's content through the
 * real chat IPC (captured in the main process) and shows the streamed answer.
 * E2E mode answers with deterministic chunks, so no model is called.
 */
test('asking about an attached file sends that file to the assistant and shows the answer', async () => {
  const folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-assistant-e2e-'));
  const file = path.join(folder, 'pricing.ts');
  fs.writeFileSync(file, 'export const MARKER_PRICE = 4217; // e2e-context-marker\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-assistant-'));
  fs.mkdirSync(path.join(userData, 'config'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'config', 'user-settings.json'), JSON.stringify({ projectPath: folder }));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_E2E_MOCK_INTERVAL: '20' }, userData);
  try {
    // Record every chat request as it arrives in the main process.
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).__assistantRequests = [];
      ipcMain.on('homebot:stream-message', (_e, req) => { (globalThis as any).__assistantRequests.push(req); });
    });
    await waitForAppReady(page);
    await dismissFirstRun(page);
    await page.locator('[aria-label="Workspace"]').first().click();
    await page.getByRole('treeitem', { name: 'pricing.ts' }).click();
    await page.getByRole('button', { name: 'Toggle assistant panel' }).click();

    const panel = page.getByRole('region', { name: 'Assistant' });
    await panel.getByLabel('Add context').selectOption({ label: '@ Current file (pricing.ts)' });
    await panel.getByLabel('Ask the assistant').fill('What is MARKER_PRICE?');
    await panel.getByRole('button', { name: 'Send' }).click();

    await expect(panel.getByRole('log', { name: 'Assistant conversation' })).toContainText('chunk-1chunk-2chunk-3chunk-4chunk-5');
    const requests = await app.evaluate(() => (globalThis as any).__assistantRequests as Array<{ conversation_id: string; message: string }>);
    const req = requests.find(r => r.conversation_id.startsWith('workspace:'));
    expect(req).toBeTruthy();
    expect(req!.message).toContain(`File: ${file}`);
    expect(req!.message).toContain('export const MARKER_PRICE = 4217; // e2e-context-marker');
    expect(req!.message.trim().endsWith('What is MARKER_PRICE?')).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
