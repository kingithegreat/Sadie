import path from 'path';
import * as fs from 'fs';
import { _electron as electron, ElectronApplication, Page } from 'playwright';

async function isHomeBotAppWindow(page: Page): Promise<boolean> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});

    const title = await page.title().catch(() => '');
    if (title && title.toLowerCase().includes('homebot')) {
      return true;
    }

    const appRoot = page.locator('[data-testid="homebot-app-root"]');
    if (await appRoot.count().catch(() => 0)) {
      return true;
    }

    const hydratedRoot = page.locator('[data-testid="homebot-app-root"][data-hydrated="true"]');
    if (await hydratedRoot.count().catch(() => 0)) {
      return true;
    }

    const modeButtons = page.locator('button.mode-btn');
    if (await modeButtons.count().catch(() => 0)) {
      return true;
    }

    const input = page.locator('textarea[aria-label="Message HomeBot"]');
    return Boolean(await input.count().catch(() => 0));
  } catch {
    return false;
  }
}

async function waitForHomeBotAppSurface(page: Page, timeout = 15000): Promise<void> {
  await page.waitForFunction(() => {
    try {
      return Boolean(
        document.querySelector('[data-testid="homebot-app-root"][data-hydrated="true"]') ||
        document.querySelector('[data-testid="homebot-app-root"]') ||
        document.querySelector('button.mode-btn') ||
        document.querySelector('textarea[aria-label="Message HomeBot"]')
      );
    } catch {
      return false;
    }
  }, null, { timeout }).catch(() => {});
}

export async function launchElectronApp(env: Record<string, string | undefined>, userDataDir?: string) {
  const mergedEnv = { ...process.env, ...env } as Record<string, string> as any;

  // VS Code (and other Electron hosts) set ELECTRON_RUN_AS_NODE=1 which forces
  // Electron to run as a plain Node.js process — no Chromium init, no app module,
  // and Chromium flags like --remote-debugging-port get rejected as "bad option".
  // Playwright's _electron.launch() needs a real Electron browser process.
  delete mergedEnv.ELECTRON_RUN_AS_NODE;

  // Pass custom userData directory via env var — the main process picks it up
  // with app.setPath('userData', ...) before app.whenReady(). This avoids
  // passing --user-data-dir as a CLI flag, which Electron's Node.js option
  // parser rejects when Playwright also injects -r loader.js.
  if (userDataDir) {
    mergedEnv.HOMEBOT_E2E_USER_DATA_DIR = userDataDir;
  }

  try {
    console.log('[E2E-LAUNCH] Merged env:', {
      HOMEBOT_E2E: mergedEnv.HOMEBOT_E2E,
      HOMEBOT_DIRECT_OLLAMA: mergedEnv.HOMEBOT_DIRECT_OLLAMA,
      HOMEBOT_E2E_USER_DATA_DIR: mergedEnv.HOMEBOT_E2E_USER_DATA_DIR,
      NODE_ENV: mergedEnv.NODE_ENV,
    });
  } catch (e) {}

  // Prefer a packaged `dist/main/index.js` entry if present; fall back to
  // the dev build output `out/main/index.js` which `electron-vite` produces.
  const distEntry = path.join(__dirname, '../../../dist/main/index.js');
  const outEntry = path.join(__dirname, '../../../out/main/index.js');
  const needsDevBuild = mergedEnv.HOMEBOT_DIRECT_OLLAMA === '1' || mergedEnv.HOMEBOT_DIRECT_OLLAMA === 'true';
  const entry = (needsDevBuild && fs.existsSync(outEntry)) ? outEntry : (fs.existsSync(distEntry) ? distEntry : outEntry);
  console.log('[E2E-LAUNCH] Using entrypoint:', entry, needsDevBuild ? '(dev build for env vars)' : '(packaged build)');

  // Resolve the Electron binary so we can pass it as executablePath.
  // When executablePath is set, Playwright does NOT inject its -r loader.js
  // require flag, which avoids a conflict where Node.js rejects Chromium-level
  // flags (--remote-debugging-port, --inspect) as "bad option" in Electron 28.
  const electronPath = require('electron') as unknown as string;

  // On headless Linux CI runners the Chromium sandbox helper isn't configured,
  // so Electron exits immediately with "Process failed to launch!". Disable the
  // sandbox / GPU there (harmless flags, scoped to Linux so macOS/Windows and
  // local dev keep their normal launch behaviour).
  const launchFlags = process.platform === 'linux'
    ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    : [];

  const app = await electron.launch({
    executablePath: electronPath,
    args: [entry, ...launchFlags],
    env: mergedEnv,
  });

  // Prefer the first app window that contains the visible HomeBot UI
  const startedAt = Date.now();
  const timeoutMs = 15000;
  let page: Page | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const windows = await app.windows();
    for (const w of windows) {
      if (await isHomeBotAppWindow(w as Page)) {
        page = w as Page;
        break;
      }
    }
    if (page) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!page) {
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  }

  await waitForHomeBotAppSurface(page);

  return { app, page } as { app: ElectronApplication; page: Page };
}
