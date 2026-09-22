import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStudioOutputSpec } from '../../shared/media-output';
import { execFile } from 'child_process';
import {
  formatSrtTimestamp,
  buildSrtFromShots,
  buildKenBurnsFilter,
  MOTION_SUPERSAMPLE,
  getStoryboardProjectDir,
  resetNvencProbeCache,
  resolveVideoEncoder,
  renderStoryboardMovie,
  ShotManifest,
} from '../movie/storyboard-renderer';
import {
  mediaCreateStoryboardHandler,
  mediaSaveStoryboardHandler,
  mediaBreakdownScriptHandler,
} from '../tools/media-storyboard';

// This suite exercises full render orchestration and per-test filesystem fixtures.
// Keep CI load from turning that bounded integration work into Jest's default 5s timeout;
// the external FFmpeg process itself remains mocked below.
jest.setTimeout(15_000);

// Mock findFfmpeg from media-render
jest.mock('../media-render', () => ({
  ...jest.requireActual('../media-render'),
  findFfmpeg: jest.fn(),
}));

jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: jest.fn() }));
let mockMovieDuration = 0;
jest.mock('../media-qa', () => ({
  ...jest.requireActual('../media-qa'),
  inspectRender: jest.fn(async (_bin: string, file: string) => ({
    hasVideo: file.endsWith('.mp4'), hasAudio: true,
    width: file.endsWith('.mp4') ? 1920 : null,
    height: file.endsWith('.mp4') ? 1080 : null,
    durationSeconds: file.endsWith('.mp4') ? mockMovieDuration : 1,
    meanVolumeDb: -21, maxVolumeDb: -3,
  })),
}));

// Mock renderNarrationToFile from tools/voice
jest.mock('../tools/voice', () => ({
  renderNarrationToFile: jest.fn().mockResolvedValue({ path: '/fake/audio.mp3', bytes: 100 }),
}));

// Mock child_process execFile for ffmpeg calls
jest.mock('child_process', () => ({
  execFile: jest.fn((_bin, args, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts;
    }
    // Simulate successful ffmpeg run and create dummy output file if specified
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'string' && lastArg.endsWith('.mp4')) {
      mockMovieDuration = Number(args[args.indexOf('-t') + 1]);
    }
    if (typeof lastArg === 'string' && /\.(mp4|mp3|wav)$/.test(lastArg)) {
      try {
        fs.writeFileSync(lastArg, 'dummy media content', 'utf-8');
      } catch {
        /* ignore */
      }
    }
    if (cb) cb(null, 'ffmpeg stdout', '');
  }),
}));

import { findFfmpeg } from '../media-render';
import { renderNarrationToFile } from '../tools/voice';

/** Drops a fake generated frame into a shot's image dir, the way a real frame-generation call would. */
function dropFakeFrame(projectDir: string, sceneId: string, shotId: string) {
  const imgDir = path.join(projectDir, 'scenes', sceneId, shotId, 'image');
  fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, 'frame.png'), 'fake png bytes', 'utf-8');
}

describe('One-Click 1080p Storyboard Renderer', () => {
  let tmpRoot: string;
  const originalEnv = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-renderer-test-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = tmpRoot;
    (findFfmpeg as jest.Mock).mockResolvedValue('/usr/bin/ffmpeg');
    (renderNarrationToFile as jest.Mock).mockClear();
    (renderNarrationToFile as jest.Mock).mockImplementation(async (_text: string, requested: string) => {
      const actual = path.join(path.dirname(requested), 'narration.wav');
      fs.writeFileSync(actual, 'controlled narration bytes');
      return { path: actual, bytes: 26, engine: 'kokoro' };
    });
    resetNvencProbeCache();
  });

  afterEach(() => {
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = originalEnv;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('formats seconds into accurate SRT timecodes', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(5)).toBe('00:00:05,000');
    expect(formatSrtTimestamp(65.5)).toBe('00:01:05,500');
    expect(formatSrtTimestamp(3661.123)).toBe('01:01:01,123');
  });

  test('builds sequential SRT subtitle content from shots', () => {
    const shots: ShotManifest[] = [
      {
        shotId: 'shot_001',
        order: 1,
        prompt: 'Pyramids at dawn',
        framing: 'wide',
        lens: '24mm',
        movement: 'slow push in',
        durationSec: 5,
        narration: 'The dawn breaks over Giza.',
        status: 'COMPLETED',
        frameImagePath: '/fake/shot1.png', videoClipPath: null,
        frameStale: false,
      },
      {
        shotId: 'shot_002',
        order: 2,
        prompt: 'Workers carving stone',
        framing: 'medium',
        lens: '35mm',
        movement: 'pan right',
        durationSec: 4,
        narration: '',
        status: 'PLANNED',
        frameImagePath: null, videoClipPath: null,
        frameStale: false,
      },
    ];

    const srt = buildSrtFromShots(shots);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:05,000\nThe dawn breaks over Giza.');
    expect(srt).toContain('2\n00:00:05,000 --> 00:00:09,000\nWorkers carving stone');
  });

  test('constructs dynamic Ken Burns motion filters for all camera movements', () => {
    // MS-8: each move is computed on a supersampled frame, and its position
    // comes from the frame number rather than the previous position, so
    // zoompan's whole-pixel truncation cannot make the motion uneven.
    const pushIn = buildKenBurnsFilter('slow push in', 5, 30);
    expect(pushIn).toContain(`scale=iw*${MOTION_SUPERSAMPLE}:ih*${MOTION_SUPERSAMPLE}:flags=bicubic`);
    expect(pushIn).toContain("z='min(1+0.0015*on,1.25)'");
    expect(pushIn).toContain('s=1920x1080');
    expect(pushIn).toContain('d=150');

    // 1.5 output px per frame is 3 supersampled px — a whole number, which is
    // what keeps the steps even.
    const panRight = buildKenBurnsFilter('pan right', 3, 30);
    expect(panRight).toContain(`on*${1.5 * MOTION_SUPERSAMPLE}`);
    expect(panRight).not.toContain('x+');

    const tiltUp = buildKenBurnsFilter('tilt up', 4, 30);
    expect(tiltUp).toContain(`on*${1.5 * MOTION_SUPERSAMPLE}`);
    expect(tiltUp).not.toContain('y-1.5');

    // Tracking pans 1 px per frame: 1.2 does not land on the supersample grid.
    const tracking = buildKenBurnsFilter('tracking', 5, 30);
    expect(tracking).toContain(`on*${MOTION_SUPERSAMPLE}`);
    expect(tracking).toContain("z='min(1+0.001*on,1.18)'");

    // A locked shot has nothing to smooth, so it is not made bigger first.
    const staticFilter = buildKenBurnsFilter('static', 5, 30);
    expect(staticFilter).toContain('scale=1920:1080');
    expect(staticFilter).not.toContain('iw*2');
  });

  test('resolves project directory correctly from environment', () => {
    const dir = getStoryboardProjectDir('sample-project');
    expect(dir).toBe(path.join(tmpRoot, 'sample-project'));
  });

  test('fails gracefully when FFmpeg is not found', async () => {
    (findFfmpeg as jest.Mock).mockResolvedValue(null);
    fs.mkdirSync(path.join(tmpRoot, 'any-project'));
    const res = await renderStoryboardMovie({ projectId: 'any-project' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('FFmpeg was not found');
  });

  test('fails gracefully when project directory is missing', async () => {
    const res = await renderStoryboardMovie({ projectId: 'nonexistent-project' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('directory not found');
  });

  test('fails gracefully when storyboard has no rendered frames', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'empty-frames-proj',
      title: 'Empty Frames',
      shots: [{ prompt: 'Unrendered shot', durationSec: 5 }],
    }, {} as any);
    expect(created.success).toBe(true);

    const res = await renderStoryboardMovie({ projectId: 'empty-frames-proj' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('No rendered keyframes or video clips found');
  });

  test('a new storyboard left on its defaults exports its camera moves (crop), while a saved fit project stays still', async () => {
    const zoompanCalls = () => (execFile as unknown as jest.Mock).mock.calls.filter(([, args]) => args.some((arg: string) => arg.includes('zoompan='))).length;
    const shots = [{ prompt: 'Harbour at dawn', durationSec: 3, narration: 'Dawn.', movement: 'slow push in' }];

    // No outputSpec: the default a user gets from the New Storyboard button.
    const created: any = await mediaCreateStoryboardHandler({ projectId: 'default-motion', title: 'Default Motion', shots }, {} as any);
    expect(created.success).toBe(true);
    const saved = JSON.parse(fs.readFileSync(path.join(created.result.projectDir, 'project.json'), 'utf8'));
    expect(saved.outputSpec).toEqual(createStudioOutputSpec('16:9', 'short', '1080p', 'crop'));
    dropFakeFrame(created.result.projectDir, 'scene_01', 'shot_001');
    (execFile as unknown as jest.Mock).mockClear();
    expect((await renderStoryboardMovie({ projectId: 'default-motion', motion: true })).ok).toBe(true);
    expect(zoompanCalls()).toBe(1);

    // Control: the same shot in a project the owner saved as fit keeps the whole image still.
    const fit: any = await mediaCreateStoryboardHandler({ projectId: 'fit-still', title: 'Fit Still', shots,
      outputSpec: createStudioOutputSpec('16:9', 'short', '1080p', 'fit') }, {} as any);
    dropFakeFrame(fit.result.projectDir, 'scene_01', 'shot_001');
    (execFile as unknown as jest.Mock).mockClear();
    expect((await renderStoryboardMovie({ projectId: 'fit-still', motion: true })).ok).toBe(true);
    expect(zoompanCalls()).toBe(0);
  });

  test('renders full 1080p movie with Ken Burns motion, voiceover, and burned subtitles', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'full-movie-proj',
      title: 'Full Movie',
      outputSpec: createStudioOutputSpec('16:9', 'short', '1080p', 'crop'),
      shots: [
        { prompt: 'Establishing landscape', durationSec: 5, narration: 'Behold the horizon.', movement: 'slow push in' },
        { prompt: 'Subject enters temple', durationSec: 4, narration: 'He enters with caution.', movement: 'pan right' },
      ],
    }, {} as any);
    expect(created.success).toBe(true);
    const projectDir = created.result.projectDir as string;

    dropFakeFrame(projectDir, 'scene_01', 'shot_001');
    dropFakeFrame(projectDir, 'scene_01', 'shot_002');

    const res = await renderStoryboardMovie({
      projectId: 'full-movie-proj',
      motion: true,
      burnSubtitles: true,
    });

    expect(res.ok).toBe(true);
    expect(res.durationSec).toBe(9);
    expect(res.totalShots).toBe(2);
    expect(path.dirname(res.moviePath!)).toBe(path.join(projectDir, 'renders'));
    expect(path.basename(res.moviePath!)).toMatch(/^full-movie-proj-landscape-[a-f0-9-]+\.mp4$/);
    expect(res.outputSpec).toEqual(createStudioOutputSpec('16:9', 'short', '1080p', 'crop'));
    expect(res.renderedOutput?.filename).toBe(path.basename(res.moviePath!));
    expect((execFile as unknown as jest.Mock).mock.calls.some(([, args]) => args.some((arg: string) => arg.includes('zoompan=')))).toBe(true);

    // Regression pin: the exact bug this replaces — render must not depend on
    // manifest.json existing anywhere in the project.
    expect(fs.existsSync(path.join(projectDir, 'scenes', 'scene_01', 'manifest.json'))).toBe(false);
  });

  test('a fresh, never-edited, auto-directed project renders — the render path was broken outright before this fix', async () => {
    const directed: any = await mediaBreakdownScriptHandler({
      projectId: 'fresh-auto-directed',
      title: 'Fresh Auto-Directed',
      script: 'A storm rose over the sea. The sailors were afraid. The captain held the wheel steady through the night.',
      shotCount: 2,
      autoGenerateFrames: false,
    }, {} as any);
    expect(directed.success).toBe(true);

    const projectDir = getStoryboardProjectDir('fresh-auto-directed');
    dropFakeFrame(projectDir, 'scene_01', 'shot_001');
    dropFakeFrame(projectDir, 'scene_01', 'shot_002');

    const res = await renderStoryboardMovie({ projectId: 'fresh-auto-directed' });
    expect(res.ok).toBe(true);
    expect(res.totalShots).toBe(2);
  });

  test('a caption style saved through the Storyboard Deck reaches the burned captions; an invalid one is refused', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'caption-style', title: 'Caption Style', burnSubtitles: true,
      outputSpec: createStudioOutputSpec('16:9', 'short', '1080p', 'crop'),
      shots: [{ prompt: 'Harbour at dawn', durationSec: 3, narration: 'The boats come home.' }],
    }, {} as any);
    const projectDir = created.result.projectDir as string;
    dropFakeFrame(projectDir, 'scene_01', 'shot_001');
    const shots = [{ shotId: 'shot_001', prompt: 'Harbour at dawn', durationSec: 3, narration: 'The boats come home.' }];

    const refused: any = await mediaSaveStoryboardHandler({ projectId: 'caption-style', sceneId: 'scene_01', shots, captionStyle: { color: 'red' } }, {} as any);
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/colour like #ffffff/);

    const saved: any = await mediaSaveStoryboardHandler({ projectId: 'caption-style', sceneId: 'scene_01', shots,
      captionStyle: { position: 'middle', background: 'box', size: 'small' } }, {} as any);
    expect(saved.success).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')).captionStyle)
      .toEqual({ size: 'small', position: 'middle', font: 'Arial', color: '#ffffff', background: 'box' });

    (execFile as unknown as jest.Mock).mockClear();
    expect((await renderStoryboardMovie({ projectId: 'caption-style', burnSubtitles: true })).ok).toBe(true);
    const captionArgs = (execFile as unknown as jest.Mock).mock.calls.flatMap(([, args]) => args).filter((arg: string) => arg.includes('subtitles='));
    expect(captionArgs.length).toBeGreaterThan(0);
    for (const arg of captionArgs) {
      expect(arg).toContain('Alignment=10');
      expect(arg).toContain('BorderStyle=3');
    }
  });

  test('an edit made and saved through the Storyboard Deck reaches the export — the exact bug this fixes', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'edit-reaches-export',
      title: 'Edit Reaches Export',
      shots: [
        { prompt: 'Original prompt A', durationSec: 5, narration: 'Original narration A.' },
        { prompt: 'Original prompt B', durationSec: 5, narration: 'Original narration B.' },
      ],
    }, {} as any);
    expect(created.success).toBe(true);
    const projectDir = created.result.projectDir as string;

    dropFakeFrame(projectDir, 'scene_01', 'shot_001');
    dropFakeFrame(projectDir, 'scene_01', 'shot_002');

    // Edit through the real save path: reorder (B first), retime, new prompt
    // text, new narration — exactly what the Storyboard Deck UI sends.
    const saved: any = await mediaSaveStoryboardHandler({
      projectId: 'edit-reaches-export',
      sceneId: 'scene_01',
      shots: [
        { shotId: 'shot_002', prompt: 'EDITED prompt B', durationSec: 7, narration: 'EDITED narration B.' },
        { shotId: 'shot_001', prompt: 'EDITED prompt A', durationSec: 3, narration: 'EDITED narration A.' },
      ],
    }, {} as any);
    expect(saved.success).toBe(true);

    const res = await renderStoryboardMovie({ projectId: 'edit-reaches-export' });
    expect(res.ok).toBe(true);

    // Duration reflects the EDITED durations (7 + 3), not the original (5 + 5).
    expect(res.durationSec).toBe(10);

    // Narration synthesis was called with the EDITED text, not the original —
    // and in the EDITED order (shot_002 first, per the save above).
    const narrationCalls = (renderNarrationToFile as jest.Mock).mock.calls.map(c => c[0]);
    expect(narrationCalls).toEqual(['EDITED narration B.', 'EDITED narration A.']);
    expect(narrationCalls.join(' ')).not.toContain('Original narration');
  });

  test('MS-4 mixes a saved music bed with measured sidechain ducking, including transition exports', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'music-ducking', title: 'Music Ducking',
      shots: [
        { prompt: 'Opening', durationSec: 4, narration: 'A spoken opening.', transition: 'crossfade', transitionSec: 0.5 },
        { prompt: 'Closing', durationSec: 4, narration: 'A spoken closing.' },
      ],
    }, {} as any);
    const projectDir = created.result.projectDir as string;
    dropFakeFrame(projectDir, 'scene_01', 'shot_001');
    dropFakeFrame(projectDir, 'scene_01', 'shot_002');
    await mediaSaveStoryboardHandler({
      projectId: 'music-ducking', sceneId: 'scene_01',
      musicEnabled: true, musicVolume: 0.22,
      shots: [
        { shotId: 'shot_001', prompt: 'Opening', durationSec: 4, narration: 'A spoken opening.', transition: 'crossfade', transitionSec: 0.5 },
        { shotId: 'shot_002', prompt: 'Closing', durationSec: 4, narration: 'A spoken closing.' },
      ],
    }, {} as any);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')))
      .toMatchObject({ musicEnabled: true, musicVolume: 0.22 });
    const music = path.join(projectDir, 'bed.wav');
    fs.writeFileSync(music, 'controlled music bytes');

    (execFile as unknown as jest.Mock).mockClear();
    const res = await renderStoryboardMovie({ projectId: 'music-ducking', music, musicVolume: 0.22, encoder: 'cpu' });
    expect(res.ok).toBe(true);
    const calls = (execFile as unknown as jest.Mock).mock.calls.map(([, args]) => args as string[]);
    const transitionMix = calls.find(args => args.includes('-filter_complex') && args.some(arg => arg.includes('xfade=')));
    expect(transitionMix).toBeDefined();
    expect(transitionMix).toContain(music);
    const graph = transitionMix![transitionMix!.indexOf('-filter_complex') + 1];
    expect(graph).toContain('sidechaincompress=threshold=0.03:ratio=8:attack=5:release=400');
    expect(graph).toContain('volume=0.22');
    expect(graph).toContain('amix=inputs=2:duration=first:normalize=0');
  });

  test('MS-4 refuses a non-finite or out-of-range music level before invoking FFmpeg', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'bad-music-level', title: 'Bad Music Level',
      shots: [{ prompt: 'Opening', durationSec: 3, narration: 'Opening.' }],
    }, {} as any);
    dropFakeFrame(created.result.projectDir, 'scene_01', 'shot_001');

    (execFile as unknown as jest.Mock).mockClear();
    const res = await renderStoryboardMovie({ projectId: 'bad-music-level', music: true, musicVolume: Number.NaN });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/music volume/i);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('MS-9 probes NVENC with a real frame and falls back to software when the probe fails', async () => {
    const exec = execFile as unknown as jest.Mock;
    exec.mockClear();
    exec.mockImplementationOnce((_bin, args, _opts, cb) => {
      expect(args).toEqual(expect.arrayContaining(['-frames:v', '1', '-c:v', 'h264_nvenc']));
      cb(new Error('No capable devices found'), '', 'No capable devices found');
    });

    await expect(resolveVideoEncoder('/ffmpeg', 'nvenc')).resolves.toMatchObject({
      encoder: 'libx264', preset: 'veryfast', fellBack: true,
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('MS-9 uses NVENC only after its local encode probe succeeds, while CPU skips the probe', async () => {
    const exec = execFile as unknown as jest.Mock;
    exec.mockClear();
    await expect(resolveVideoEncoder('/ffmpeg', 'cpu')).resolves.toMatchObject({ encoder: 'libx264', fellBack: false });
    expect(exec).not.toHaveBeenCalled();

    await expect(resolveVideoEncoder('/ffmpeg', 'auto')).resolves.toMatchObject({ encoder: 'h264_nvenc', preset: 'p4', fellBack: false });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('MS-9 routes a real storyboard export through the probed encoder and surfaces software fallback', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'encoder-route', title: 'Encoder Route',
      shots: [{ prompt: 'Opening', durationSec: 3, narration: 'Opening.' }],
    }, {} as any);
    dropFakeFrame(created.result.projectDir, 'scene_01', 'shot_001');
    const exec = execFile as unknown as jest.Mock;

    exec.mockClear();
    const gpu = await renderStoryboardMovie({ projectId: 'encoder-route', encoder: 'auto', outputName: 'gpu.mp4' });
    expect(gpu.ok).toBe(true);
    expect(exec.mock.calls.some(([, args]) => args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'h264_nvenc')).toBe(true);

    resetNvencProbeCache();
    exec.mockClear();
    exec.mockImplementationOnce((_bin, _args, _opts, cb) => cb(new Error('No capable devices'), '', 'No capable devices'));
    const cpu = await renderStoryboardMovie({ projectId: 'encoder-route', encoder: 'nvenc', outputName: 'fallback.mp4' });
    expect(cpu.ok).toBe(true);
    expect(cpu.warning).toMatch(/used the CPU encoder/i);
    expect(exec.mock.calls.some(([, args]) => args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'libx264')).toBe(true);
  });
});
