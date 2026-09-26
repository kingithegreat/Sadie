import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createServer, type Server } from 'http';
import { createStudioOutputSpec } from '../../shared/media-output';
import { buildScenePrompt, sceneCacheKey, seedForVideo } from '../../main/media-visuals';
import { launchFocusedStudioApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('ordinary Make the video rejects cached failed scene art and preserves the good export', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_SCENE_QA_LIVE !== '1', 'Bounded FFmpeg and isolated cache fixture only; no provider/voice/model calls.');
  test.setTimeout(240_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  const failedPlate = process.env.HOMEBOT_SCENE_QA_FAILED_PLATE!;
  expect(fs.existsSync(ffmpeg)).toBe(true);
  expect(fs.existsSync(failedPlate)).toBe(true);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-scene-source-qa-'));
  const id = 'media_scene_source_qa';
  const title = 'Ordinary scene picture QA';
  const text = 'Ordinary narration over an intended scene picture.';
  const audio = path.join(profile, 'audio.wav');
  const captions = path.join(profile, 'captions.srt');
  const good = path.join(profile, 'detailed.png');
  const apFixture = path.join(profile, 'empty-ap');
  fs.mkdirSync(apFixture);
  fs.writeFileSync(path.join(apFixture, 'run_pipeline.py'), '# Isolated marker, never executed.');
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 60_000 });
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', audio]);
  run(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-frames:v', '1', '-threads', '1', good]);
  fs.writeFileSync(captions, `1\n00:00:00,000 --> 00:00:06,000\n${text}\n`);
  const cacheDir = path.join(profile, 'media-assets', '_scene-image-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cache = path.join(cacheDir, `${sceneCacheKey(buildScenePrompt(text, title), 1024, 576, seedForVideo(id))}.png`);
  fs.copyFileSync(good, cache);
  const jobsFile = path.join(profile, 'media-jobs.json');
  fs.writeFileSync(jobsFile, JSON.stringify([{ id, title, format: 'short', state: 'media_production', narrationPath: audio,
    captionsPath: captions, burnSubtitles: true, durationSeconds: 6, outputSpec: createStudioOutputSpec('16:9', 'short', '720p'),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] }]));
  const jobs = () => JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const job = () => jobs().find((entry: any) => entry.id === id);
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const env = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg,
    HOME: profile, USERPROFILE: profile, ANCIENT_PATHWAYS_DIR: apFixture };
  let { app, page } = await launchFocusedStudioApp(env, profile);
  let server: Server | undefined;
  let generationRequests = 0;
  const open = async () => {
    await waitForAppReady(page);
    await dismissFirstRun(page);
    expect((await page.evaluate(() => window.electron.mediaAncientPathwaysStatus!())).dir).toBe(apFixture);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await expect(page.getByRole('button', { name: 'Make the video', exact: true })).toBeVisible();
  };
  const make = async () => {
    const oldAttempt = job().latestExportAttempt?.id;
    await page.getByRole('button', { name: 'Make the video', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: 'Choose where images are made' });
    await expect.poll(async () => await prompt.isVisible() || job().latestExportAttempt?.id !== oldAttempt).toBe(true);
    if (await prompt.isVisible()) {
      // All image bytes are already in this isolated cache. No online call occurs.
      await prompt.getByRole('button', { name: 'Continue with online instead' }).click();
    }
  };
  try {
    await open();
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, mediaMusicEnabled: false, permissions: { media_render: true } }));
    await make();
    await expect.poll(() => job().latestExportAttempt?.status, { timeout: 90_000 }).toBe('succeeded');
    await expect(page.locator('.ms-working')).toHaveCount(0);
    const movie = job().renderPath;
    const movieHash = hash(movie);
    const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const encoded = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', movie], { windowsHide: true, timeout: 30_000 }).toString());
    expect(encoded.streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: 1280, height: 720, r_frame_rate: '30/1' });
    expect(Math.abs(Number(encoded.format.duration) - 6)).toBeLessThan(0.15);
    run(['-i', movie, '-vf', 'fps=1/2,scale=320:180,tile=3x1', '-frames:v', '1', testInfo.outputPath('good-scene-contact.png')]);
    await app.close();
    // Inject the actual production failure plate retained by the no-provider
    // diagnostic. Normal Make the video must inspect these cached bytes too.
    fs.copyFileSync(failedPlate, cache);
    fs.writeFileSync(jobsFile, JSON.stringify(jobs().map((entry: any) => entry.id === id
      ? { ...entry, state: 'media_production', renderInputs: undefined } : entry)));
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    await open();
    await make();
    await expect(page.getByRole('alert').filter({ hasText: 'Check the picture for scene 1' })).toContainText('Replace or regenerate');
    await expect.poll(() => job().latestExportAttempt?.status).toBe('failed');
    await expect(page.locator('.ms-working')).toHaveCount(0);
    expect(job().renderPath).toBe(movie);
    expect(hash(movie)).toBe(movieHash);
    expect(job().latestExportAttempt.errorCode).toBe('SCENE_PICTURE_FAILURE');
    const rejectedCacheHash = hash(cache);
    await page.getByRole('alert').filter({ hasText: 'Check the picture for scene 1' }).screenshot({ path: testInfo.outputPath('failed-source-guidance.png') });
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(profile);
    expect(fs.existsSync(path.join(profile, 'sd-cpp'))).toBe(false);
    // Real generator transport, authored loopback fixture: never occupy an
    // owner's existing service or invoke any model. EADDRINUSE fails this probe.
    server = createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/sdapi/v1/txt2img') {
        response.writeHead(404); response.end(); return;
      }
      request.resume();
      request.on('end', () => {
        generationRequests++;
        const image = generationRequests === 1 ? failedPlate : good;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ images: [fs.readFileSync(image).toString('base64')] }));
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(7860, '127.0.0.1', resolve); });
    expect(generationRequests).toBe(0);
    await page.getByRole('button', { name: 'Regenerate scene pictures', exact: true }).click();
    await expect.poll(() => generationRequests).toBe(1);
    await expect.poll(() => job().latestExportAttempt?.status, { timeout: 30_000 }).toBe('failed');
    await expect(page.locator('.ms-working')).toHaveCount(0);
    expect(job().latestExportAttempt.errorCode).toBe('SCENE_PICTURE_FAILURE');
    expect(hash(movie)).toBe(movieHash);
    expect(hash(cache)).toBe(rejectedCacheHash);
    await page.getByRole('button', { name: 'Regenerate scene pictures', exact: true }).click();
    await expect.poll(() => generationRequests).toBe(2);
    await expect.poll(() => job().latestExportAttempt?.status, { timeout: 90_000 }).toBe('succeeded');
    await expect(page.locator('.ms-working')).toHaveCount(0);
    const recoveredMovie = job().renderPath;
    expect(recoveredMovie).not.toBe(movie);
    expect(hash(movie)).toBe(movieHash);
    expect(hash(cache)).toBe(rejectedCacheHash);
    const recoveredHash = hash(recoveredMovie);
    const recoveredFacts = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', recoveredMovie], { windowsHide: true, timeout: 30_000 }).toString());
    run(['-i', recoveredMovie, '-vf', 'fps=1/2,scale=320:180,tile=3x1', '-frames:v', '1', testInfo.outputPath('recovered-scene-contact.png')]);
    await app.close();
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    await waitForAppReady(page);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    const player = page.getByTestId(`ms-video-${id}`);
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await player.evaluate((video: HTMLVideoElement) => video.pause());
    expect(hash(movie)).toBe(movieHash);
    expect(job().renderPath).toBe(recoveredMovie);
    expect(hash(recoveredMovie)).toBe(recoveredHash);
    fs.writeFileSync(testInfo.outputPath('scene-source-evidence.json'), JSON.stringify({ profile, cache, failedPlate,
      injectedPlateSha256: hash(failedPlate), goodMovie: { path: movie, sha256: movieHash },
      encoded, encoderTag: encoded.streams.find((stream: any) => stream.codec_type === 'video')?.tags?.encoder ?? null,
      recoveredMovie: { path: recoveredMovie, sha256: recoveredHash, facts: recoveredFacts },
      generationRequests, cacheUnchanged: hash(cache) === rejectedCacheHash,
      previousMoviePreserved: true, restartedPlayerPlayed: true,
      scope: 'Actual normal Make the video UI/cache rejection and explicit recovery through real generator transport into an authored loopback fixture (flat then detailed). No real provider/voice/model/AP calls; not creative quality acceptance.' }, null, 2));
  } finally {
    await app.close();
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  }
});
