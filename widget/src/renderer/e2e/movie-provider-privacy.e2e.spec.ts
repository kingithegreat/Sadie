import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('Movie Router displays Online denial and persists failure without contacting providers', async ({}, testInfo) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-movie-privacy-e2e-'));
  // Movie Router discovers this existing product location. Only this unique
  // fixture is executed/deleted; other projects are never modified.
  const projectsRoot = path.join(os.homedir(), 'Desktop', 'homebot-movie-projects');
  fs.mkdirSync(projectsRoot, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(projectsRoot, 'privacy-e2e-'));
  const projectId = path.basename(projectDir);
  const shotDir = path.join(projectDir, 'scenes', 'scene_01', 'shot_01');
  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ projectId, name: projectId, freeOnly: true }));
  fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify({
    kind: 'image', prompt: 'Private movie fixture', shotId: 'shot_01', width: 3000, height: 1700,
  }));
  // A controlled local engine is discoverable but cannot satisfy this shot's
  // resolution. Its lock also prevents accidental execution if routing regresses.
  const ancient = path.join(profile, 'ancient-fixture');
  fs.mkdirSync(path.join(ancient, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(ancient, 'run_pipeline.py'), '# Test fixture; never executed.');
  fs.writeFileSync(path.join(ancient, 'workspace', 'render.lock'), JSON.stringify({ pid: process.pid, ts: Date.now() / 1000 }));
  const { app, page } = await launchElectronApp({
    HOMEBOT_E2E: '1', NODE_ENV: 'test', ANCIENT_PATHWAYS_DIR: ancient,
    COMFY_ENDPOINT: 'http://render.example.invalid:8188',
    LOCAL_SD_ENDPOINT: 'https://render.example.invalid/sdapi/v1/txt2img',
  }, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false }));
    expect((await page.evaluate(() => window.electron.getSettings())).useCustomLLM).toBe(false);
    // Main-process transport traps observe only these provider destinations,
    // fail before I/O, and leave unrelated app startup traffic alone.
    expect(await app.evaluate(() => {
      const state = globalThis as typeof globalThis & { movieProviderAttempts: string[] };
      state.movieProviderAttempts = [];
      const inspect = (value: any) => {
        const destination = typeof value === 'string' ? value : String(value?.url || value?.hostname || value?.host || value);
        if (/pollinations\.ai|generativelanguage\.googleapis\.com|render\.example\.invalid/.test(destination)) {
          state.movieProviderAttempts.push(destination);
          throw new Error('Test intercepted unexpected provider request');
        }
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => { inspect(input); return originalFetch(input, init); };
      for (const moduleName of ['http', 'https']) {
        const transport = (process as any).getBuiltinModule(moduleName);
        const original = transport.request;
        transport.request = (...args: any[]) => { inspect(args[0]); return original.apply(transport, args); };
      }
      for (const invoke of [
        () => globalThis.fetch('https://api.pollinations.ai/positive-control'),
        () => (process as any).getBuiltinModule('http').request({ hostname: 'render.example.invalid' }),
        () => (process as any).getBuiltinModule('https').request({ hostname: 'render.example.invalid' }),
      ]) { try { invoke(); } catch { /* Each control must hit the trap. */ } }
      const count = state.movieProviderAttempts.length;
      state.movieProviderAttempts = [];
      return count;
    })).toBe(3);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Movie Router/ }).click();
    // Opening this tab loads projects automatically.
    await page.locator('.ms-movie-project-item').filter({ hasText: projectId })
      .getByRole('button', { name: /Route & Generate/ }).click();
    await expect(page.locator('.ms-runner--error')).toContainText('Online access is off. Turn on Online in Settings');
    await page.locator('.ms-runner--error').scrollIntoViewIfNeeded();
    await expect(page.locator('.ms-runner--error')).toBeVisible();
    await expect(page.locator('.ms-runner--ok')).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf8'))).toMatchObject({ status: 'FAILED' });
    expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'decision.json'), 'utf8')).rejected).toHaveLength(6);
    expect(fs.existsSync(path.join(shotDir, 'ticket.json'))).toBe(false);
    expect(fs.existsSync(path.join(shotDir, 'image', 'shot_01.png'))).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).movieProviderAttempts)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('movie-online-denial.png') });
  } finally {
    await app.close();
    // mkdtemp produced this exact child; never remove the shared projects root.
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
