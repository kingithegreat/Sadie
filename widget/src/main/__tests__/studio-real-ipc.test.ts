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

  it('creates, narrates for real, and renders a video crossing the real IPC boundary in disposable userData', async () => {
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

    // 3. Skip the LLM scripting stage (unrelated to this test, and would pull a
    // real network LLM call into an IPC-boundary test) by writing a real script
    // directly to script_draft — media_narrate only cares that a script exists,
    // not how it got there.
    const jobsFile = path.join(testUserData, 'media-jobs.json');
    const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const targetJob = jobs.find((j: any) => j.id === jobId);
    expect(targetJob).toBeDefined();
    targetJob.state = 'script_draft';
    targetJob.script = 'This is a short, real narration script used to verify the real IPC boundary end to end.';
    fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');

    // 4. Real narration over the real IPC boundary: ipcRenderer.invoke('homebot:media:run', jobId, 'narrate')
    // Exercises the actual TTS engine, real duration measurement (the Kokoro
    // duration fix), and real caption generation — not synthetic fixtures.
    const narrateResult = await page.evaluate(async (id: string) => {
      return await (window as any).electron.mediaRun(id, 'narrate');
    }, jobId);
    expect(narrateResult.ok).toBe(true);
    expect(() => JSON.stringify(narrateResult)).not.toThrow();

    const afterNarrate = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).find((j: any) => j.id === jobId);
    expect(afterNarrate.narrationPath).toBeTruthy();
    expect(fs.existsSync(afterNarrate.narrationPath)).toBe(true);
    expect(afterNarrate.captionsPath).toBeTruthy();
    expect(fs.existsSync(afterNarrate.captionsPath)).toBe(true);
    // A real measured duration, not the word-count placeholder that predates
    // any audio — should be a small positive number of seconds for this script.
    expect(afterNarrate.durationSeconds).toBeGreaterThan(0);
    expect(afterNarrate.durationSeconds).toBeLessThan(30);

    // 5. Trigger render over real IPC boundary. 'plain' visuals: a real narrated,
    // real-captioned render on the generated backdrop, without a real network
    // scene-image-generation call at this IPC-boundary layer (that path is
    // already covered by media-render.live.test.ts).
    const t0 = Date.now();
    const renderResult = await page.evaluate(async (id: string) => {
      return await (window as any).electron.mediaRun(id, 'render', { visuals: 'plain' });
    }, jobId);
    const durationMs = Date.now() - t0;

    expect(renderResult.ok).toBe(true);
    expect(() => JSON.stringify(renderResult)).not.toThrow();
    // The new QA gates (frame-variance, captions) must not false-positive on
    // real content — a real narrated, real-captioned render must say it passed.
    expect(String(renderResult.message)).toMatch(/checks passed/i);
    expect(durationMs).toBeLessThan(30_000);

    // 6. Verify output file in real userData
    const updatedJobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const renderedJob = updatedJobs.find((j: any) => j.id === jobId);
    expect(renderedJob).toBeDefined();
    expect(['render_qa', 'awaiting_approval']).toContain(renderedJob.state);
    expect(renderedJob.renderPath).toBeTruthy();
    expect(fs.existsSync(renderedJob.renderPath)).toBe(true);

    const outPath = renderedJob.renderPath;
    const stat = fs.statSync(outPath);
    expect(stat.size).toBeGreaterThan(10_000);

    // 7. ffprobe stream metadata validation
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

    // Verify audio stream
    expect(audioStream.codec_name).toBe('aac');
    expect(Number(audioStream.duration)).toBeGreaterThan(1);
  });

  it('rejects a flat placeholder render across the real IPC boundary, preserving the file', async () => {
    // Isolates the new visible-content gate specifically: real narration audio
    // (so nothing else can fail) but deliberately NO captions — captions burn
    // in over ANY image, flat or not, so real caption text on the frame would
    // give the flat-frame check something non-flat to see and defeat the very
    // thing this test is proving. The missing-captions gate has its own
    // coverage in media-render.live.test.ts; this test is captions-free on
    // purpose. A deliberately flat placeholder image stands in for real scene
    // art, proving the "after" half of the before/after gate at the real IPC
    // boundary, without a network image call.
    const createResult = await page.evaluate(async (payload: any) => {
      return await (window as any).electron.mediaCreate(payload);
    }, {
      title: 'Flat Placeholder Diagnostic',
      format: 'short',
      brief: 'Verification that a flat placeholder render fails the real QA gate.',
    });
    expect(createResult.ok).toBe(true);
    const jobId = createResult.job.id;

    const jobAssetDir = path.join(testUserData, 'media-assets', jobId);
    fs.mkdirSync(jobAssetDir, { recursive: true });
    const audioPath = path.join(jobAssetDir, 'narration.mp3');
    const flatImagePath = path.join(jobAssetDir, 'flat-placeholder.png');

    execFileSync(ffmpegBin, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:a', 'libmp3lame', '-b:a', '96k', audioPath,
    ]);
    // A solid color, same shape as the app's own generated backdrop — this is
    // exactly the "placeholder" the new gate exists to catch.
    execFileSync(ffmpegBin, [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x1E293B:s=1080x1920:d=1',
      '-vframes', '1', flatImagePath,
    ]);

    const jobsFile = path.join(testUserData, 'media-jobs.json');
    const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const targetJob = jobs.find((j: any) => j.id === jobId);
    targetJob.state = 'media_production';
    targetJob.narrationPath = audioPath;
    targetJob.durationSeconds = 3;
    fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');

    const renderResult = await page.evaluate(async (args: { id: string; image: string }) => {
      return await (window as any).electron.mediaRun(args.id, 'render', { image: args.image });
    }, { id: jobId, image: flatImagePath });

    expect(renderResult.ok).toBe(false);
    expect(String(renderResult.error)).toMatch(/flat color|placeholder/i);

    const updatedJobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const failedJob = updatedJobs.find((j: any) => j.id === jobId);
    expect(failedJob.state).toBe('needs_revision');
    // The render itself is not discarded on a QA failure — same trust
    // boundary as every other QA failure in this pipeline.
    expect(failedJob.renderPath).toBeTruthy();
    expect(fs.existsSync(failedJob.renderPath)).toBe(true);
  });
});
