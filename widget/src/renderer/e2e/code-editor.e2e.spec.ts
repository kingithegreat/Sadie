import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * IDE-1: the Workspace editor is a real code editor, and its edits reach the
 * file on disk. Drives the built app: opens a file from the Explorer, replaces
 * every match through the search panel, edits two places at once with
 * multiple cursors, saves with Ctrl+S, and reads the bytes back.
 */
test('find/replace and multiple cursors edit the file, and Ctrl+S writes exactly that', async () => {
  // The Explorer starts at the home folder, so the fixture lives there.
  const folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-ide-e2e-'));
  const file = path.join(folder, 'sample.ts');
  fs.writeFileSync(file, 'const alpha = 1;\nconst beta = alpha + alpha;\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-ide-'));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, userData);
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);

    await page.locator('[aria-label="Workspace"]').first().click();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page.getByRole('treeitem', { name: path.basename(folder) }).click();
    await page.getByRole('treeitem', { name: 'sample.ts' }).click();

    const editor = page.locator('.cm-content[aria-label="Code editor"]');
    await expect(editor).toContainText('const beta = alpha + alpha;');
    // Syntax highlighting comes from the TypeScript language, not plain text.
    await expect(page.locator('.cm-content .ͼc, .cm-content [class*="ͼ"]').first()).toBeVisible();

    // Replace every "alpha" through the search panel.
    await editor.click();
    // ControlOrMeta: CodeMirror's Mod is Cmd on macOS, which the e2e matrix also runs.
    await page.keyboard.press('ControlOrMeta+F');
    const searchField = page.locator('.cm-search input[name="search"]');
    await expect(searchField).toBeVisible();
    await searchField.fill('alpha');
    await page.locator('.cm-search input[name="replace"]').fill('gamma');
    await page.locator('.cm-search button[name="replaceAll"]').click();
    await expect(editor).toContainText('const beta = gamma + gamma;');
    await page.keyboard.press('Escape');

    // Multiple cursors: select the first "const" (double-click works on every OS), add the next occurrence, type over both.
    await page.locator('.cm-line').first().getByText('const', { exact: true }).dblclick();
    await page.keyboard.press('ControlOrMeta+D');
    await page.keyboard.type('let');
    await expect(editor).toContainText('let gamma = 1;');
    await expect(editor).toContainText('let beta = gamma + gamma;');

    await page.keyboard.press('ControlOrMeta+S');
    await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 10_000 })
      .toBe('let gamma = 1;\nlet beta = gamma + gamma;\n');
  } finally {
    await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
