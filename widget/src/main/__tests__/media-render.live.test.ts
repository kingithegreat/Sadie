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

maybe('rendering a real video', () => {
  beforeAll(() => { initializeTools(); __resetMediaJobsForTests(); });
  afterAll(() => { __resetMediaJobsForTests(); });

  it('turns a narrated job into a playable mp4', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) {
      // Not a silent skip: the point of this test is the binary.
      throw new Error('No ffmpeg found. Set HOMEBOT_FFMPEG or install it, or run without HOMEBOT_LIVE=1.');
    }

    await call('media_create_job', { title: 'Render check', format: 'short' });

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
    expect(failed.renderPath).toBeTruthy();
    expect(fs.existsSync(failed.renderPath!)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a render whose captions are missing', async () => {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('No ffmpeg found.');

    await call('media_create_job', { title: 'Missing captions check', format: 'short' });
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

  it('renders scene images into a multi-cut video', async () => {
    // The upgrade the timeline existed for. Image generation is real here —
    // it is the part most likely to fail in the wild, so it is the part worth
    // running for real. The video must come out either way.
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('No ffmpeg found.');

    await call('media_create_job', { title: 'Scene check', format: 'short' });
    const jobs = readJobs();
    const j = jobs.find(x => x.title === 'Scene check')!;
    j.script = 'A storm rose over the open sea at night. '
      + 'The sailors threw the cargo overboard to lighten the ship. '
      + 'Below deck, one man slept through all of it.';
    j.state = 'script_draft';
    require('../tools/media').writeJobs(jobs);

    expect((await call('media_narrate', { job: 'Scene check' }) as any).success).toBe(true);

    const rendered: any = await call('media_render', { job: 'Scene check', visuals: 'scenes' });
    // eslint-disable-next-line no-console
    console.log('--- media_render (scenes) ---\n', rendered.success ? rendered.result : rendered.error);
    expect(rendered.success).toBe(true);

    const done = readJobs().find(x => x.title === 'Scene check')!;
    const info = await ffprobe(ffmpeg, done.renderPath!);
    const video = info.streams.find((s: any) => s.codec_type === 'video');
    expect(video.width).toBe(1080);
    expect(video.height).toBe(1920);
    expect(Number(info.format.duration)).toBeGreaterThan(5);

    // Whatever the generator managed, the scenes directory records it, so a
    // person can look at what was produced and swap one by hand.
    const sceneDir = path.join(path.dirname(done.renderPath!), 'scenes');
    if (fs.existsSync(sceneDir)) {
      // eslint-disable-next-line no-console
      console.log('scene images:', fs.readdirSync(sceneDir).join(', ') || '(none)');
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
      j.narrationPath = readJobs().find(x => x.title === 'Render check')?.narrationPath;
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
