/**
 * studio-real-ipc.test.ts
 *
 * End-to-end Media Studio verification test crossing the REAL Electron IPC boundary
 * and operating against real userData.
 *
 * Unlike unit tests, this test:
 * - Launches a real Electron instance via Playwright
 * - Sends calls across the actual IPC bridge from renderer (window.electron.mediaCreate / mediaRun)
 * - Uses the real userData directory (%APPDATA%\HomeBot)
 * - Uses the managed FFmpeg engine installed in userData
 * - Verifies the full pipeline down to the output MP4 and ffprobe validation
 *
 * Gated behind HOMEBOT_E2E_FFMPEG=1; skipped during standard unit test runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { _electron as electron } from '@playwright/test';

const describeSuite = process.env.HOMEBOT_E2E_FFMPEG === '1' ? describe : describe.skip;

describeSuite('Media Studio Real IPC & Disposable UserData (Task 4)', () => {
  jest.setTimeout(60_000); // 1 minute timeout

  const testBase = process.env.TEMP || process.env.TMPDIR || os.tmpdir();
  const testUserData = fs.mkdtempSync(path.join(testBase, 'homebot-real-ipc-'));
  const entry = path.resolve(__dirname, '../../../out/main/index.js');
  const electronPath = require('electron');

  let app: any;
  let page: any;
  let createdJobId: string | null = null;
  let ffmpegBin: string;
  let ffprobeBin: string;

  beforeAll(async () => {
    // Confirm built entry exists
    if (!fs.existsSync(entry)) {
      throw new Error(`Built application entry not found at ${entry}. Run 'npm run build' first.`);
    }

    // Initialize disposable test profile with baseline config
    const cfgDir = path.join(testUserData, 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'user-settings.json'),
      JSON.stringify({
        mediaMusicEnabled: false,
        mediaPublishingEnabled: false,
        narrationEngine: 'edge',
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(testUserData, 'media-jobs.json'), '[]', 'utf8');

    // Link real managed ffmpeg directory into disposable test userData so findManagedFfmpeg() resolves cleanly
    const realManagedFfmpegDir = path.join(process.env.APPDATA || os.homedir(), 'HomeBot', 'ffmpeg');
    if (fs.existsSync(realManagedFfmpegDir)) {
      try {
        fs.symlinkSync(realManagedFfmpegDir, path.join(testUserData, 'ffmpeg'), 'junction');
      } catch {
        /* Symlink fallback or PATH resolution below */
      }
    }

    // Locate FFmpeg binary: managed copy in userData first, fallback to PATH / candidate paths
    const { findManagedFfmpeg } = await import('../ffmpeg-setup');
    const { findFfmpeg } = await import('../media-render');
    const managed = findManagedFfmpeg();
    const resolved = await findFfmpeg(managed);
    if (!resolved) {
      throw new Error('Managed or PATH ffmpeg.exe binary not found');
    }
    ffmpegBin = resolved;
    const siblingProbe = ffmpegBin.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));
    ffprobeBin = fs.existsSync(siblingProbe) ? siblingProbe : 'ffprobe';

    // Launch real Electron pointing at disposable test userData directory
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      HOMEBOT_E2E: '1',
      NODE_ENV: 'test',
      HOMEBOT_E2E_USER_DATA_DIR: testUserData,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;

    app = await electron.launch({
      executablePath: electronPath,
      args: [entry],
      env,
    });

    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    // Clean up disposable test directory completely, leaving zero debris in production APPDATA
    try {
      if (fs.existsSync(testUserData)) {
        fs.rmSync(testUserData, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('Cleanup error for disposable testUserData:', err);
    }
  });

  it('creates, prepares, and renders a video crossing the real IPC boundary in disposable userData', async () => {
    // 1. Verify renderer IPC API exposure
    const hasMediaCreate = await page.evaluate(() => typeof (window as any).electron?.mediaCreate);
    const hasMediaRun = await page.evaluate(() => typeof (window as any).electron?.mediaRun);
    expect(hasMediaCreate).toBe('function');
    expect(hasMediaRun).toBe('function');

    // 2. Create Job across real IPC: ipcRenderer.invoke('homebot:media:create')
    const createResult = await page.evaluate(async (payload: any) => {
      return await (window as any).electron.mediaCreate(payload);
    }, {
      title: 'Fast Real IPC Diagnostic',
      format: 'short',
      brief: 'Verification of real IPC and real userData pipeline execution.',
    });

    expect(createResult.ok).toBe(true);
    expect(createResult.job).toBeDefined();
    // Verify structured-clone fidelity across Chromium IPC
    expect(() => JSON.stringify(createResult)).not.toThrow();
    expect(createResult.job.title).toBe('Fast Real IPC Diagnostic');

    createdJobId = createResult.job.id;
    const jobId = createdJobId!;

    // 3. Prepare fast 3s audio, captions, and visual plate directly in disposable testUserData
    const jobAssetDir = path.join(testUserData, 'media-assets', jobId);
    fs.mkdirSync(jobAssetDir, { recursive: true });

    const audioPath = path.join(jobAssetDir, 'narration.mp3');
    const captionsPath = path.join(jobAssetDir, 'captions.srt');
    const sceneDir = path.join(jobAssetDir, 'scenes');
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, 'scene-00.png');
    const concatPath = path.join(jobAssetDir, 'scenes.txt');

    // Synthesize 3-second audio and 1 scene plate using managed FFmpeg
    execFileSync(ffmpegBin, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:a', 'libmp3lame', '-b:a', '96k', audioPath,
    ]);
    expect(fs.existsSync(audioPath)).toBe(true);

    fs.writeFileSync(captionsPath, '1\n00:00:00,000 --> 00:00:03,000\nReal IPC verification cue\n', 'utf8');

    execFileSync(ffmpegBin, [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x1E293B:s=1080x1920:d=1',
      '-vframes', '1', scenePath,
    ]);
    expect(fs.existsSync(scenePath)).toBe(true);

    // Write concat file
    const concatContent = `ffconcat version 1.0\nfile '${scenePath.replace(/\\/g, '/')}'\nduration 3.000\nfile '${scenePath.replace(/\\/g, '/')}'\n`;
    fs.writeFileSync(concatPath, concatContent, 'utf8');

    // Update job record in disposable media-jobs.json to media_production state
    const jobsFile = path.join(testUserData, 'media-jobs.json');
    const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const targetJob = jobs.find((j: any) => j.id === jobId);
    expect(targetJob).toBeDefined();

    targetJob.state = 'media_production';
    targetJob.narrationPath = audioPath;
    targetJob.captionsPath = captionsPath;
    targetJob.durationSeconds = 3;
    fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');

    // 4. Trigger render over real IPC boundary: ipcRenderer.invoke('homebot:media:run', jobId, 'render')
    const t0 = Date.now();
    const renderResult = await page.evaluate(async (id: string) => {
      return await (window as any).electron.mediaRun(id, 'render', { visuals: 'plain' });
    }, jobId);
    const durationMs = Date.now() - t0;

    expect(renderResult.ok).toBe(true);
    // Verify structured-clone fidelity of render response
    expect(() => JSON.stringify(renderResult)).not.toThrow();
    expect(durationMs).toBeLessThan(20_000); // Must be fast (<20s)

    // 5. Verify output file in real userData
    const updatedJobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const renderedJob = updatedJobs.find((j: any) => j.id === jobId);
    expect(renderedJob).toBeDefined();
    expect(['render_qa', 'awaiting_approval']).toContain(renderedJob.state);
    expect(renderedJob.renderPath).toBeTruthy();
    expect(fs.existsSync(renderedJob.renderPath)).toBe(true);

    const outPath = renderedJob.renderPath;
    const stat = fs.statSync(outPath);
    expect(stat.size).toBeGreaterThan(10_000);

    // 6. ffprobe stream metadata validation
    const probeOutput = execFileSync(ffprobeBin, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      outPath,
    ], { encoding: 'utf8' });
    const probe = JSON.parse(probeOutput);

    const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
    const audioStream = probe.streams.find((s: any) => s.codec_type === 'audio');

    expect(videoStream).toBeDefined();
    expect(audioStream).toBeDefined();

    // Verify Task 2 properties
    expect(videoStream.codec_name).toBe('h264');
    expect(videoStream.pix_fmt).toBe('yuv420p');
    expect(videoStream.color_range).toBe('tv');
    expect(videoStream.color_space).toBe('bt709');
    expect(videoStream.color_transfer).toBe('bt709');
    expect(videoStream.color_primaries).toBe('bt709');

    // Verify Task 3 audio stream
    expect(audioStream.codec_name).toBe('aac');
    expect(Number(audioStream.duration)).toBeGreaterThan(2.5);
  });
});
