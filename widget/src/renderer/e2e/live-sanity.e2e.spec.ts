import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

test.describe('Live Release Sanity Suite (Real Ollama)', () => {
  let app: any;
  let page: any;
  let tmpDataDir: string;

  test.beforeAll(async () => {
    // 1. Strip HOMEBOT_E2E so the backend routes to the real Ollama instance
    const mergedEnv: Record<string, string> = { NODE_ENV: 'test' };
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        mergedEnv[key] = value;
      }
    }
    delete mergedEnv.ELECTRON_RUN_AS_NODE;
    delete mergedEnv.HOMEBOT_E2E; 

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
    test.setTimeout(45000); // Give Ollama plenty of time to boot and stream
    
    const statusDot = page.locator('.widget-status-dot');
    await expect(statusDot).not.toHaveClass(/disconnected/, { timeout: 15000 });

    const input = page.locator('textarea[aria-label="Message HomeBot"]');
    await input.waitFor({ state: 'visible' });
    await input.fill('Hello HomeBot. Reply with exactly the word "BANANA" and nothing else.');
    await input.press('Enter');

    const assistantBubbles = page.locator('.message-bubble.assistant');
    await expect(assistantBubbles).toHaveCount(1, { timeout: 10000 });

    const latestBubble = assistantBubbles.last();
    await expect(latestBubble).toContainText(/BANANA/i, { timeout: 25000 });
  });
});