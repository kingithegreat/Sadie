import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createStudioOutputSpec } from '../../shared/media-output';
import { launchFocusedStudioApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import { trapSpeechNetwork } from './helpers/speechNetworkTrap';

test('storyboard both formats reuse actual offline narration across restart and portrait-only export', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Installed FFmpeg and cached Kokoro are required.');
  test.setTimeout(360_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg).toBeTruthy();
  expect(process.env.HOMEBOT_KOKORO_TEST_CACHE).toBeTruthy();
  const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    windowsHide: true, timeout: 90_000, maxBuffer: 20 * 1024 * 1024,
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-storyboard-both-'));
  const projects = path.join(profile, 'projects');
  const projectId = 'storyboard-both-proof';
  const projectDir = path.join(projects, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  const metaFile = path.join(projectDir, 'project.json');
  fs.writeFileSync(metaFile, JSON.stringify({ projectId, name: 'Two-format narrated proof', burnSubtitles: false,
    outputSpec: createStudioOutputSpec('16:9', 'long', '720p') }));
  for (const [index, narration] of ['Blue scene begins.', 'Amber scene follows.'].entries()) {
    const sceneId = `scene_0${index + 1}`;
    const scene = path.join(projectDir, 'scenes', sceneId);
    const dir = path.join(scene, 'shot_01');
    fs.mkdirSync(path.join(dir, 'image'), { recursive: true });
    const frameImagePath = path.join(dir, 'image', 'frame.png');
    run(['-y', '-f', 'lavfi', '-i', `color=c=${index ? '0xBD561E' : '0x164E80'}:s=640x360:d=1,drawbox=x=30:y=30:w=120:h=60:color=white:t=fill`, '-frames:v', '1', frameImagePath]);
    fs.writeFileSync(path.join(dir, 'prompt.json'), JSON.stringify({ shotId: 'shot_01', order: 1, prompt: narration,
      narration, framing: 'wide', lens: '35mm', movement: 'static', durationSec: 4, frameImagePath, status: 'IMAGE_GENERATED' }));
    fs.writeFileSync(path.join(dir, 'script.txt'), narration);
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ status: 'IMAGE_GENERATED' }));
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId, order: index + 1, title: narration, shots: ['shot_01'] }));
  }
  fs.mkdirSync(path.join(projects, 'other-project'));
  fs.writeFileSync(path.join(projects, 'other-project', 'project.json'), JSON.stringify({ projectId: 'other-project', name: 'Other project' }));
  const meta = () => JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const fileHash = (file: string) => hash(fs.readFileSync(file));
  const reviews = () => JSON.parse(fs.readFileSync(path.join(profile, 'media-jobs.json'), 'utf8'));
  const cacheSnapshot = () => {
    const dir = path.join(projectDir, 'renders', '.homebot-narration');
    return fs.readdirSync(dir).sort().map(filename => ({ filename, sha256: fileHash(path.join(dir, filename)) }));
  };
  const env = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects, HOMEBOT_FFMPEG: ffmpeg };
  let { app, page } = await launchFocusedStudioApp(env, profile);
  const openProject = async () => {
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(projectId);
    await expect(page.locator('.ms-storyboard-meta-path')).toContainText(projectId);
  };
  const play = async (width: number) => {
    const player = page.getByLabel('Exported storyboard video');
    await player.scrollIntoViewIfNeeded();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(width);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 0; return video.play(); });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = video.duration - 0.3; });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({ ended: video.ended, loop: video.loop, error: video.error?.code ?? null })))
      .toEqual({ ended: true, loop: false, error: null });
  };
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({ narrationEngine: 'kokoro', useCustomLLM: false,
      permissions: { media_render_storyboard: true, media_set_output: true } }));
    await trapSpeechNetwork(app);
    await openProject();
    await page.getByLabel('Storyboard output selection', { exact: true }).selectOption('both');
    await page.getByLabel('Storyboard portrait resolution', { exact: true }).selectOption('720p');
    await page.getByRole('button', { name: 'Render both formats', exact: true }).click();
    let board = page.getByRole('region', { name: 'Visual Storyboard Deck' });
    await expect(board.getByRole('status')).toContainText('2 of 2 selected formats exported', { timeout: 180_000 });
    expect(meta().outputSpec).toMatchObject({ durationIntent: 'long', variants: [
      expect.objectContaining({ id: 'landscape', width: 1280, height: 720 }),
      expect.objectContaining({ id: 'portrait', width: 720, height: 1280 }),
    ] });
    const initialReviews = reviews();
    expect(initialReviews).toHaveLength(2);
    const landscape = initialReviews.find((job: any) => job.outputSpec.variants[0].id === 'landscape');
    const portrait = initialReviews.find((job: any) => job.outputSpec.variants[0].id === 'portrait');
    for (const job of initialReviews) expect(job).toMatchObject({ state: 'awaiting_approval', durationSeconds: 8, burnSubtitles: false });
    const originalHashes = initialReviews.map((job: any) => ({ file: job.renderPath, sha256: fileHash(job.renderPath) }));
    const cached = cacheSnapshot();
    expect(cached.filter(file => file.filename.endsWith('.json'))).toHaveLength(2);
    expect(cached.filter(file => /\.(wav|mp3)$/.test(file.filename))).toHaveLength(2);
    const landscapeAttempt = meta().variantExportAttempts.landscape;
    expect(await app.evaluate(() => (globalThis as any).exportSpeechAttempts)).toEqual([]);
    await page.getByRole('button', { name: 'View portrait', exact: true }).click();
    await play(720);
    await page.screenshot({ path: testInfo.outputPath('both-ready.png'), animations: 'disabled' });
    await app.close();
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    board = page.getByRole('region', { name: 'Visual Storyboard Deck' });
    await waitForAppReady(page);
    await trapSpeechNetwork(app);
    await openProject();
    await expect(page.getByLabel('Storyboard output selection', { exact: true })).toHaveValue('both');
    await page.getByRole('button', { name: 'View landscape', exact: true }).click();
    await play(1280);
    await page.getByLabel('Storyboard portrait image framing', { exact: true }).selectOption('crop');
    await page.getByRole('button', { name: /Save Board/ }).click();
    await expect(board.getByRole('status')).toHaveText('Storyboard saved successfully.');
    await expect(board.getByText('Preview matches the saved revision', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View portrait', exact: true }).click();
    await expect(board.getByText('Preview out of date', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Render portrait', exact: true }).click();
    await expect(board.getByRole('status')).toContainText('1 of 1 selected formats exported', { timeout: 150_000 });
    expect(meta().variantExportAttempts.landscape).toEqual(landscapeAttempt);
    expect(cacheSnapshot()).toEqual(cached);
    expect(reviews()).toHaveLength(3);
    const replacement = reviews().find((job: any) => !initialReviews.some((old: any) => old.id === job.id));
    expect(replacement.renderPath).not.toBe(portrait.renderPath);
    for (const old of originalHashes) expect(fileHash(old.file)).toBe(old.sha256);
    for (const old of initialReviews) expect(reviews().find((job: any) => job.id === old.id)).toEqual(old);
    const inspected = [landscape, portrait, replacement].map(job => {
      const file = job.renderPath;
      run(['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
      const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { windowsHide: true }).toString());
      const variant = job.outputSpec.variants[0];
      expect(info.streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: variant.width, height: variant.height });
      expect(Math.abs(Number(info.format.duration) - 8)).toBeLessThan(0.15);
      const pcm = run(['-i', file, '-vn', '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1']);
      let power = 0;
      for (let i = 0; i < pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
      const rms = Math.sqrt(power / (pcm.length / 4));
      expect(rms).toBeGreaterThan(0.005);
      return { file, sha256: fileHash(file), info, rms, audioSha256: hash(pcm) };
    });
    expect(new Set(inspected.map(movie => movie.audioSha256)).size).toBe(1);
    const sample = (file: string) => [...run(['-ss', '0.5', '-i', file, '-vf', 'crop=2:2:100:100', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']).subarray(0, 3)];
    const framing = { fit: sample(portrait.renderPath), crop: sample(replacement.renderPath) };
    expect(Math.max(...framing.fit)).toBeLessThan(10);
    expect(framing.crop[2]).toBeGreaterThan(framing.crop[0] + 30);
    await play(720);
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption('other-project');
    await expect(page.locator('.ms-storyboard-meta-path')).toContainText('other-project');
    await expect(page.getByLabel('Exported storyboard video')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(projectId);
    await page.getByRole('button', { name: 'View landscape', exact: true }).click();
    await page.getByRole('button', { name: /Review & Publish/ }).click();
    const review = page.locator(`[data-job-id="${landscape.id}"]`);
    await expect(review.getByTestId(`ms-video-${landscape.id}`)).toHaveAttribute('src', new RegExp(landscape.renderedOutput.filename.replace(/\./g, '\\.')));
    expect(reviews().every((job: any) => job.state === 'awaiting_approval' && !job.videoId)).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).exportSpeechAttempts)).toEqual([]);
    await review.screenshot({ path: testInfo.outputPath('exact-review.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('storyboard-both-evidence.json'), JSON.stringify({ profile, inspected, framing,
      cached, landscapeAttempt, finalAttempts: meta().variantExportAttempts, reviews: reviews(),
      speechNetworkAttempts: [], positiveControlsPerLaunch: 5, noApprovalOrPublication: true }, null, 2));
  } catch (error) {
    fs.writeFileSync(testInfo.outputPath('failure-project.json'), JSON.stringify({ profile, meta: meta() }, null, 2));
    await page.screenshot({ path: testInfo.outputPath('failure-surface.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally { await app.close(); }
});
