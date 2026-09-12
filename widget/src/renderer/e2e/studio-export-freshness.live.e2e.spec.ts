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
    await page.screenshot({ path: testInfo.outputPath('edited-a-preview.png') });
    await expect(page.getByText(/Preview out of date/i)).toBeVisible();

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
    await page.screenshot({ path: testInfo.outputPath('recovered-b-preview.png') });
    fs.writeFileSync(testInfo.outputPath('freshness-evidence.json'), JSON.stringify({ profile, movieA, hashA, movieB, hashB, replacementB, replacementHash: hash(replacementB), projectA: meta('freshness-a'), projectB: meta('freshness-b') }, null, 2));
  } finally {
    await app.close(); // Preserve all diagnostic projects and previous-good outputs.
  }
});
