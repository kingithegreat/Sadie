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

// Mock findFfmpeg from media-render
jest.mock('../media-render', () => ({
  ...jest.requireActual('../media-render'),
  findFfmpeg: jest.fn(),
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
    if (typeof lastArg === 'string' && (lastArg.endsWith('.mp4') || lastArg.endsWith('.mp3'))) {
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

describe('One-Click 1080p Storyboard Renderer', () => {
  let tmpRoot: string;
  const originalEnv = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-renderer-test-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = tmpRoot;
    (findFfmpeg as jest.Mock).mockResolvedValue('/usr/bin/ffmpeg');
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
      },
      {
        shotId: 'shot_002',
        order: 2,
        prompt: 'Workers carving stone',
        framing: 'medium',
        lens: '35mm',
        movement: 'pan right',
        durationSec: 4,
        status: 'PLANNED',
        frameImagePath: null,
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
    const projDir = path.join(tmpRoot, 'empty-frames-proj');
    const sceneDir = path.join(projDir, 'scenes', 'scene_01');
    fs.mkdirSync(sceneDir, { recursive: true });

    const manifest: ShotManifest[] = [
      {
        shotId: 'shot_001',
        order: 1,
        prompt: 'Unrendered shot',
        framing: 'wide',
        lens: '24mm',
        movement: 'static',
        durationSec: 5,
        status: 'PLANNED',
        frameImagePath: null,
      },
    ];
    fs.writeFileSync(path.join(sceneDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    const res = await renderStoryboardMovie({ projectId: 'empty-frames-proj' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('No rendered keyframes found');
  });

  test('renders full 1080p movie with Ken Burns motion, voiceover, and burned subtitles', async () => {
    const projDir = path.join(tmpRoot, 'full-movie-proj');
    const sceneDir = path.join(projDir, 'scenes', 'scene_01');
    fs.mkdirSync(sceneDir, { recursive: true });

    const fakeImgPath = path.join(projDir, 'frame1.png');
    fs.writeFileSync(fakeImgPath, 'dummy image bytes', 'utf-8');

    const manifest: ShotManifest[] = [
      {
        shotId: 'shot_001',
        order: 1,
        prompt: 'Establishing landscape',
        framing: 'wide',
        lens: '24mm',
        movement: 'slow push in',
        durationSec: 5,
        narration: 'Behold the horizon.',
        status: 'COMPLETED',
        frameImagePath: fakeImgPath,
      },
      {
        shotId: 'shot_002',
        order: 2,
        prompt: 'Subject enters temple',
        framing: 'medium',
        lens: '35mm',
        movement: 'pan right',
        durationSec: 4,
        narration: 'He enters with caution.',
        status: 'COMPLETED',
        frameImagePath: fakeImgPath,
      },
    ];
    fs.writeFileSync(path.join(sceneDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    const res = await renderStoryboardMovie({
      projectId: 'full-movie-proj',
      motion: true,
      burnSubtitles: true,
    });

    expect(res.ok).toBe(true);
    expect(res.durationSec).toBe(9);
    expect(res.totalShots).toBe(2);
    expect(res.moviePath).toBe(path.join(projDir, 'renders', 'full-movie-proj-1080p.mp4'));
  });
});
