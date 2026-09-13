import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createStudioOutputSpec } from '../../shared/media-output';
import { launchFocusedStudioApp as launchElectronApp, focusStudioWindow } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('ordinary job keeps the successful movie selected after a real QA-rejected replacement', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Installed FFmpeg and diagnostic local fixtures only.');
  test.setTimeout(240_000);
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
  const baseJob = {
    id, title: 'Job recovery proof', format: 'short', state: 'media_production', narrationPath: audio,
    burnSubtitles: false, outputSpec: createStudioOutputSpec('16:9', 'short', '720p', 'crop'),
    durationSeconds: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  };
  fs.writeFileSync(jobsFile, JSON.stringify([baseJob, { ...baseJob, id: 'job-b', title: 'Independent project B' }]));
  const read = () => JSON.parse(fs.readFileSync(jobsFile, 'utf8'))[0];
  const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const launchEnv = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg };
  let { app, page } = await launchElectronApp(launchEnv, profile);
  const focusTestWindow = () => focusStudioWindow(app, page);
  const playToEnd = async () => {
    const player = page.getByTestId(`ms-video-${id}`);
    await player.scrollIntoViewIfNeeded();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 0; return video.play(); });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({ ended: video.ended, paused: video.paused, loop: video.loop, error: video.error?.code ?? null })), { timeout: 10_000 })
      .toEqual({ ended: true, paused: true, loop: false, error: null });
  };
  try {
    await focusTestWindow();
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, mediaMusicEnabled: false, permissions: { media_render: true } }));
    await focusTestWindow();
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    const first = await page.evaluate(({ id, image }) => window.electron.mediaRun!(id, 'render', { image }), { id, image: goodImage });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const good = read();
    const beforeHash = digest(good.renderPath);
    const renderedB = await page.evaluate(({ image }) => window.electron.mediaRun!('job-b', 'render', { image }), { image: goodImage });
    expect(renderedB.ok, JSON.stringify(renderedB)).toBe(true);
    const goodB = JSON.parse(fs.readFileSync(jobsFile, 'utf8'))[1];
    expect(goodB.renderPath).not.toBe(good.renderPath);
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
    const player = page.getByTestId(`ms-video-${id}`);
    await expect(player).toBeVisible();
    await player.scrollIntoViewIfNeeded();
    const displayedSource = await player.getAttribute('src');
    await page.screenshot({ path: testInfo.outputPath('failed-replacement-workspace.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('job-recovery-evidence.json'), JSON.stringify({ profile, good, failed, displayedSource, beforeHash, replacement }, null, 2));
    expect(failed.renderPath).toBe(good.renderPath);
    await expect(page.getByTestId(`ms-video-${id}`)).toHaveAttribute('src', new RegExp(path.basename(good.renderPath).replace(/\./g, '\\.')));
    await expect(page.getByText(/latest attempt failed/i)).toBeVisible();
    await expect(page.getByText('Your episode is ready to watch!')).toHaveCount(0);
    await playToEnd();
    const bCard = page.locator('[data-job-id="job-b"]');
    await bCard.getByRole('button', { name: 'Movie details and history' }).click();
    await expect(page.getByLabel('Export history')).toHaveValue(goodB.renderPath);
    expect(JSON.parse(fs.readFileSync(jobsFile, 'utf8'))[1].latestExportAttempt.status).toBe('succeeded');
    await page.locator(`[data-job-id="${id}"]`).getByRole('button', { name: 'Movie details and history' }).click();
    await expect(page.getByLabel('Export history')).toHaveValue(good.renderPath);

    await app.close();
    ({ app, page } = await launchElectronApp(launchEnv, profile));
    await focusTestWindow();
    await waitForAppReady(page);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await expect(page.getByText(/Previous successful export.*latest attempt failed/i)).toBeVisible();
    await playToEnd();
    expect(digest(good.renderPath)).toBe(beforeHash);
    // Repair this test-owned source image, then use the visible retry action.
    fs.copyFileSync(goodImage, flatImage);
    await page.getByRole('button', { name: 'Retry export with saved inputs' }).click();
    await expect.poll(() => read().latestExportAttempt.status, { timeout: 90_000 }).toBe('succeeded');
    const retry = read();
    expect(retry.renderPath).not.toBe(good.renderPath);
    expect(digest(good.renderPath)).toBe(beforeHash);
    await expect(page.getByLabel('Export history')).toHaveValue(retry.renderPath);
    await expect(page.getByText('Preview matches the saved revision')).toBeVisible();
    const aCard = page.locator(`[data-job-id="${id}"]`);
    await aCard.getByRole('button', { name: 'Move to awaiting approval' }).click();
    await expect(aCard.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
    await page.getByLabel('Export history').selectOption(good.renderPath);
    await expect(aCard.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
    await playToEnd();
    await app.evaluate(({ shell }) => {
      (globalThis as any).jobRecoveryFileActions = [];
      shell.showItemInFolder = file => { (globalThis as any).jobRecoveryFileActions.push(file); };
    });
    await aCard.getByRole('button', { name: /Open file location/ }).click();
    expect(await app.evaluate(() => (globalThis as any).jobRecoveryFileActions)).toEqual([good.renderPath]);
    const wrongApproval = await page.evaluate(({ id, old }) => window.electron.mediaApprove!(id, undefined, old), { id, old: good.renderPath });
    expect(wrongApproval.ok).toBe(false);
    expect(wrongApproval.error).toMatch(/current movie changed/i);
    expect(read().state).toBe('awaiting_approval'); // No test approves or publishes a movie.
    await aCard.screenshot({ path: testInfo.outputPath('history-review-read-only.png'), animations: 'disabled' });
    await aCard.getByTitle('Inspect in CapCut Multi-Track Timeline').click();
    await expect(page.getByLabel('Timeline video preview')).toHaveAttribute('src', new RegExp(path.basename(good.renderPath).replace(/\./g, '\\.')));
    fs.writeFileSync(testInfo.outputPath('job-recovery-complete.json'), JSON.stringify({ profile, good, goodB, failed, retry,
      beforeHash, finalGoodHash: digest(good.renderPath), retryHash: digest(retry.renderPath), wrongApproval,
      history: await page.evaluate(id => window.electron.mediaGetExportState!(id), id),
      source: 'Local diagnostic stills and three-second synthetic audio, no providers or publication.' }, null, 2));
  } catch (error) {
    fs.writeFileSync(testInfo.outputPath('failure-surface.json'), JSON.stringify({
      jobs: JSON.parse(fs.readFileSync(jobsFile, 'utf8')),
      windows: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
        title: window.getTitle(), visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), bounds: window.getBounds() }))).catch(() => []),
      document: await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus(),
        buttons: [...document.querySelectorAll('button.mode-btn')].map(button => ({ text: button.textContent,
          bounds: button.getBoundingClientRect().toJSON(), display: getComputedStyle(button).display })) })).catch(() => null),
    }, null, 2));
    await page.screenshot({ path: testInfo.outputPath('failure-surface.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally { await app.close(); }
});
