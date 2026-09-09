import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('Modules disables Studio across restart, blocks real IPC, and restores one working workspace', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-module-ui-'));
  const projects = path.join(profile, 'projects');
  fs.mkdirSync(projects);
  const retainedFile = path.join(profile, 'my-project-notes.txt');
  fs.writeFileSync(retainedFile, 'Keep my project and source assets.');
  const env = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects };
  let running = await launchElectronApp(env, profile);
  try {
    await waitForAppReady(running.page);
    expect(await dismissFirstRun(running.page)).toBe(true);
    await expect(running.page.locator('button.mode-btn', { hasText: 'Studio' })).toHaveCount(1);
    const first = await running.page.evaluate(() => (window as any).electron.moduleList());
    expect(first.ok).toBe(true);
    const module = first.modules.find((item: any) => item.manifest.id === 'homebot.production-studio');
    expect(module.state).toBe('enabled');
    const toolNames: string[] = module.manifest.contributions.commands.map((id: string) => id.slice(id.lastIndexOf('.') + 1));
    expect(toolNames.length).toBeGreaterThan(10);
    await running.page.locator('button.mode-btn', { hasText: 'Modules' }).click();
    await expect(running.page.getByRole('heading', { name: 'Modules', exact: true })).toBeVisible();
    let card = running.page.getByRole('article', { name: 'Production Studio' });
    await expect(card.getByRole('status')).toHaveText('Enabled');
    await card.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('Disabled');
    await expect(running.page.locator('button.mode-btn', { hasText: 'Studio' })).toHaveCount(0);
    const tools = await running.page.evaluate(() => (window as any).electron.listTools());
    expect(tools.success).toBe(true);
    expect(tools.tools.length).toBeGreaterThan(0); // Core still has executable capabilities.
    expect(tools.tools.filter((tool: any) => toolNames.includes(tool.name))).toEqual([]);
    expect(await running.page.evaluate(() => (window as any).electron.mediaStoryboardCreate({ title: 'Must not run' })))
      .toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
    expect(fs.readdirSync(projects)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(profile, 'config', 'module-preferences.json'), 'utf8')).disabledModules)
      .toEqual(['homebot.production-studio']);
    await running.page.screenshot({ path: testInfo.outputPath('modules-disabled.png') });
    await running.app.close();

    running = await launchElectronApp(env, profile);
    await waitForAppReady(running.page);
    await running.page.locator('button.mode-btn', { hasText: 'Modules' }).click();
    card = running.page.getByRole('article', { name: 'Production Studio' });
    await expect(card.getByRole('status')).toHaveText('Disabled');
    await expect(running.page.locator('button.mode-btn', { hasText: 'Studio' })).toHaveCount(0);
    expect(await running.page.evaluate(() => (window as any).electron.mediaStoryboardCreate({ title: 'Still denied' })))
      .toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
    expect(fs.readFileSync(retainedFile, 'utf8')).toBe('Keep my project and source assets.');
    await card.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('Enabled');
    // A repeated real request must be idempotent, not duplicate registrations.
    expect(await running.page.evaluate(() => (window as any).electron.moduleSetEnabled('homebot.production-studio', true)))
      .toMatchObject({ ok: true });
    await expect(running.page.locator('button.mode-btn', { hasText: 'Studio' })).toHaveCount(1);
    const restored = await running.page.evaluate(() => (window as any).electron.listTools());
    for (const name of toolNames) expect(restored.tools.filter((tool: any) => tool.name === name)).toHaveLength(1);
    await running.page.screenshot({ path: testInfo.outputPath('modules-enabled.png') });
    await card.getByRole('button', { name: 'Open Studio', exact: true }).click();
    await running.page.getByRole('tab', { name: /Storyboard/ }).click();
    await running.page.getByRole('button', { name: '+ New Storyboard', exact: true }).click();
    await running.page.getByRole('textbox', { name: 'Storyboard title', exact: true }).fill('Restored Studio project');
    await running.page.getByRole('button', { name: 'Create Storyboard Project', exact: true }).click();
    await expect(running.page.locator('.ms-storyboard-meta-path')).toBeVisible();
    const directories = fs.readdirSync(projects);
    expect(directories).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(projects, directories[0], 'project.json'), 'utf8')))
      .toMatchObject({ name: 'Restored Studio project' });
    expect(JSON.parse(fs.readFileSync(path.join(profile, 'config', 'module-preferences.json'), 'utf8')).disabledModules).toEqual([]);
  } finally { await running.app.close(); }
});
