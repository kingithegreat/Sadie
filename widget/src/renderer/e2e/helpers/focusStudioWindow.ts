import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp } from '../launchElectron';

/** Only this test's app is restored; never touch the owner's other preview windows. */
export async function focusStudioWindow(app: ElectronApplication, page: Page): Promise<void> {
  if (process.platform === 'win32') {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.getTitle().includes('HomeBot'));
      if (!window) throw new Error('The Studio test window was not found.');
      window.restore();
      window.show();
      window.focus();
    });
  }
  await page.bringToFront();
}

/** A visible native window matters: tab focus alone does not restore Windows Electron. */
export async function launchFocusedStudioApp(env: Record<string, string | undefined>, profile?: string) {
  const launched = await launchElectronApp(env, profile);
  await focusStudioWindow(launched.app, launched.page);
  return launched;
}
