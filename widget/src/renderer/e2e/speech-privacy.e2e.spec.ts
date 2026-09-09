import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('Studio default voice preview respects Online off through real IPC', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-speech-e2e-'));
  const jobsPath = path.join(profile, 'media-jobs.json');
  const job = {
    id: 'offline-preview', title: 'Private narration fixture', format: 'short',
    state: 'script_qa', script: 'Keep this narration on this PC.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  };
  fs.writeFileSync(jobsPath, JSON.stringify([job]));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(async () => {
      await (window as any).electron.saveSettings({ useCustomLLM: false, narrationEngine: 'edge' });
    });
    // Observe the real transport boundary, not a successful media mock. Trap
    // these provider requests so a regression cannot send the fixture online.
    expect(await app.evaluate(async () => {
      const scope = globalThis as any;
      scope.__speechRequests = [];
      const isSpeech = (value: any) => /speech\.platform\.bing\.com|huggingface\.co|speech-control\.invalid/.test(
        typeof value === 'string' ? value : String(value?.href || value?.hostname || value?.host || value?.url || ''),
      );
      const fetch = scope.fetch;
      scope.fetch = (...args: any[]) => {
        if (isSpeech(args[0])) { scope.__speechRequests.push(String(args[0])); throw new Error('Unexpected speech network request'); }
        return fetch(...args);
      };
      for (const name of ['http', 'https']) {
        const transport = (process as any).getBuiltinModule(name);
        for (const method of ['get', 'request']) {
          const original = transport[method];
          transport[method] = function (...args: any[]) {
            if (isSpeech(args[0])) { scope.__speechRequests.push(String(args[0]?.hostname || args[0])); throw new Error('Unexpected speech network request'); }
            return original.apply(this, args);
          };
        }
      }
      const controls = [() => scope.fetch('https://speech-control.invalid')];
      for (const name of ['http', 'https']) {
        for (const method of ['get', 'request']) controls.push(() => (process as any).getBuiltinModule(name)[method]('https://speech-control.invalid'));
      }
      for (const invoke of controls) { try { await invoke(); } catch { /* Expected denial. */ } }
      const observed = scope.__speechRequests.length;
      scope.__speechRequests = [];
      return observed;
    })).toBe(5);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Director Console/ }).click();
    await expect(page.getByRole('combobox', { name: 'Narration engine', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '▶ Sample', exact: true }).click();
    await expect(page.getByText('Online is off. Choose a voice on this PC after setup, or turn on Online in Settings to use online speech.', { exact: true })).toBeVisible();
    const voices = await page.evaluate(() => (window as any).electron.ttsListVoices());
    expect(voices.success).toBe(false);
    expect(voices.error).toContain('Online is off');
    expect(await app.evaluate(() => (globalThis as any).__speechRequests)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(jobsPath, 'utf8'))).toEqual([job]);
  } finally {
    await app.close();
  }
});
