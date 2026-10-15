/**
 * The render stage, against a real ffmpeg.
 *
 * OPT-IN. Skipped unless HOMEBOT_LIVE=1 and an ffmpeg is reachable — on PATH,
 * or pointed at by HOMEBOT_FFMPEG:
 *
 *   cd widget
 *   npx cross-env HOMEBOT_LIVE=1 HOMEBOT_FFMPEG=C:\path\to\ffmpeg.exe \
 *     npx jest media-render.live
 *
 * The unit tests assert the command; this asserts the FILE. They catch
 * different things: a filter string can be perfectly formed and still produce
 * a container with no frames in it, or a video that only plays in VLC. So this
 * runs the real tool over real TTS audio and then interrogates the output with
 * ffprobe rather than trusting an exit code.
 */

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));
// The scene-render cases exercise real preflight, FFmpeg and output QA with
// local pictures. Image-provider behavior is covered by media-visuals tests;
// a scheduled render cannot depend on a third-party queue answering.
jest.mock('../media-visuals', () => ({
  ...jest.requireActual('../media-visuals'),
  generateSceneImages: jest.fn(),
}));
// This suite narrates with real online speech (Edge TTS), so its settings say
// Online is on. Since #314 (2026-09-12) narration correctly refuses online
// speech while Online is off, and every narrated case here failed on that
// refusal - the nightly was red for it from that night on.
jest.mock('../config-manager', () => {
  const actual = jest.requireActual('../config-manager');
  return { ...actual, getSettings: () => ({ ...actual.getSettings(), useCustomLLM: true }) };
});
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { initializeTools } from '../tools';
import { mediaToolHandlers, readJobs, __resetMediaJobsForTests } from '../tools/media';
import { findFfmpeg } from '../media-render';
import { generateSceneImages } from '../media-visuals';
import { toSrt } from '../media-captions';
import { createStudioOutputSpec } from '../../shared/media-output';

// New jobs default to captions off (#318) and landscape fit whatever their
// length (#320). These cases check burned captions and a vertical short, so
// they ask for both explicitly instead of relying on the old defaults.
const PORTRAIT_WITH_CAPTIONS = { burnSubtitles: true, outputSpec: createStudioOutputSpec('9:16') };

jest.setTimeout(10 * 60 * 1000);

const call = (name: string, args: any = {}) =>
  mediaToolHandlers[name](args, { executionId: 'live-render' } as any);

/** Ask the file what it actually is, rather than trusting the exit code. */
function ffprobe(bin: string, file: string): Promise<any> {
  const probe = bin.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));
  return new Promise((resolve, reject) => {
    execFile(probe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
      { maxBuffer: 1024 * 1024 * 8 },
      (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout))));
  });
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { maxBuffer: 1024 * 1024 }, err => (err ? reject(err) : resolve()));
  });
}

async function readySceneJob(title: string, ffmpeg: string, fixtureDir: string): Promise<void> {
  await call('media_create_job', { title, format: 'short', ...PORTRAIT_WITH_CAPTIONS });
  const audio = path.join(fixtureDir, 'narration.mp3');
  await runFfmpeg(ffmpeg, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:a', 'libmp3lame', '-b:a', '96k', audio]);
  const captions = path.join(fixtureDir, 'captions.srt');
  fs.writeFileSync(captions, toSrt([
    { index: 1, startMs: 0, endMs: 2700, text: 'A storm rose over the open sea.' },
    { index: 2, startMs: 2700, endMs: 5400, text: 'The sailors watched the dark waves.' },
    { index: 3, startMs: 5400, endMs: 8000, text: 'At dawn, the ship reached the shore.' },
  ]), 'utf8');
  const jobs = readJobs();
  const job = jobs.find(j => j.title === title)!;
  job.script = 'A storm rose over the open sea. The sailors watched the dark waves. At dawn, the ship reached the shore.';
  job.narrationPath = audio;
  job.captionsPath = captions;
  job.durationSeconds = 8;
  job.state = 'media_production';
  require('../tools/media').writeJobs(jobs);
}

async function sceneFixture(ffmpeg: string, file: string, hue: number): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await runFfmpeg(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc2=size=576x1024:rate=1',
    '-vf', `hue=h=${hue}`, '-frames:v', '1', file]);
}

maybe('rendering a real video', () => {
  beforeAll(() => { initializeTools(); __resetMediaJobsForTests(); });
  afterAll(() => { __resetMediaJobsForTests(); });

  it('turns a narrated job into a playable mp4', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) {
      // Not a silent skip: the point of this test is the binary.
      throw new Error('No ffmpeg found. Set HOMEBOT_FFMPEG or install it, or run without HOMEBOT_LIVE=1.');
    }

    await call('media_create_job', { title: 'Render check', format: 'short', ...PORTRAIT_WITH_CAPTIONS });

    // Short, fixed script: this test is about the video, not the writing. The
    // job is put at script_draft directly, since narration legitimately
    // refuses to run from `idea`.
    const jobs = readJobs();
    jobs[0].script = 'The sea rose against the ship. The sailors were afraid, and cried each to his own god. '
      + 'But the man they sought was below deck, fast asleep, running from the one who made the sea.';
    jobs[0].state = 'script_draft';
    require('../tools/media').writeJobs(jobs);

    const narrated: any = await call('media_narrate', { job: 'Render check' });
    expect(narrated.success).toBe(true);

    const rendered: any = await call('media_render', { job: 'Render check', visuals: 'plain' });
    // eslint-disable-next-line no-console
    console.log('--- media_render ---\n', rendered.success ? rendered.result : rendered.error);
    expect(rendered.success).toBe(true);
    // The new frame-variance and captions QA gates must not false-positive on
    // real narrated, real-captioned content — a real render must say it passed.
    // (If either gate had misfired here, this would be `success: false`.)
    expect(String(rendered.result)).toMatch(/checks passed/i);

    const job = readJobs()[0];
    expect(job.state).toBe('render_qa');
    expect(job.renderPath).toBeTruthy();
    expect(fs.existsSync(job.renderPath!)).toBe(true);

    const info = await ffprobe(ffmpeg, job.renderPath!);
    const video = info.streams.find((s: any) => s.codec_type === 'video');
    const audio = info.streams.find((s: any) => s.codec_type === 'audio');

    // A container with headers and no frames would pass a size check.
    expect(video).toBeTruthy();
    expect(audio).toBeTruthy();
    expect(video.width).toBe(1080);
    expect(video.height).toBe(1920);
    // Without yuv420p it plays in VLC and nowhere that matters.
    expect(video.pix_fmt).toBe('yuv420p');

    // The video must last as long as the narration — -shortest silently
    // truncating to one frame is exactly the failure a size check misses.
    const seconds = Number(info.format.duration);
    // eslint-disable-next-line no-console
    console.log(`video: ${video.width}x${video.height} ${video.codec_name}/${audio.codec_name} `
      + `${seconds.toFixed(1)}s, ${(Number(info.format.size) / 1024 / 1024).toFixed(1)} MB`);
    expect(seconds).toBeGreaterThan((job.durationSeconds || 10) * 0.8);
  });

  it('rejects a flat placeholder image and leaves the job in needs_revision', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('No ffmpeg found.');

    await call('media_create_job', { title: 'Flat placeholder check', format: 'short' });
    const jobs = readJobs();
    const j = jobs.find(x => x.title === 'Flat placeholder check')!;
    j.script = 'A short line, just enough to produce real narration audio.';
    j.state = 'script_draft';
    require('../tools/media').writeJobs(jobs);

    expect((await call('media_narrate', { job: 'Flat placeholder check' }) as any).success).toBe(true);

    // Captions burn in over ANY image, flat or not (media-render.ts applies
    // the subtitles filter unconditionally whenever captionsPath is set) — so
    // real captions here would put real text on the frame and the flat-frame
    // check would never get a clean look at the placeholder. Clear them so
    // this test isolates the frame-variance gate specifically; the missing-
    // captions gate has its own dedicated test right below.
    const narratedJob = readJobs().find(x => x.title === 'Flat placeholder check')!;
    narratedJob.captionsPath = undefined;
    require('../tools/media').writeJobs(readJobs().map(x => (x.title === 'Flat placeholder check' ? narratedJob : x)));

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'homebot-flat-placeholder-'));
    const flatImage = path.join(tmpDir, 'flat.png');
    await new Promise<void>((resolve, reject) => {
      execFile(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'color=c=0x1E293B:s=1080x1920:d=1',
        '-vframes', '1', flatImage,
      ], (err) => (err ? reject(err) : resolve()));
    });

    const rendered: any = await call('media_render', { job: 'Flat placeholder check', image: flatImage });
    // eslint-disable-next-line no-console
    console.log('--- media_render (flat placeholder) ---\n', rendered.success ? rendered.result : rendered.error);
    expect(rendered.success).toBe(false);
    expect(String(rendered.error)).toMatch(/flat color|placeholder/i);

    const failed = readJobs().find(x => x.title === 'Flat placeholder check')!;
    expect(failed.state).toBe('needs_revision');
    // Preserved, not discarded — same trust boundary as every other QA failure.
    expect(failed.renderPath).toBeUndefined();
    expect(failed.rejectedRenderPath).toBeTruthy();
    expect(fs.existsSync(failed.rejectedRenderPath!)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a render whose captions are missing', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('No ffmpeg found.');

    await call('media_create_job', { title: 'Missing captions check', format: 'short', ...PORTRAIT_WITH_CAPTIONS });
    const jobs = readJobs();
    const j = jobs.find(x => x.title === 'Missing captions check')!;
    j.script = 'A short line, just enough to produce real narration audio.';
    j.state = 'script_draft';
    require('../tools/media').writeJobs(jobs);

    expect((await call('media_narrate', { job: 'Missing captions check' }) as any).success).toBe(true);

    // Emptying the real captions file the same as a write that silently failed
    // — nothing distinguishes the two once render runs, so both must fail QA.
    const afterNarrate = readJobs().find(x => x.title === 'Missing captions check')!;
    expect(afterNarrate.captionsPath).toBeTruthy();
    fs.writeFileSync(afterNarrate.captionsPath!, '', 'utf8');

    const rendered: any = await call('media_render', { job: 'Missing captions check', visuals: 'plain' });
    // eslint-disable-next-line no-console
    console.log('--- media_render (missing captions) ---\n', rendered.success ? rendered.result : rendered.error);
    expect(rendered.success).toBe(false);
    expect(String(rendered.error)).toMatch(/no captions/i);

    const failed = readJobs().find(x => x.title === 'Missing captions check')!;
    expect(failed.state).toBe('needs_revision');
  });

  it('renders local scene pictures into a multi-cut video', async () => {
    // Keep the real scene preflight, concat, encode and output checks. The
    // generated pictures are local fixtures so an unavailable image provider
    // cannot decide whether this scheduled renderer gate passes.
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('No ffmpeg found.');
    const fixtureDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'homebot-scene-fixture-'));
    try {
      await readySceneJob('Scene check', ffmpeg, fixtureDir);
      (generateSceneImages as jest.Mock).mockImplementationOnce(async ({ scenes, outDir }: any) => {
        expect(scenes).toHaveLength(3);
        return Promise.all(scenes.map(async (_: unknown, index: number) => {
          const file = path.join(outDir, `scene-${index}.png`);
          await sceneFixture(ffmpeg, file, index * 100);
          return { index, path: file, source: 'local-test-fixture' };
        }));
      });

      const rendered: any = await call('media_render', { job: 'Scene check', visuals: 'scenes' });
      expect(rendered.success).toBe(true);
      expect(String(rendered.result)).toMatch(/checks passed/i);
      expect(generateSceneImages).toHaveBeenCalledTimes(1);

      const done = readJobs().find(x => x.title === 'Scene check')!;
      expect(done.state).toBe('render_qa');
      expect(done.renderInputs?.scenePaths).toHaveLength(3);
      expect(done.renderInputs!.scenePaths.every(file => !!file && fs.existsSync(file))).toBe(true);
      expect(fs.readFileSync(done.renderInputs!.scenePaths[0]!)).not.toEqual(fs.readFileSync(done.renderInputs!.scenePaths[1]!));
      const info = await ffprobe(ffmpeg, done.renderPath!);
      const video = info.streams.find((s: any) => s.codec_type === 'video');
      const audio = info.streams.find((s: any) => s.codec_type === 'audio');
      expect(video.width).toBe(1080);
      expect(video.height).toBe(1920);
      expect(audio).toBeTruthy();
      expect(Number(info.format.duration)).toBeGreaterThan(7.5);
    } finally {
      (generateSceneImages as jest.Mock).mockClear();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('refuses a generated fallback plate before encoding', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('No ffmpeg found.');
    const fixtureDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'homebot-rejected-scene-'));
    try {
      await readySceneJob('Rejected scene check', ffmpeg, fixtureDir);
      const fallback = path.join(fixtureDir, 'fallback.png');
      await sceneFixture(ffmpeg, fallback, 0);
      (generateSceneImages as jest.Mock).mockImplementationOnce(async ({ scenes }: any) =>
        scenes.map((_: unknown, index: number) => ({ index, path: fallback, source: 'fallback-plate' })));

      const rendered: any = await call('media_render', { job: 'Rejected scene check', visuals: 'scenes' });
      expect(rendered.success).toBe(false);
      expect(rendered.code).toBe('SCENE_PICTURE_FAILURE');
      expect(String(rendered.error)).toMatch(/scene 1.*generation failed.*Replace or regenerate/i);
      const failed = readJobs().find(x => x.title === 'Rejected scene check')!;
      expect(failed.latestExportAttempt).toMatchObject({ status: 'failed', errorCode: 'SCENE_PICTURE_FAILURE' });
      expect(failed.renderPath).toBeUndefined();
      expect(failed.rejectedRenderPath).toBeUndefined();
    } finally {
      (generateSceneImages as jest.Mock).mockClear();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('says what to install when ffmpeg is missing, and leaves the job alone', async () => {
    // The whole reason for detect-don't-bundle: the refusal has to be
    // actionable, and must not strand the job in a state it cannot leave.
    // Clearing HOMEBOT_FFMPEG and PATH cannot actually hide ffmpeg: findFfmpeg
    // also probes EXTRA_FFMPEG_PATHS ('C:\ffmpeg\bin\ffmpeg.exe' and the
    // Program Files twin), which are absolute and unaffected by either. So on
    // any machine with a real install — including the nightly runner, which
    // installs ffmpeg on purpose one step earlier — the render SUCCEEDED and
    // this case asserted against the wrong outcome. It failed the gate nightly
    // while the product was fine.
    //
    // What this case is actually about is the refusal: it must name what to
    // install and must not strand the job. So make "no ffmpeg" true at the
    // lookup itself. The search ORDER has its own coverage in
    // media-render.test.ts, which injects a probe.
    const renderModule = require('../media-render');
    const ffmpegLookup = jest.spyOn(renderModule, 'findFfmpeg').mockResolvedValue(null);
    try {
      await call('media_create_job', { title: 'No ffmpeg here', format: 'short' });
      const jobs = readJobs();
      const j = jobs.find(x => x.title === 'No ffmpeg here')!;
      j.script = 'A short line.';
      
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'homebot-no-ffmpeg-'));
      const dummyAudio = path.join(tmpDir, 'dummy-narration.mp3');
      fs.writeFileSync(dummyAudio, 'dummy audio data');
      j.narrationPath = dummyAudio;
      
      j.state = 'media_production';
      require('../tools/media').writeJobs(jobs);

      const res: any = await call('media_render', { job: 'No ffmpeg here' });
      expect(res.success).toBe(false);
      expect(String(res.error)).toMatch(/ffmpeg/i);
      expect(String(res.error)).toMatch(/install|winget|ffmpeg\.org/i);
      // Still where it was, so a retry after installing just works.
      expect(readJobs().find(x => x.title === 'No ffmpeg here')!.state).toBe('media_production');
    } finally {
      ffmpegLookup.mockRestore();
    }
  });
});
