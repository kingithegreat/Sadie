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

/**
 * IDE-5: Inline edit (Ctrl+K) on a selection: prompt -> diff preview in place -> accept/reject.
 * Done when: The selected range is replaced only on accept, and undo restores it.
 */
test('IDE-5: inline edit (Ctrl+K) on selection: prompt -> diff preview -> accept replaces code, undo restores it', async () => {
  const folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-ide-inline-'));
  const file = path.join(folder, 'calculation.ts');
  fs.writeFileSync(file, 'export function calculateTotal(price: number): number {\n  const tax = price * 0.15;\n  return price + tax;\n}\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-inline-'));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_E2E_MOCK_INTERVAL: '20' }, userData);
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);

    await page.locator('[aria-label="Workspace"]').first().click();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page.getByRole('treeitem', { name: path.basename(folder) }).click();
    await page.getByRole('treeitem', { name: 'calculation.ts' }).click();

    const editor = page.locator('.cm-content[aria-label="Code editor"]');
    await expect(editor).toContainText('const tax = price * 0.15;');

    // 1. Select the word "tax" in the editor
    await editor.click();
    await page.locator('.cm-line').filter({ hasText: 'const tax' }).getByText('tax', { exact: true }).first().dblclick();

    // 2. Press Ctrl+K (or Cmd+K) to open the inline edit bar
    await page.keyboard.press('ControlOrMeta+K');
    const inlineBar = page.locator('[data-testid="code-inline-edit-bar"]');
    await expect(inlineBar).toBeVisible();

    // 3. Enter prompt into inline edit input
    const promptInput = page.locator('[data-testid="inline-edit-input"]');
    await expect(promptInput).toBeFocused();
    await promptInput.fill('replace with discountRate');

    // 4. Submit prompt via Enter key
    await page.keyboard.press('Enter');

    // 5. Wait for streamed diff preview to appear
    const diffPreview = page.locator('[data-testid="code-inline-diff-preview"]');
    await expect(diffPreview).toBeVisible();
    await expect(page.locator('[data-testid="inline-edit-actions"]')).toBeVisible();

    // The selected range is replaced ONLY on accept - editor still has original text
    await expect(editor).toContainText('const tax = price * 0.15;');

    // 6. Accept the inline edit
    await page.locator('[data-testid="inline-edit-accept-btn"]').click();
    await expect(inlineBar).not.toBeVisible();

    // Editor now reflects the accepted replacement
    await expect(editor).toContainText('chunk-1chunk-2chunk-3chunk-4chunk-5');

    // 7. Undo (Ctrl+Z) restores original code
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(editor).toContainText('const tax = price * 0.15;');
    await expect(editor).not.toContainText('chunk-1chunk-2chunk-3chunk-4chunk-5');

    // 8. Reject flow: open Ctrl+K again, enter prompt, click Reject
    await page.locator('.cm-line').filter({ hasText: 'const tax' }).getByText('tax', { exact: true }).first().dblclick();
    await page.keyboard.press('ControlOrMeta+K');
    await expect(inlineBar).toBeVisible();
    await promptInput.fill('another instruction');
    await page.keyboard.press('Enter');
    await expect(diffPreview).toBeVisible();

    await page.locator('[data-testid="inline-edit-reject-btn"]').click();
    await expect(inlineBar).not.toBeVisible();
    // Document remains original
    await expect(editor).toContainText('const tax = price * 0.15;');
    await expect(editor).not.toContainText('chunk-1chunk-2chunk-3chunk-4chunk-5');
  } finally {
    await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
