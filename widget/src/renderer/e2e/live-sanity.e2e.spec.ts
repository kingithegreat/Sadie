import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

test.describe('Live Release Sanity Suite (Real Ollama)', () => {
  let app: any;
  let page: any;
  let tmpDataDir: string;

  test.beforeAll(async () => {
    // 1. Use E2E mode with bypass-mock so the backend routes directly to the real Ollama instance
    //    (without HOMEBOT_E2E, useDirectOllama=false and the router tries n8n first)
    const mergedEnv: Record<string, string> = { NODE_ENV: 'test' };
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        mergedEnv[key] = value;
      }
    }
    delete mergedEnv.ELECTRON_RUN_AS_NODE;
    mergedEnv.HOMEBOT_E2E = '1';
    mergedEnv.HOMEBOT_E2E_BYPASS_MOCK = '1';

    // 2. Create an isolated user data directory to prevent touching real user settings
    tmpDataDir = path.join(os.tmpdir(), `homebot-live-sanity-${Date.now()}`);
    fs.mkdirSync(path.join(tmpDataDir, 'config'), { recursive: true });
    
    // Force firstRun off and select the default standard model
    fs.writeFileSync(path.join(tmpDataDir, 'config', 'user-settings.json'), JSON.stringify({
      firstRun: false,
      telemetryEnabled: false,
      alwaysOnTop: false,
      chatModel: 'qwen2.5:7b'
    }, null, 2));

    mergedEnv.HOMEBOT_E2E_USER_DATA_DIR = tmpDataDir;

    const outEntry = path.join(process.cwd(), 'out', 'main', 'index.js');

    app = await electron.launch({ executablePath: require('electron'), args: [outEntry], env: mergedEnv });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (app) await app.close();
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('should connect to real Ollama and stream actual tokens to the UI', async () => {
    test.setTimeout(60000);

    const statusDot = page.locator('.widget-status-dot');
    await expect(statusDot).not.toHaveClass(/disconnected/, { timeout: 15000 });

    const input = page.locator('textarea[aria-label="Message HomeBot"]');
    await input.waitFor({ state: 'visible' });
    await input.fill('Hello HomeBot. Reply with exactly the word "BANANA" and nothing else.');
    await input.press('Enter');

    const assistantBubbles = page.locator('[data-role="assistant-message"]');
    await expect(assistantBubbles.first()).toBeVisible({ timeout: 15000 });

    // Wait for the stream to finish (model fallback can add latency)
    const latestBubble = assistantBubbles.last();
    await expect(latestBubble).toHaveAttribute('data-state', 'finished', { timeout: 45000 });
    await expect(latestBubble).toContainText(/BANANA/i, { timeout: 5000 });
  });
});