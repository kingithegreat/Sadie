import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

// Opt-in: uses the installed FFmpeg/ffprobe and cached Kokoro model, with
// speech/model network transports trapped. It never downloads models or calls
// a paid/cloud provider. Ordinary CI still runs the export failure contracts.
test('Studio exports a complete two-scene local movie with timed narration and captions', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Requires installed FFmpeg and cached Kokoro; enable explicitly.');
  test.setTimeout(360_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG;
  expect(ffmpeg, 'Set HOMEBOT_FFMPEG to the installed video engine').toBeTruthy();
  expect(fs.existsSync(ffmpeg!)).toBe(true);
  const ffprobe = path.join(path.dirname(ffmpeg!), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  expect(fs.existsSync(ffprobe)).toBe(true);
  const run = (args: string[]) => execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], {
    windowsHide: true, timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-storyboard-export-'));
  const projects = path.join(profile, 'projects');
  const projectId = 'local-export-proof';
  const projectDir = path.join(projects, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ projectId, name: 'Local export proof' }));
  const lines = ['Blue scene begins.', 'Amber scene follows.'];
  lines.forEach((narration, index) => {
    const sceneId = `scene_0${index + 1}`;
    const scene = path.join(projectDir, 'scenes', sceneId);
    // Shot IDs are scoped to scenes, not globally unique across the movie.
    const shotId = 'shot_01';
    const dir = path.join(scene, shotId);
    fs.mkdirSync(path.join(dir, 'image'), { recursive: true });
    const frameImagePath = path.join(dir, 'image', 'frame.png');
    const color = index === 0 ? '0x164E80' : '0xBD561E';
    run(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:d=1,drawbox=x=30:y=30:w=120:h=60:color=white:t=fill`,
      '-i', path.resolve('resources/icon.png'), '-filter_complex', '[1:v]scale=120:120[logo];[0:v][logo]overlay=260:100',
      '-frames:v', '1', frameImagePath]);
    const shot = { shotId, order: 1, prompt: narration, framing: 'wide', lens: '35mm', movement: 'static', durationSec: index === 0 ? 4 : 3, narration, status: 'IMAGE_GENERATED', frameImagePath };
    fs.writeFileSync(path.join(dir, 'prompt.json'), JSON.stringify(shot));
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ status: 'IMAGE_GENERATED' }));
    fs.writeFileSync(path.join(dir, 'script.txt'), narration);
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId, order: index + 1, title: index === 0 ? 'Beginning' : 'Ending', shots: [shotId] }));
  });
  const launchEnv = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects, HOMEBOT_FFMPEG: ffmpeg };
  let { app, page } = await launchElectronApp(launchEnv, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({
      narrationEngine: 'kokoro', useCustomLLM: false,
      permissions: { media_render_storyboard: true },
    }));
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(projectId);
    await expect(page.locator('.ms-storyboard-meta-path')).toContainText(projectId);
    await page.getByRole('combobox', { name: 'Select Storyboard Scene' }).selectOption('scene_02');
    await expect(page.getByLabel('Narration for shot_01')).toHaveValue(lines[1]);
    await page.getByLabel('Duration for shot_01').fill('4');
    const trapSpeechNetwork = async () => expect(await app.evaluate((_electron, fixture: { cacheDir?: string; packagePath: string }) => {
      if (fixture.cacheDir) {
        const createRequire = (process as any).getBuiltinModule('module').createRequire;
        const widgetRequire = createRequire(fixture.packagePath);
        const runtimeRequire = createRequire(widgetRequire.resolve('kokoro-js'));
        runtimeRequire('@huggingface/transformers').env.cacheDir = fixture.cacheDir;
      }
      const state = globalThis as typeof globalThis & { exportSpeechAttempts: string[] };
      state.exportSpeechAttempts = [];
      const inspect = (value: any) => {
        const destination = typeof value === 'string' ? value : String(value?.url || value?.hostname || value?.host || value);
        if (/huggingface\.co|hf\.co|microsoft\.com|bing\.com|speech-export-control\.invalid/.test(destination)) {
          state.exportSpeechAttempts.push(destination);
          throw new Error('Speech/model network request blocked by the local export test');
        }
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => { inspect(input); return originalFetch(input, init); };
      for (const moduleName of ['http', 'https']) {
        const transport = (process as any).getBuiltinModule(moduleName);
        for (const method of ['get', 'request']) {
          const original = transport[method];
          transport[method] = (...args: any[]) => { inspect(args[0]); return original.apply(transport, args); };
        }
      }
      for (const invoke of [
        () => globalThis.fetch('https://speech-export-control.invalid'),
        () => (process as any).getBuiltinModule('http').get({ hostname: 'speech-export-control.invalid' }),
        () => (process as any).getBuiltinModule('http').request({ hostname: 'speech-export-control.invalid' }),
        () => (process as any).getBuiltinModule('https').get({ hostname: 'speech-export-control.invalid' }),
        () => (process as any).getBuiltinModule('https').request({ hostname: 'speech-export-control.invalid' }),
      ]) { try { invoke(); } catch { /* Positive controls must be observed. */ } }
      const count = state.exportSpeechAttempts.length;
      state.exportSpeechAttempts = [];
      return count;
    }, { cacheDir: process.env.HOMEBOT_KOKORO_TEST_CACHE, packagePath: path.resolve('package.json') })).toBe(5);
    await trapSpeechNetwork();
    await page.getByRole('button', { name: /Render Movie/ }).click();
    const result = await Promise.race([
      page.locator('.ms-movie-rendered-banner').waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'ready'),
      page.getByRole('region', { name: 'Visual Storyboard Deck' }).getByRole('alert').waitFor({ state: 'visible', timeout: 180_000 })
        .then(async () => page.getByRole('region', { name: 'Visual Storyboard Deck' }).getByRole('alert').innerText()),
    ]);
    expect(result).toBe('ready');
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'scenes', 'scene_02', 'shot_01', 'prompt.json'), 'utf8')).durationSec).toBe(4);
    expect(fs.readFileSync(path.join(projectDir, 'scenes', 'scene_01', 'shot_01', 'script.txt'), 'utf8')).toBe(lines[0]);
    const movie = path.join(projectDir, 'renders', `${projectId}-1080p.mp4`);
    expect(fs.statSync(movie).size).toBeGreaterThan(10_000);
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', movie], { windowsHide: true, timeout: 30_000 }).toString());
    const video = info.streams.find((s: any) => s.codec_type === 'video');
    const audio = info.streams.find((s: any) => s.codec_type === 'audio');
    expect(video).toMatchObject({ width: 1920, height: 1080, pix_fmt: 'yuv420p' });
    expect(audio).toBeTruthy();
    expect(Math.abs(Number(info.format.duration) - 8)).toBeLessThan(0.15);
    const samples = [0.5, 4.5].map((second, index) => {
      const frame = testInfo.outputPath(`export-shot-${index + 1}.png`);
      run(['-y', '-ss', String(second), '-i', movie, '-frames:v', '1', frame]);
      const pixel = run(['-ss', String(second), '-i', movie, '-vf', 'crop=2:2:1800:100', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      const captions = run(['-ss', String(second), '-i', movie, '-vf', 'crop=1600:220:160:760', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      let whitePixels = 0;
      for (let p = 0; p < captions.length; p += 3) if (captions[p] > 200 && captions[p + 1] > 200 && captions[p + 2] > 200) whitePixels++;
      expect(whitePixels).toBeGreaterThan(200);
      return { second, rgb: [...pixel.subarray(0, 3)], captionWhitePixels: whitePixels, frame };
    });
    expect(samples[0].rgb[2]).toBeGreaterThan(samples[0].rgb[0] + 30);
    expect(samples[1].rgb[0]).toBeGreaterThan(samples[1].rgb[2] + 50);
    const rms = (start: number) => {
      const pcm = run(['-ss', String(start), '-t', '0.7', '-i', movie, '-vn', '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1']);
      let power = 0;
      for (let i = 0; i < pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
      return Math.sqrt(power / (pcm.length / 4));
    };
    const audioRms = [rms(0.1), rms(3), rms(4.1)];
    expect(audioRms[0]).toBeGreaterThan(0.005);
    expect(audioRms[1]).toBeLessThan(0.003);
    expect(audioRms[2]).toBeGreaterThan(0.005);
    const attempts = await app.evaluate(() => (globalThis as any).exportSpeechAttempts);
    expect(attempts).toEqual([]);
    const events = fs.readFileSync(path.join(profile, 'logs', 'telemetry-events.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.some(event => event.event === 'tool_call' && event.details.tool === 'media_render_storyboard' && event.details.outcome === 'success')).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('studio-export-ready.png') });
    const evidence = { movie, bytes: fs.statSync(movie).size, sha256: createHash('sha256').update(fs.readFileSync(movie)).digest('hex'), duration: info.format.duration, video, audioRms, samples, speechNetworkAttempts: attempts };
    fs.writeFileSync(testInfo.outputPath('export-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('STUDIO_EXPORT_EVIDENCE', JSON.stringify(evidence));
    // Reopen the app surface and select the persisted project. A successful
    // export must remain reachable without exporting the same movie again.
    await app.close();
    ({ app, page } = await launchElectronApp(launchEnv, profile));
    await waitForAppReady(page);
    await trapSpeechNetwork();
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(projectId);
    await expect(page.locator('.ms-movie-rendered-banner')).toContainText(movie);
    expect(createHash('sha256').update(fs.readFileSync(movie)).digest('hex')).toBe(evidence.sha256);
    const player = page.getByLabel('Exported storyboard video');
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({ width: video.videoWidth, duration: video.duration })))
      .toEqual({ width: 1920, duration: 8 });
    await player.evaluate(async (video: HTMLVideoElement) => { await video.play(); });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.15);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = video.duration - 0.3; });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({ ended: video.ended, paused: video.paused, loop: video.loop })))
      .toEqual({ ended: true, paused: true, loop: false });
    await player.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('studio-export-reopened.png') });
    // A duration edit that would truncate real speech must fail visibly, keep
    // the existing movie byte-for-byte, and restore its released video player.
    const board = page.getByRole('region', { name: 'Visual Storyboard Deck' });
    await page.getByRole('combobox', { name: 'Select Storyboard Scene' }).selectOption('scene_02');
    await page.getByLabel('Duration for shot_01').fill('1');
    await page.getByRole('button', { name: /Save Board/ }).click();
    await expect(board.getByRole('status')).toHaveText('Storyboard saved successfully.');
    await page.getByRole('button', { name: /Render Movie/ }).click();
    await expect(board.getByRole('alert')).toContainText('Increase its duration', { timeout: 90_000 });
    expect(createHash('sha256').update(fs.readFileSync(movie)).digest('hex')).toBe(evidence.sha256);
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(1920);
    await player.evaluate(async (video: HTMLVideoElement) => { await video.play(); });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.15);
    await player.evaluate((video: HTMLVideoElement) => video.pause());
    await player.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('studio-export-preserved.png') });
    // Correct the edit and replace the movie while its player has held a file
    // handle. This exercises the Windows release-before-replace path.
    await page.getByLabel('Duration for shot_01').fill('4');
    await page.getByRole('button', { name: /Save Board/ }).click();
    await expect(board.getByRole('status')).toHaveText('Storyboard saved successfully.');
    const previousModified = fs.statSync(movie).mtimeMs;
    await page.getByRole('button', { name: /Render Movie/ }).click();
    await expect(board.getByRole('status')).toContainText('Successfully rendered', { timeout: 180_000 });
    expect(fs.statSync(movie).mtimeMs).toBeGreaterThan(previousModified);
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({ width: video.videoWidth, duration: video.duration })))
      .toEqual({ width: 1920, duration: 8 });
    expect(await app.evaluate(() => (globalThis as any).exportSpeechAttempts)).toEqual([]);
    fs.writeFileSync(testInfo.outputPath('export-evidence.json'), JSON.stringify({
      ...evidence, finalSha256: createHash('sha256').update(fs.readFileSync(movie)).digest('hex'),
      sceneCount: 2, lastSceneEditsSavedByRender: true, fullEndingPlayedWithoutLoop: true,
      reopenedAfterRestart: true, playerDecodedAndPlayed: true, failedReplacementPreserved: true, replacementWithPlayerLoaded: true,
    }, null, 2));
  } finally {
    await app.close();
    // Retain this isolated fixture and finished movie for inspection.
  }
});
