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

    const rendered: any = await call('media_render', { job: 'Render check' });
    // eslint-disable-next-line no-console
    console.log('--- media_render ---\n', rendered.success ? rendered.result : rendered.error);
    expect(rendered.success).toBe(true);

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

  it('says what to install when ffmpeg is missing, and leaves the job alone', async () => {
    // The whole reason for detect-don't-bundle: the refusal has to be
    // actionable, and must not strand the job in a state it cannot leave.
    const real = process.env.HOMEBOT_FFMPEG;
    const prevPath = process.env.PATH;
    process.env.HOMEBOT_FFMPEG = path.join(require('os').tmpdir(), 'definitely-not-ffmpeg.exe');
    process.env.PATH = path.join(require('os').tmpdir(), 'empty-path-for-test');
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
      if (real) process.env.HOMEBOT_FFMPEG = real; else delete process.env.HOMEBOT_FFMPEG;
      process.env.PATH = prevPath;
    }
  });
});
