import path from 'path';
import { _electron as electron, ElectronApplication, Page } from 'playwright';

export async function launchElectronApp(env: Record<string, string | undefined>) {
  // process.env contains string | undefined; Playwright expects a plain object at runtime.
  const mergedEnv = { ...process.env, ...env } as Record<string, string> as any;
  const app = await electron.launch({
    args: [path.join(__dirname, '../../../dist/main/index.js')],
    env: mergedEnv,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return { app, page } as { app: ElectronApplication; page: Page };
}
