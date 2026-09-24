import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createStudioOutputSpec } from '../../shared/media-output';
import { launchFocusedStudioApp as launchElectronApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('Studio distinguishes edited A from failed B and preserves each good movie after restart', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Requires installed FFmpeg; diagnostic images only, no provider calls.');
  test.setTimeout(360_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg && fs.existsSync(ffmpeg)).toBeTruthy();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-freshness-proof-'));
  const projects = path.join(profile, 'projects');
  for (const projectId of ['freshness-a', 'freshness-b']) {
    const projectDir = path.join(projects, projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ projectId, name: projectId, outputSpec: createStudioOutputSpec('16:9', 'short', '720p'), burnSubtitles: false }));
    for (let n = 1; n <= 2; n++) {
      const scene = path.join(projectDir, 'scenes', `scene_0${n}`);
      const shot = path.join(scene, 'shot_01');
      fs.mkdirSync(path.join(shot, 'image'), { recursive: true });
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${n === 1 ? '0x164E80' : '0xBD561E'}:s=640x480:d=1,drawbox=x=270:y=190:w=100:h=100:color=white:t=fill`, '-frames:v', '1', path.join(shot, 'image', 'frame.png')], { windowsHide: true, timeout: 60_000 });
      fs.writeFileSync(path.join(shot, 'prompt.json'), JSON.stringify({ prompt: `${projectId} diagnostic ${n}`, durationSec: 2, movement: 'static' }));
      fs.writeFileSync(path.join(shot, 'script.txt'), '');
      fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId: `scene_0${n}`, order: n, shots: ['shot_01'] }));
    }
  }
  const launchEnv = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects, HOMEBOT_FFMPEG: ffmpeg };
  let { app, page } = await launchElectronApp(launchEnv, profile);
  const meta = (id: string) => JSON.parse(fs.readFileSync(path.join(projects, id, 'project.json'), 'utf8'));
  const movie = (id: string) => path.join(projects, id, 'renders', meta(id).latestSuccessfulOutput.filename);
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const enterStudio = async () => {
    await page.bringToFront();
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
  };
  const choose = async (id: string) => {
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(id);
    await expect(page.locator('.ms-storyboard-meta-path')).toContainText(id);
  };
  const render = async () => {
    await page.getByRole('button', { name: /Render Movie/ }).click();
    await expect(page.getByRole('region', { name: 'Visual Storyboard Deck' }).getByRole('status')).toContainText('Successfully rendered', { timeout: 120_000 });
  };
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, permissions: { media_render_storyboard: true } }));
    await enterStudio();
    await choose('freshness-a');
    await render();
    const movieA = movie('freshness-a');
    const hashA = hash(movieA);
    await page.getByLabel('Duration for shot_01').fill('3');
    await page.getByRole('button', { name: /Save Board/ }).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(projects, 'freshness-a', 'scenes', 'scene_01', 'shot_01', 'prompt.json'), 'utf8')).durationSec).toBe(3);
    expect(hash(movieA)).toBe(hashA); // Positive control: the old good file still exists.
    await expect(page.getByText(/Preview out of date/i)).toBeVisible();
    await page.getByRole('region', { name: 'Export freshness' }).screenshot({ path: testInfo.outputPath('edited-a-preview.png'), animations: 'disabled' });

    await choose('freshness-b');
    await render();
    const movieB = movie('freshness-b');
    const hashB = hash(movieB);
    const frameB = path.join(projects, 'freshness-b', 'scenes', 'scene_01', 'shot_01', 'image', 'frame.png');
    const originalFrameB = fs.readFileSync(frameB);
    fs.writeFileSync(frameB, 'Deliberately corrupt diagnostic image: replacement must fail.');
    await page.getByRole('button', { name: /Render Movie/ }).click();
    await expect(page.getByText(/Previous successful export.*latest attempt failed/i)).toBeVisible({ timeout: 120_000 });
    expect(hash(movieB)).toBe(hashB);
    await app.close();
    ({ app, page } = await launchElectronApp(launchEnv, profile));
    await waitForAppReady(page);
    await enterStudio();
    await choose('freshness-a');
    await expect(page.getByLabel('Exported storyboard video')).toHaveAttribute('src', /freshness-a/);
    await expect(page.getByText(/Preview out of date/i)).toBeVisible();
    await expect(page.getByText(/latest attempt failed/i)).toHaveCount(0);
    expect(hash(movieA)).toBe(hashA);
    await choose('freshness-b');
    const player = page.getByLabel('Exported storyboard video');
    await expect(player).toHaveAttribute('src', /freshness-b/);
    await expect(page.getByText(/Previous successful export.*latest attempt failed/i)).toBeVisible();
    // Milestone A: last-good bytes must survive the injected failure AND the restart
    // before owner playback; src must still resolve to the pre-failure movie path.
    expect(movie('freshness-b')).toBe(movieB);
    expect(hash(movieB)).toBe(hashB);
    await player.evaluate(async (video: HTMLVideoElement) => { await video.play(); });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
    expect(hash(movieB)).toBe(hashB);
    fs.writeFileSync(frameB, originalFrameB);
    await render();
    const replacementB = movie('freshness-b');
    expect(replacementB).not.toBe(movieB);
    expect(hash(movieB)).toBe(hashB);
    expect(meta('freshness-b').latestExportAttempt.status).toBe('succeeded');
    await expect(page.getByText(/latest attempt failed/i)).toHaveCount(0);
    // Opening/revealing uses the real guarded preload/IPC path. Trap only the
    // OS-launch boundary so this verification does not open unrelated desktop apps.
    await app.evaluate(({ shell }) => {
      const state = globalThis as any;
      state.freshnessFileActions = [];
      state.freshnessOpenError = '';
      shell.openPath = async file => { state.freshnessFileActions.push({ action: 'open', file }); return state.freshnessOpenError; };
      shell.showItemInFolder = file => { state.freshnessFileActions.push({ action: 'reveal', file }); };
    });
    await page.getByLabel('Export history').selectOption(movieB);
    await expect(page.getByLabel('Exported storyboard video')).toHaveAttribute('src', new RegExp(path.basename(movieB).replace(/\./g, '\\.')));
    await page.getByRole('button', { name: /Open Video/ }).click();
    await page.getByRole('button', { name: 'Show in Folder' }).click();
    expect(await app.evaluate(() => (globalThis as any).freshnessFileActions)).toEqual([
      { action: 'open', file: movieB }, { action: 'reveal', file: movieB },
    ]);
    await app.evaluate(() => { (globalThis as any).freshnessOpenError = 'No default video player is configured.'; });
    await page.getByRole('button', { name: /Open Video/ }).click();
    await expect(page.getByRole('alert')).toContainText('No default video player is configured.');
    await page.getByLabel('Export history').selectOption(replacementB);
    await page.getByRole('button', { name: /Review & Publish/ }).click();
    await expect(page.getByRole('tab', { name: /Director Console/ })).toHaveAttribute('aria-selected', 'true');
    expect((await page.evaluate(() => window.electron.mediaList!())).find((job: any) => job.renderPath === replacementB)?.state).toBe('awaiting_approval');
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    const sceneExport = await page.evaluate(() => window.electron.mediaStoryboardRender!({ projectId: 'freshness-b', sceneId: 'scene_01' }));
    expect(sceneExport.ok).toBe(true);
    expect(movie('freshness-b')).toBe(replacementB); // A scene never becomes the whole-movie pointer.
    await choose('freshness-a');
    await choose('freshness-b');
    await page.getByLabel('Export history').selectOption(sceneExport.moviePath!);
    await expect(page.getByText('Preview matches the saved revision')).toBeVisible();
    await expect(page.getByText('Saved source (scene scene_01)')).toBeVisible();
    await page.getByLabel('Export history').selectOption(replacementB);
    await page.getByRole('region', { name: 'Export freshness' }).screenshot({ path: testInfo.outputPath('recovered-b-preview.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('freshness-evidence.json'), JSON.stringify({
      profile, movieA, hashA, movieB, hashB, replacementB, replacementHash: hash(replacementB),
      sceneExport, projectA: meta('freshness-a'), projectB: meta('freshness-b'),
      historicalOpenRevealIpcVerified: true, osLaunchTrapped: true, openFailureVisible: true, reviewWithoutApproval: true,
      // Milestone A / #390: injected corrupt-frame re-render on freshness-b kept movieB
      // byte-identical through restart + playback; path and sha256 retained for owner review.
      milestoneALastGoodAfterRestart: true,
      milestoneAInjectedFailureProject: 'freshness-b',
      milestoneALastGoodPath: movieB,
      milestoneALastGoodSha256: hashB,
      milestoneAPlayableAfterRestart: true,
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(testInfo.outputPath('failure-surface.json'), JSON.stringify(await page.evaluate(() => ({
      title: document.title, body: document.body.innerText, viewport: { width: innerWidth, height: innerHeight },
      buttons: [...document.querySelectorAll('button.mode-btn')].map(button => ({ text: button.textContent, rect: button.getBoundingClientRect().toJSON(), display: getComputedStyle(button).display })),
    })).catch(() => ({ unavailable: true })), null, 2));
    await page.screenshot({ path: testInfo.outputPath('failure-surface.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally {
    await app.close(); // Preserve all diagnostic projects and previous-good outputs.
  }
});
