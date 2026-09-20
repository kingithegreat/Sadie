import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startMockUpstream } from './mockUpstream';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

process.env.HOMEBOT_E2E = '1';

function seedProfile(ollamaUrl: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-clipboard-proof-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'user-settings.json'), JSON.stringify({
    firstRun: false,
    theme: 'dark',
    ollamaUrl,
    uncensoredMode: false,
    chatModel: 'mock-model',
    ollamaModel: 'mock-model',
  }), 'utf8');
  return dir;
}

test('Copy response writes to the OS clipboard and restores a plain-text clipboard', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_CLIPBOARD_PROOF !== '1', 'opt-in: set HOMEBOT_CLIPBOARD_PROOF=1 to permit an OS clipboard write');
  const upstream = await startMockUpstream({ chunkIntervalMs: 250, chunkCount: 3 });
  const userDataDir = seedProfile(upstream.baseUrl);
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-clipboard-proof-home-'));
  let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
  let snapshot: { formats: string[]; text: string } | undefined;
  let copyAttempted = false;
  // HOMEBOT_E2E_BYPASS_MOCK=0 selects message-router's five-chunk fixture.
  const expectedText = 'chunk-1chunk-2chunk-3chunk-4chunk-5';
  const probeText = `HomeBot clipboard proof ${Date.now()}-${Math.random()}`;
  try {
    app = await launchElectronApp({
      HOMEBOT_E2E: '1',
      HOMEBOT_DIRECT_OLLAMA: '0',
      HOMEBOT_E2E_BYPASS_MOCK: '0',
      N8N_URL: upstream.baseUrl,
      PROXY_RETRY_ENABLED: 'false',
      NODE_ENV: 'test',
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      HOMEBOT_WORKSPACE_ROOT: isolatedHome,
      HOMEBOT_MOVIE_PROJECTS_DIR: path.join(isolatedHome, 'movie-projects'),
    }, userDataDir);
    await waitForAppReady(app.page);

    await app.page.getByLabel('Message HomeBot').fill('clipboard proof');
    await app.page.locator('button.send-button').click();
    const assistant = app.page.locator('[data-role="assistant-message"]:has-text("chunk-5")').first();
    await expect(assistant).toBeVisible({ timeout: 15000 });
    const copyButton = assistant.locator('button[aria-label="Copy response"]');
    await expect(copyButton).toBeVisible();
    // Snapshot immediately before the click, never while waiting for the reply.
    // Do not read or attempt to reconstruct rich/custom clipboard formats.
    const prior = await app.app.evaluate(({ clipboard }, probe) => {
      const formats = clipboard.availableFormats();
      if (formats.length > 0 && !(formats.length === 1 && formats[0] === 'text/plain')) return null;
      const saved = { formats, text: clipboard.readText() };
      // Positive control: a stale copy of the expected response must not pass.
      clipboard.writeText(probe);
      return saved;
    }, probeText);
    test.skip(prior === null, 'Safe proof skips rich/custom clipboard content without modifying it.');
    snapshot = prior!;
    copyAttempted = true;
    expect(await app.app.evaluate(({ clipboard }, probe) => clipboard.readText() === probe, probeText)).toBe(true);
    await copyButton.click();
    // Return only a boolean: assertion failures must not print owner clipboard data.
    await expect.poll(() => app!.app.evaluate(({ clipboard }, expected) => clipboard.readText() === expected, expectedText)).toBe(true);
    await app.page.screenshot({ path: testInfo.outputPath('copy-response.png') });
  } finally {
    try {
      if (app && snapshot && copyAttempted) {
        const restorationOk = await app.app.evaluate(({ clipboard }, { prior, expected, probe }) => {
          const formats = clipboard.availableFormats();
          // A later owner copy takes precedence. Never replace it during cleanup.
          if (formats.length !== 1 || formats[0] !== 'text/plain') return true;
          const current = clipboard.readText();
          if (current !== expected && current !== probe) return true;
          if (prior.formats.includes('text/plain')) clipboard.writeText(prior.text);
          else clipboard.clear();
          return JSON.stringify(clipboard.availableFormats()) === JSON.stringify(prior.formats)
            && clipboard.readText() === prior.text;
        }, { prior: snapshot, expected: expectedText, probe: probeText });
        expect(restorationOk).toBe(true);
      }
    } finally {
      try {
        await app?.app.close();
      } finally {
        await upstream.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(isolatedHome, { recursive: true, force: true });
      }
    }
  }
});
