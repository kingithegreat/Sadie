import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { launchElectronApp } from './launchElectron';

test('Free automation edit and delete stay saved through the real Windows UI and IPC', async () => {
  test.skip(process.platform !== 'win32' || process.env.HOMEBOT_AUTOMATION_GATE_LIVE !== '1', 'Opt-in Windows Electron acceptance.');
  test.setTimeout(120_000);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-automation-gate-'));
  const home = path.join(profile, 'home');
  const ancientPathways = path.join(home, 'Ancient Pathways');
  const config = path.join(profile, 'config');
  fs.mkdirSync(ancientPathways, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(ancientPathways, 'run_pipeline.py'), '# isolated fixture\n');
  fs.writeFileSync(path.join(config, 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  fs.writeFileSync(path.join(config, 'user-settings.json'), JSON.stringify({ firstRun: false, telemetryEnabled: false, useCustomLLM: false }));

  const automationFile = path.join(profile, 'automations.json');
  const original = JSON.stringify([{
    id: 'local-1', name: 'Daily Backup', description: 'Local-only fixture',
    instructions: 'Back up my documents', trigger: 'manual', enabled: true,
    createdAt: '2026-09-29T00:00:00.000Z',
  }], null, 2);
  fs.writeFileSync(automationFile, original);

  const { app, page } = await launchElectronApp({
    HOMEBOT_E2E: '1', HOMEBOT_DIRECT_OLLAMA: '1', HOMEBOT_TIER: 'free', NODE_ENV: 'test',
    USERPROFILE: home, HOME: home, ANCIENT_PATHWAYS_DIR: ancientPathways,
    HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'movie-projects'),
  }, profile);
  const owned = app.process();
  try {
    const license = await page.evaluate(() => window.electron.licenseStatus!());
    console.log(`[AUTOMATION-GATE E2E] license tier ${license.tier}`);
    expect(license.tier).toBe('free');
    expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);

    const directDelete = await page.evaluate(async () =>
      (await window.electron.deleteAutomation!({ id: 'local-1', force: true })) as unknown as { status?: string }
    );
    expect(directDelete.status).toBe('upgrade_required');
    expect(fs.readFileSync(automationFile, 'utf8')).toBe(original);
    console.log('[AUTOMATION-GATE E2E] direct Free delete blocked; file intact');

    await page.locator('button.mode-btn', { hasText: 'Automation' }).click();
    await expect(page.getByRole('heading', { name: 'Automation Center' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Daily Backup' })).toBeVisible();
    console.log('[AUTOMATION-GATE E2E] Automation Center row visible');

    await page.getByRole('button', { name: 'Edit Daily Backup' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Weekly Backup');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.hb-modal-overlay').getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Weekly Backup');
    expect(fs.readFileSync(automationFile, 'utf8')).toBe(original);
    console.log('[AUTOMATION-GATE E2E] Free edit blocked; draft and file intact');
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Daily Backup' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Daily Backup' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.hb-modal-overlay').getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Daily Backup' })).toBeVisible();
    expect(fs.readFileSync(automationFile, 'utf8')).toBe(original);
    console.log('[AUTOMATION-GATE E2E] Free UI delete blocked; row and file intact');
  } finally {
    console.log(`[AUTOMATION-GATE E2E] closing owned Electron PID ${owned.pid}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        app.close(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Owned Electron app.close did not finish within 25 seconds')), 25_000);
        }),
      ]);
    } catch (error) {
      if (owned.exitCode === null && owned.signalCode === null) owned.kill();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true);
    console.log(`[AUTOMATION-GATE E2E] owned Electron PID ${owned.pid} exited`);
  }
});
