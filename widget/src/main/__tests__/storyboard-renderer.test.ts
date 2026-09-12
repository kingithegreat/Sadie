import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  formatSrtTimestamp,
  buildSrtFromShots,
  buildKenBurnsFilter,
  getStoryboardProjectDir,
  renderStoryboardMovie,
  ShotManifest,
} from '../movie/storyboard-renderer';
import {
  mediaCreateStoryboardHandler,
  mediaSaveStoryboardHandler,
  mediaBreakdownScriptHandler,
} from '../tools/media-storyboard';

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
        frameImagePath: '/fake/shot1.png',
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
        frameImagePath: null,
        frameStale: false,
      },
    ];

    const srt = buildSrtFromShots(shots);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:05,000\nThe dawn breaks over Giza.');
    expect(srt).toContain('2\n00:00:05,000 --> 00:00:09,000\nWorkers carving stone');
  });

  test('constructs dynamic Ken Burns motion filters for all camera movements', () => {
    // Slow Push In
    const pushIn = buildKenBurnsFilter('slow push in', 5, 30);
    expect(pushIn).toContain('zoompan=z=');
    expect(pushIn).toContain('s=1920x1080');
    expect(pushIn).toContain('d=150');

    // Pan Right
    const panRight = buildKenBurnsFilter('pan right', 3, 30);
    expect(panRight).toContain('zoompan');
    expect(panRight).toContain('x+1.5');

    // Tilt Up
    const tiltUp = buildKenBurnsFilter('tilt up', 4, 30);
    expect(tiltUp).toContain('zoompan');
    expect(tiltUp).toContain('y-1.5');

    // Tracking
    const tracking = buildKenBurnsFilter('tracking', 5, 30);
    expect(tracking).toContain('zoompan');
    expect(tracking).toContain('x+1.2');

    // Static
    const staticFilter = buildKenBurnsFilter('static', 5, 30);
    expect(staticFilter).toContain('scale=1920:1080');
  });

  test('resolves project directory correctly from environment', () => {
    const dir = getStoryboardProjectDir('sample-project');
    expect(dir).toBe(path.join(tmpRoot, 'sample-project'));
  });

  test('fails gracefully when FFmpeg is not found', async () => {
    (findFfmpeg as jest.Mock).mockResolvedValue(null);
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
    expect(res.error).toContain('No rendered keyframes found');
  });

  test('renders full 1080p movie with Ken Burns motion, voiceover, and burned subtitles', async () => {
    const created: any = await mediaCreateStoryboardHandler({
      projectId: 'full-movie-proj',
      title: 'Full Movie',
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
    expect(res.moviePath).toBe(path.join(projectDir, 'renders', 'full-movie-proj-1080p.mp4'));

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
});
