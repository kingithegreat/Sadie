import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * IDE-10: the Workspace Source Control panel stages and commits in a real
 * repository through the built app, and git itself confirms the commit.
 */
test('Source Control shows changes, stages one file and commits it', async () => {
  const repo = fs.mkdtempSync(path.join(os.homedir(), 'homebot-scm-e2e-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'HomeBot E2E');
  git('config', 'user.email', 'e2e@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'app.ts'), 'export const a = 1;\n');
  git('add', 'app.ts');
  git('commit', '-q', '-m', 'initial');
  fs.writeFileSync(path.join(repo, 'app.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(repo, 'notes.md'), '# notes\n');

  // A disposable profile whose Workspace opens this repository.
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-scm-'));
  fs.mkdirSync(path.join(userData, 'config'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'config', 'user-settings.json'), JSON.stringify({ projectPath: repo }));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, userData);
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);
    await page.locator('[aria-label="Workspace"]').first().click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();

    const unstaged = page.getByRole('list', { name: 'Unstaged changes', exact: true });
    await expect(unstaged).toContainText('app.ts');
    await expect(unstaged).toContainText('notes.md');
    const commit = page.getByRole('button', { name: /^Commit/ });
    await expect(commit).toBeDisabled();

    await page.getByRole('button', { name: 'Stage notes.md' }).click();
    await expect(page.getByRole('list', { name: 'Staged changes', exact: true })).toContainText('notes.md');
    await page.getByRole('textbox', { name: 'Commit message' }).fill('Add notes from the Workspace');
    await expect(commit).toBeEnabled();
    await commit.click();

    await expect(page.locator('.scm-panel').getByRole('status')).toContainText(/Committed [0-9a-f]{7}/);
    expect(git('log', '-1', '--format=%s').trim()).toBe('Add notes from the Workspace');
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('notes.md');
    // app.ts was not staged, so it is still a working-tree change.
    expect(git('status', '--porcelain').trim()).toBe('M app.ts');
    await expect(unstaged).toContainText('app.ts');
    await expect(page.getByRole('list', { name: 'Staged changes', exact: true })).not.toContainText('notes.md');
  } finally {
    await app.close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
