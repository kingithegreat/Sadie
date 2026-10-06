import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('package task reports a TypeScript problem and opens its exact editor line', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ide11-home-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ide11-profile-'));
  const project = path.join(home, 'fixture');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
  const tsc = require.resolve('typescript/bin/tsc');
  const command = `node "${tsc}" --noEmit --pretty false`;
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { check: command } }));
  fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, types: [] }, files: ['broken.ts'] }));
  fs.writeFileSync(path.join(project, 'broken.ts'), 'const ok = true;\nconst answer: string = 42;\n');
  fs.writeFileSync(path.join(profile, 'config', 'user-settings.json'), JSON.stringify({ projectPath: project }));

  const { app, page } = await launchElectronApp({
    HOMEBOT_E2E: '1', NODE_ENV: 'test', HOME: home, USERPROFILE: home,
    HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'movie-projects'),
  }, profile);
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);
    await page.locator('[aria-label="Workspace"]').first().click();
    await page.getByRole('button', { name: 'Problems and tasks' }).click();
    await expect(page.getByRole('combobox', { name: 'Package script' })).toHaveValue('check');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByText(/npm configuration and package-manager hooks/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('task-confirmation.png') });
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.getByText('Task output').click();
    await expect(page.locator('.ws-problems-output pre')).toContainText('TS2322');
    const problem = page.locator('.ws-problem-message').filter({ hasText: "Type 'number' is not assignable to type 'string'" });
    await expect(problem).toBeVisible({ timeout: 30_000 });
    await problem.click();
    await expect(page.locator('.ws-tab.active')).toContainText('broken.ts');
    await expect(page.locator('.code-cursor-pos')).toContainText('Ln 2');
    await page.screenshot({ path: testInfo.outputPath('problem-editor-line.png') });
  } finally {
    await app.close();
    // Best-effort: macOS runners can leave npm cache files under the temp HOME
    // (ENOTEMPTY on rmdir) after the package task. Cleanup must not fail the
    // acceptance assertion that already ran (Problems click opens broken.ts:2).
    for (const dir of [home, profile]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      } catch (err) {
        console.warn('workspace-problems cleanup skipped:', dir, err);
      }
    }
  }
});

test('closing HomeBot stops an approved running watch task and its owned children', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-watch-home-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-watch-profile-'));
  const project = path.join(home, 'fixture');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { watch: 'node watch.cjs' } }));
  const pidFile = path.join(project, 'watch.pid');
  fs.writeFileSync(path.join(project, 'watch.cjs'), 'require("fs").writeFileSync("watch.pid", String(process.pid)); console.log("WATCH_READY"); setInterval(() => {}, 1000);');
  fs.writeFileSync(path.join(profile, 'config', 'user-settings.json'), JSON.stringify({ projectPath: project, morningBriefing: false }));
  fs.writeFileSync(path.join(profile, 'config', 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  const { app, page } = await launchElectronApp({
    HOMEBOT_E2E: '1', NODE_ENV: 'test', HOME: home, USERPROFILE: home,
    HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'movie-projects'),
  }, profile);
  let closed = false;
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);
    await page.locator('[aria-label="Workspace"]').first().click();
    await page.getByRole('button', { name: 'Problems and tasks' }).click();
    await expect(page.getByRole('combobox', { name: 'Package script' })).toHaveValue('watch');
    await page.getByRole('checkbox', { name: 'Watch or dev server (runs until Stop)' }).check();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await expect(page.locator('.ws-problems-output pre')).toContainText('WATCH_READY', { timeout: 30_000 });
    const taskPid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(taskPid).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('watch-before-quit.png') });
    await app.close(); // Strict helper verifies actual-main exit and captured identities; force cleanup fails.
    closed = true;
    let alive = true;
    try { process.kill(taskPid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      else throw error;
    }
    expect(alive).toBe(false);
  } finally {
    if (!closed) await app.close();
  }
});
