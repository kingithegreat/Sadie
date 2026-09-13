import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createStudioOutputSpec } from '../../shared/media-output';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('ordinary job keeps the successful movie selected after a real QA-rejected replacement', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Installed FFmpeg and diagnostic local fixtures only.');
  test.setTimeout(180_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg).toBeTruthy();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-job-recovery-proof-'));
  const goodImage = path.join(profile, 'good.png');
  const flatImage = path.join(profile, 'flat.png');
  const audio = path.join(profile, 'audio.wav');
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 60_000 });
  run(['-y', '-f', 'lavfi', '-i', 'color=c=0x164E80:s=640x480:d=1,drawbox=x=180:y=130:w=280:h=220:color=white:t=fill', '-frames:v', '1', goodImage]);
  run(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=640x480:d=1', '-frames:v', '1', flatImage]);
  run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '48000', audio]);
  const id = 'job-recovery-proof';
  const jobsFile = path.join(profile, 'media-jobs.json');
  fs.writeFileSync(jobsFile, JSON.stringify([{
    id, title: 'Job recovery proof', format: 'short', state: 'media_production', narrationPath: audio,
    burnSubtitles: false, outputSpec: createStudioOutputSpec('16:9', 'short', '720p', 'crop'),
    durationSeconds: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  }]));
  const read = () => JSON.parse(fs.readFileSync(jobsFile, 'utf8'))[0];
  const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg }, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.bringToFront();
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, mediaMusicEnabled: false, permissions: { media_render: true } }));
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    const first = await page.evaluate(({ id, image }) => window.electron.mediaRun!(id, 'render', { image }), { id, image: goodImage });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const good = read();
    const beforeHash = digest(good.renderPath);
    for (const state of ['needs_revision', 'media_production']) {
      const moved = await page.evaluate(({ id, state }) => window.electron.mediaAdvance!(id, state), { id, state });
      expect(moved.ok, JSON.stringify(moved)).toBe(true);
    }
    const replacement = await page.evaluate(({ id, image }) => window.electron.mediaRun!(id, 'render', { image }), { id, image: flatImage });
    expect(replacement.ok).toBe(false);
    expect(replacement.error).toMatch(/flat|placeholder/i);
    const failed = read();
    expect(digest(good.renderPath)).toBe(beforeHash);
    await page.locator('button.mode-btn', { hasText: 'Chat' }).click();
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await expect(page.getByTestId(`ms-video-${id}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('failed-replacement-workspace.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('job-recovery-evidence.json'), JSON.stringify({ profile, good, failed, beforeHash, replacement }, null, 2));
    expect(failed.renderPath).toBe(good.renderPath);
    await expect(page.getByTestId(`ms-video-${id}`)).toHaveAttribute('src', new RegExp(path.basename(good.renderPath).replace(/\./g, '\\.')));
    await expect(page.getByText(/latest attempt failed/i)).toBeVisible();
    await expect(page.getByText('Your episode is ready to watch!')).toHaveCount(0);
  } finally { await app.close(); }
});
