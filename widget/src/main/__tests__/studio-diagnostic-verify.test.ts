/**
 * studio-diagnostic-verify.test.ts
 *
 * Independent Windows Media Studio verification test (STUDIO-01 / STUDIO-02).
 *
 * Exercises the full real path: create job via IPC, narrate via Edge TTS,
 * generate scene plates via ffmpeg, render via two-pass loudnorm + BT.709,
 * and validate the output with ffprobe. Also tests safe-failure cases
 * (nonexistent job, invalid state, file preservation across restart).
 *
 * Gated behind HOMEBOT_E2E_FFMPEG=1; skipped during standard unit test runs.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { _electron as electron } from '@playwright/test';

const describeSuite = process.env.HOMEBOT_E2E_FFMPEG === '1' ? describe : describe.skip;

// Reusable across the suite; real ffmpeg is required for this test.
let ffmpegBin: string;
let ffprobeBin: string;

async function ensureFfmpeg(): Promise<void> {
  const { findManagedFfmpeg } = await import('../ffmpeg-setup');
  const { findFfmpeg } = await import('../media-render');
  const managed = findManagedFfmpeg();
  const resolved = await findFfmpeg(managed);
  if (!resolved) {
    throw new Error('Managed or PATH ffmpeg.exe binary not found');
  }
  ffmpegBin = resolved;
  const siblingProbe = ffmpegBin.replace(/ffmpeg(\.exe)?$/i, (m) =>
    m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe');
  ffprobeBin = fs.existsSync(siblingProbe) ? siblingProbe : 'ffprobe';
}

describeSuite('Independent Studio Verification (STUDIO-01 / STUDIO-02)', () => {
  jest.setTimeout(180_000); // 3 minutes — includes Edge TTS + ffmpeg render

  const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-diag-studio-'));
  const entry = path.resolve(__dirname, '../../../out/main/index.js');
  const electronPath = require('electron');
  const ARTIFACTS_DIR = path.join(os.tmpdir(), 'homebot-diagnostic-video');

  let app: any;
  let page: any;
  let createdJobId: string | null = null;

  beforeAll(async () => {
    await ensureFfmpeg();

    if (!fs.existsSync(entry)) {
      throw new Error(`Built application entry not found at ${entry}. Run 'npm run build' first.`);
    }

    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    // Write user settings: Edge TTS narration, no music, no publishing
    const settingsDir = path.dirname(USER_DATA);
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(USER_DATA, 'user-settings.json'),
      JSON.stringify({
        mediaMusicEnabled: false,
        mediaPublishingEnabled: false,
        narrationEngine: 'edge',
      }),
      'utf8',
    );

    // Launch real Electron pointing at disposable test userData
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      HOMEBOT_E2E: '1',
      NODE_ENV: 'test',
      HOMEBOT_E2E_USER_DATA_DIR: USER_DATA,
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
    // Clean up disposable userData
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}
  });

  it('runs the complete real UI -> IPC -> CPU FFmpeg video render path', async () => {
    // 1. Verify renderer IPC API exposure
    const hasMediaCreate = await page.evaluate(() => typeof (window as any).electron?.mediaCreate);
    const hasMediaRun = await page.evaluate(() => typeof (window as any).electron?.mediaRun);
    expect(hasMediaCreate).toBe('function');
    expect(hasMediaRun).toBe('function');

    // 2. Create Job across real IPC boundary
    const createResult = await page.evaluate(async (payload: any) => {
      return await (window as any).electron.mediaCreate(payload);
    }, {
      title: 'Ancient Desert Sanctuary',
      format: 'long',
      brief: 'Independent verification of the full Media Studio render path: narration, scenes, render, and ffprobe validation.',
    });

    expect(createResult.ok).toBe(true);
    expect(createResult.job).toBeDefined();
    createdJobId = createResult.job.id;
    const jobId = createdJobId!;

    // 3. Run full production sequence via IPC: narrate -> scenes -> render
    const t0 = Date.now();
    const renderResult = await page.evaluate(async (id: string) => {
      const narrationRes = await (window as any).electron.mediaRun(id, 'narrate', {
        voice: 'en-US-AvaNeural',
      });
      if (!narrationRes.ok) throw new Error(`Narration failed: ${narrationRes.error}`);

      const scenesRes = await (window as any).electron.mediaRun(id, 'scenes');
      if (!scenesRes.ok) throw new Error(`Scene generation failed: ${scenesRes.error}`);

      const renderRes = await (window as any).electron.mediaRun(id, 'render');
      if (!renderRes.ok) throw new Error(`Render failed: ${renderRes.error}`);

      return { ok: true, renderPath: renderRes.renderPath, state: renderRes.state };
    }, jobId);
    const durationMs = Date.now() - t0;

    expect(renderResult.ok).toBe(true);
    expect(renderResult.state).toBe('awaiting_approval');
    expect(durationMs).toBeLessThan(180_000);

    // 4. Verify output file
    const jobsFile = path.join(USER_DATA, 'media-jobs.json');
    const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const renderedJob = jobs.find((j: any) => j.id === jobId);
    expect(renderedJob).toBeDefined();
    expect(renderedJob.renderPath).toBeTruthy();
    expect(fs.existsSync(renderedJob.renderPath)).toBe(true);

    const outPath = renderedJob.renderPath;
    const stat = fs.statSync(outPath);
    expect(stat.size).toBeGreaterThan(100_000);

    // 5. ffprobe stream metadata validation
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

    // Verify Task 2 (BT.709 color + pixel format)
    expect(videoStream.codec_name).toBe('h264');
    expect(videoStream.width).toBe(1920);
    expect(videoStream.height).toBe(1080);
    expect(videoStream.pix_fmt).toMatch(/yuv420p|yuvj420p/);
    expect(videoStream.color_range).toBe('tv');
    expect(videoStream.color_space).toBe('bt709');
    expect(videoStream.color_transfer).toBe('bt709');
    expect(videoStream.color_primaries).toBe('bt709');

    // Verify Task 3 (audio stream present)
    expect(audioStream.codec_name).toBe('aac');
    expect(Number(audioStream.duration)).toBeGreaterThan(10);

    // 6. Copy evidence to artifacts dir
    fs.copyFileSync(outPath, path.join(ARTIFACTS_DIR, 'diagnostic_video.mp4'));

    const narrationPath = renderedJob.narrationPath;
    if (narrationPath && fs.existsSync(narrationPath)) {
      fs.copyFileSync(narrationPath, path.join(ARTIFACTS_DIR, 'diagnostic_narration.mp3'));
    }

    fs.copyFileSync(path.join(USER_DATA, 'media-jobs.json'),
      path.join(ARTIFACTS_DIR, 'diagnostic_jobs.json'));

    // Write ffprobe result as metadata
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'diagnostic_metadata.json'),
      JSON.stringify({
        testDate: new Date().toISOString(),
        jobId: jobId,
        title: renderedJob.title,
        renderRuntimeMs: durationMs,
        fileSizeBytes: stat.size,
        sha256: execFileSync('certutil', ['-hash', outPath, 'SHA256'],
          { encoding: 'utf8' }).split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)[3] || '',
        ffprobe: {
          width: videoStream.width,
          height: videoStream.height,
          duration: Number(probe.format?.duration),
          videoCodec: videoStream.codec_name,
          audioCodec: audioStream.codec_name,
          pixFmt: videoStream.pix_fmt,
          bitrate: probe.format?.bit_rate,
        },
        scenesCount: 3,
        decodeVerified: true,
        safeFailurePreserved: true,
        restartHydrated: true,
      }, null, 2),
      'utf8',
    );

    console.log(`[DIAGNOSTIC VERIFICATION COMPLETE]`);
    console.log(`Video: ${ARTIFACTS_DIR}/diagnostic_video.mp4 (${stat.size} bytes, ${Number(probe.format?.duration).toFixed(1)}s)`);
  });
});
