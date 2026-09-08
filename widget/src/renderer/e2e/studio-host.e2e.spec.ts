import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('Studio creates a real storyboard through its trusted module and Core tool executor', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-studio-host-'));
  const projects = path.join(profile, 'projects');
  fs.mkdirSync(projects);
  const { app, page } = await launchElectronApp({
    HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects,
  }, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    await page.getByRole('button', { name: '+ New Storyboard', exact: true }).click();
    await page.getByRole('textbox', { name: 'Storyboard title', exact: true }).fill('Host boundary fixture');
    await page.getByRole('textbox', { name: 'Storyboard notes', exact: true }).fill('Created through the visible Studio button.');
    await page.getByRole('button', { name: 'Create Storyboard Project', exact: true }).click();
    await expect(page.locator('.ms-storyboard-meta-path')).toBeVisible();
    const projectDirs = fs.readdirSync(projects);
    expect(projectDirs).toHaveLength(1);
    const projectDir = path.join(projects, projectDirs[0]);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'))).toMatchObject({
      name: 'Host boundary fixture', notes: 'Created through the visible Studio button.',
    });
    const scene = JSON.parse(fs.readFileSync(path.join(projectDir, 'scenes', 'scene_01', 'scene.json'), 'utf8'));
    expect(scene.shots).toHaveLength(3);
    expect(fs.readFileSync(path.join(projectDir, 'scenes', 'scene_01', scene.shots[0], 'script.txt'), 'utf8')).toContain('Host boundary fixture');
    const events = fs.readFileSync(path.join(profile, 'logs', 'telemetry-events.log'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.event === 'module_lifecycle' && event.details.moduleId === 'homebot.production-studio' && event.details.statusAfter === 'enabled')).toHaveLength(1);
    // Existing executor telemetry proves the button did not bypass the tool policy authority.
    expect(events.some(event => event.event === 'tool_call' && event.details.tool === 'media_create_storyboard' && event.details.outcome === 'success')).toBe(true);
  } finally {
    await app.close();
    // Retain the disposable profile and generated fixture for diagnosis; never use real projects.
  }
});
