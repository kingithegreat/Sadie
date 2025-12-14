import path from 'path';
import { _electron as electron, ElectronApplication, Page } from 'playwright';

export async function launchElectronApp(env: Record<string, string | undefined>, userDataDir?: string) {
  // process.env contains string | undefined; Playwright expects a plain object at runtime.
  const mergedEnv = { ...process.env, ...env } as Record<string, string> as any;
  // Log merged environment to help diagnose whether the child process receives the expected env vars
  try {
    console.log('[E2E-LAUNCH] Merged env:', {
      SADIE_E2E: mergedEnv.SADIE_E2E,
      SADIE_DIRECT_OLLAMA: mergedEnv.SADIE_DIRECT_OLLAMA,
      NODE_ENV: mergedEnv.NODE_ENV,
      OLLAMA_URL: mergedEnv.OLLAMA_URL,
      SADIE_E2E_BYPASS_MOCK: mergedEnv.SADIE_E2E_BYPASS_MOCK
    });
  } catch (e) {
    // ignore any errors logging to ensure we don't block launch
  }
  const args = [] as string[];
  if (userDataDir) {
    args.push(`--user-data-dir=${userDataDir}`);
  }
  args.push(path.join(__dirname, '../../../dist/main/index.js'));

  const app = await electron.launch({
    args,
    env: mergedEnv,
  });

  // Prefer the first app window that contains the visible SADIE UI (avoids DevTools being picked up)
  const startedAt = Date.now();
  const timeoutMs = 15000;
  let page: Page | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const windows = await app.windows();
    for (const w of windows) {
      try {
        await w.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});
        // Prefer windows titled 'SADIE' (the app window) since DevTools may be the first window
        const title = await w.title().catch(() => '');
        if (title && title.toLowerCase().includes('sadie')) {
          page = w as Page;
          break;
        }
        // Quick existence check for the main UI as a fallback
        const hasInput = await w.$('label:has-text("Message SADIE")');
        if (hasInput) {
          page = w as Page;
          break;
        }
      } catch (e) {}
    }
    if (page) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!page) {
    // Fallback to first window if we couldn't find the app UI in time
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  }

  return { app, page } as { app: ElectronApplication; page: Page };
}
