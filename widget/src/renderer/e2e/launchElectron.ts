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
      NODE_ENV: mergedEnv.NODE_ENV
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

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return { app, page } as { app: ElectronApplication; page: Page };
}
