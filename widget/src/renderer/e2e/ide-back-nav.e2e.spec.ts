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
 * untouched, then return with the same edit, selection and working undo/redo.
 * Escape, the IDE's keyboard path out, is exercised the same way.
 */
test('Back leaves the IDE for the main interface and the unsaved edit is still there on return', async () => {
  // The Explorer starts at home; keep every exercised file/store disposable.
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ide-back-e2e-'));
  const folder = path.join(isolatedHome, 'workspace-fixture');
  fs.mkdirSync(folder);
  const file = path.join(folder, 'draft.ts');
  const original = 'const kept = 1;\n';
  fs.writeFileSync(file, original);
  const userData = path.join(isolatedHome, 'profile');
  fs.mkdirSync(path.join(userData, 'config'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'config', 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  const ap = path.join(isolatedHome, 'ap-fixture');
  fs.mkdirSync(ap);
  fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# disposable marker, never executed\n');
  const { app, page } = await launchElectronApp({
    HOMEBOT_E2E: '1', NODE_ENV: 'test', HOME: isolatedHome, USERPROFILE: isolatedHome,
    APPDATA: path.join(isolatedHome, 'appdata'), LOCALAPPDATA: path.join(isolatedHome, 'localappdata'),
    CODEX_HOME: path.join(isolatedHome, '.codex'), ANCIENT_PATHWAYS_DIR: ap,
    HOMEBOT_MOVIE_PROJECTS_DIR: path.join(isolatedHome, 'projects'),
  }, userData);
  try {
    // Readiness waits for dialogs to close, so dismiss fresh-profile onboarding
    // first instead of spending its entire timeout behind that dialog.
    await dismissFirstRun(page);
    await waitForAppReady(page);

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

    await page.keyboard.press('ControlOrMeta+Home');
    for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
    for (let step = 0; step < 4; step++) await page.keyboard.press('Shift+ArrowRight');
    const cursorBeforeBack = await page.locator('.code-cursor-pos').innerText();
    expect(await editor.evaluate(() => window.getSelection()?.toString())).toBe('kept');

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

    await editor.focus();
    await expect(page.locator('.code-cursor-pos')).toHaveText(cursorBeforeBack);
    expect(await editor.evaluate(() => window.getSelection()?.toString())).toBe('kept');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).not.toContainText('// not saved yet');
    await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
    // CodeMirror uses Cmd+Shift+Z on macOS and Ctrl+Y on Windows/Linux.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
    await expect(editor).toContainText('// not saved yet');
    await expect(page.getByLabel('Unsaved changes')).toBeVisible();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);

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
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});
