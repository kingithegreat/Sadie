import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createStudioOutputSpec, type StudioAspectRatio } from '../../shared/media-output';
import { launchFocusedStudioApp as launchElectronApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

// Diagnostic geometry, not approved artwork or narration acceptance. The separate
// caption export test exercises actual local speech. No provider is called here.
const cases: Array<{ intent: 'short' | 'long'; ratio: StudioAspectRatio; framing: 'fit' | 'crop'; resolution?: '720p' | '1080p' }> = [
  { intent: 'short', ratio: '16:9', framing: 'fit' },
  { intent: 'short', ratio: '9:16', framing: 'fit' },
  { intent: 'long', ratio: '16:9', framing: 'fit' },
  { intent: 'long', ratio: '9:16', framing: 'fit' },
  { intent: 'short', ratio: '1:1', framing: 'crop' },
  { intent: 'short', ratio: '16:9', framing: 'crop', resolution: '1080p' },
  { intent: 'short', ratio: '9:16', framing: 'crop', resolution: '1080p' },
  { intent: 'short', ratio: '1:1', framing: 'fit', resolution: '1080p' },
];

for (const { intent, ratio, framing, resolution = '720p' } of cases) {
  test(`Studio saved format ${intent} ${ratio} ${framing} ${resolution} encodes and reopens`, async ({}, testInfo) => {
    test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Opt in with installed FFmpeg; no downloads.');
    test.setTimeout(360_000);
    const ffmpeg = process.env.HOMEBOT_FFMPEG!;
    expect(ffmpeg).toBeTruthy();
    expect(fs.existsSync(ffmpeg)).toBe(true);
    const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-formats-proof-'));
    const projects = path.join(profile, 'projects');
    const projectId = 'format-proof';
    const projectDir = path.join(projects, projectId);
    const duration = intent === 'long' ? 66 : 4;
    fs.mkdirSync(projectDir, { recursive: true });
    const originalSpec = createStudioOutputSpec('16:9', intent);
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ projectId, name: 'Format proof', outputSpec: originalSpec, burnSubtitles: false }));
    for (let n = 1; n <= 2; n++) {
      const scene = path.join(projectDir, 'scenes', `scene_0${n}`);
      const shot = path.join(scene, 'shot_01');
      fs.mkdirSync(path.join(shot, 'image'), { recursive: true });
      // A square marker on a 4:3 source makes stretching observable in encoded pixels.
      run(['-y', '-f', 'lavfi', '-i', `color=c=${n === 1 ? '0x164E80' : '0xBD561E'}:s=640x480:d=1,drawbox=x=270:y=190:w=100:h=100:color=white:t=fill`, '-frames:v', '1', path.join(shot, 'image', 'frame.png')]);
      fs.writeFileSync(path.join(shot, 'prompt.json'), JSON.stringify({ prompt: `Diagnostic image ${n}`, durationSec: duration / 2, movement: 'static' }));
      fs.writeFileSync(path.join(shot, 'script.txt'), '');
      fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId: `scene_0${n}`, order: n, shots: ['shot_01'] }));
    }
    const launchEnv = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects, HOMEBOT_FFMPEG: ffmpeg };
    let { app, page } = await launchElectronApp(launchEnv, profile);
    const openBoard = async () => {
      await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
      await page.getByRole('tab', { name: /Storyboard/ }).click();
      await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(projectId);
      await expect(page.locator('.ms-storyboard-meta-path')).toContainText(projectId);
    };
    try {
      await waitForAppReady(page);
      expect(await dismissFirstRun(page)).toBe(true);
      await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, permissions: { media_render_storyboard: true } }));
      await openBoard();
      await page.getByLabel('Storyboard picture shape', { exact: true }).selectOption(ratio);
      await page.getByLabel('Storyboard resolution', { exact: true }).selectOption(resolution);
      await page.getByLabel('Storyboard image framing', { exact: true }).selectOption(framing);
      await expect(page.getByLabel('Duration for shot_01')).toHaveValue(String(duration / 2));
      await page.getByRole('button', { name: /Render Movie/ }).click();
      const board = page.getByRole('region', { name: 'Visual Storyboard Deck' });
      await expect(board.getByRole('status')).toContainText('Successfully rendered', { timeout: 240_000 });
      const meta = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
      const outputSpec = createStudioOutputSpec(ratio, intent, resolution, framing);
      expect(meta.outputSpec).toEqual(outputSpec);
      expect(meta.latestSuccessfulOutput.outputSpec).toEqual(outputSpec);
      const movie = path.join(projectDir, 'renders', meta.latestSuccessfulOutput.filename);
      const hash = createHash('sha256').update(fs.readFileSync(movie)).digest('hex');
      const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', movie], { windowsHide: true, timeout: 30_000 }).toString());
      const video = info.streams.find((stream: any) => stream.codec_type === 'video');
      const { width, height } = outputSpec.variants[0];
      expect(video).toMatchObject({ width, height, r_frame_rate: '30/1', sample_aspect_ratio: '1:1', pix_fmt: 'yuv420p' });
      expect(Math.abs(Number(info.format.duration) - duration)).toBeLessThan(0.15);
      expect(Number(video.nb_frames)).toBe(duration * 30);
      run(['-y', '-ss', '0.5', '-i', movie, '-frames:v', '1', testInfo.outputPath('encoded-frame.png')]);
      const pixels = run(['-ss', '0.5', '-i', movie, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      let left = width, right = 0, top = height, bottom = 0, count = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3;
        if (pixels[offset] > 225 && pixels[offset + 1] > 225 && pixels[offset + 2] > 225) {
          count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      expect(count).toBeGreaterThan(500);
      expect(Math.abs((right - left + 1) / (bottom - top + 1) - 1)).toBeLessThan(0.025);
      const corner = [...pixels.subarray((10 * width + 10) * 3, (10 * width + 10) * 3 + 3)];
      if (framing === 'fit') expect(Math.max(...corner)).toBeLessThan(10);
      else expect(corner[2]).toBeGreaterThan(corner[0] + 30);
      const jobs = await page.evaluate(() => window.electron.mediaList!());
      expect(jobs.find((job: any) => job.renderPath === movie)).toMatchObject({ state: 'awaiting_approval', outputSpec, format: intent });
      await page.getByLabel('Storyboard picture shape', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('saved-output-controls.png') });
      await page.getByRole('group', { name: 'Storyboard output settings' }).screenshot({ path: testInfo.outputPath('framing-controls.png') });
      await app.close();
      ({ app, page } = await launchElectronApp(launchEnv, profile));
      await waitForAppReady(page);
      await openBoard();
      await expect(page.getByLabel('Storyboard picture shape', { exact: true })).toHaveValue(ratio);
      await expect(page.getByRole('button', { name: /Review & Publish/ })).toBeEnabled();
      const player = page.getByLabel('Exported storyboard video');
      await expect.poll(() => player.evaluate((element: HTMLVideoElement) => ({ width: element.videoWidth, height: element.videoHeight, duration: element.duration })))
        .toEqual({ width, height, duration });
      await player.evaluate(async (element: HTMLVideoElement) => { await element.play(); });
      await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1);
      await player.evaluate((element: HTMLVideoElement) => { element.currentTime = element.duration - 0.25; });
      await expect.poll(() => player.evaluate((element: HTMLVideoElement) => ({ ended: element.ended, loop: element.loop }))).toEqual({ ended: true, loop: false });
      expect(createHash('sha256').update(fs.readFileSync(movie)).digest('hex')).toBe(hash);
      const evidence = { profile, movie, sha256: hash, outputSpec, encoded: video, duration, squareMarker: { left, right, top, bottom, count }, corner, reopenedAndPlayed: true };
      fs.writeFileSync(testInfo.outputPath('format-evidence.json'), JSON.stringify(evidence, null, 2));
      console.log('STUDIO_FORMAT_EVIDENCE', JSON.stringify(evidence));
    } finally {
      await app.close(); // Retain the isolated fixture and media as evidence.
    }
  });
}
