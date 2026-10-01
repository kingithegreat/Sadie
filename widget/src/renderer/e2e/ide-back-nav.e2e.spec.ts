import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The IDE (Code mode) covers the whole window, mode tabs included, and had no
 * visible way back to the main HomeBot interface. Drives the built app: enter
 * Code from the mode bar, edit a file without saving, leave with the header's
 * Back button, confirm the main interface is showing and the file on disk is
 * untouched, then return and find the same tab with the edit still in it.
 * Escape, the IDE's keyboard path out, is exercised the same way.
 */
test('Back leaves the IDE for the main interface and the unsaved edit is still there on return', async () => {
  // The Explorer starts at the home folder, so the fixture lives there.
  const folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-ide-back-e2e-'));
  const file = path.join(folder, 'draft.ts');
  const original = 'const kept = 1;\n';
  fs.writeFileSync(file, original);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-ide-back-'));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, userData);
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);

    const codeMode = page.locator('button.mode-btn', { hasText: /^\s*Code\s*$/ });
    const chatMode = page.locator('button.mode-btn', { hasText: /^\s*Chat\s*$/ });
    const shell = page.locator('.workspace-shell');
    const back = page.getByRole('button', { name: 'Back to HomeBot' });
    const editor = page.locator('.cm-content[aria-label="Code editor"]');

    await codeMode.click();
    await expect(shell).toBeVisible();
    await expect(back).toBeVisible();

    await page.getByRole('treeitem', { name: path.basename(folder) }).click();
    await page.getByRole('treeitem', { name: 'draft.ts' }).click();
    await expect(editor).toContainText('const kept = 1;');

    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('// not saved yet');
    await expect(editor).toContainText('// not saved yet');
    await expect(page.getByLabel('Unsaved changes')).toBeVisible();

    await back.click();
    await expect(shell).toHaveCount(0);
    await expect(chatMode).toHaveClass(/active/);
    await expect(page.locator('textarea[aria-label="Message HomeBot"]')).toBeVisible();
    // Leaving did not save, and did not discard.
    expect(fs.readFileSync(file, 'utf8')).toBe(original);

    await codeMode.click();
    await expect(shell).toBeVisible();
    await expect(editor).toContainText('// not saved yet');
    await expect(page.getByRole('tab', { name: /draft\.ts/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Unsaved changes')).toBeVisible();

    // Escape inside the editor belongs to the editor...
    await editor.click();
    await page.keyboard.press('Escape');
    await expect(shell).toBeVisible();
    // ...and from the IDE's chrome it is the same Back.
    await page.getByRole('tab', { name: /draft\.ts/ }).click();
    await page.keyboard.press('Escape');
    await expect(shell).toHaveCount(0);
    await expect(chatMode).toHaveClass(/active/);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  } finally {
    await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
