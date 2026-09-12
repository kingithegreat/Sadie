/**
 * Regression coverage for the Media Studio render handler's QA trust boundary.
 *
 * FFmpeg rendering and inspection are external adapters here. The handler and
 * media-job store still run for real against a temporary directory, so these
 * assertions cover the persisted state and files that a user can reach after
 * QA succeeds or cannot run.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MediaJob } from '../media-studio';

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => process.env.HOMEBOT_QA_TEST_USER_DATA || require('os').tmpdir()),
    getAppPath: jest.fn(() => process.env.HOMEBOT_QA_TEST_USER_DATA || require('os').tmpdir()),
  },
}));

jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => ({ mediaMusicEnabled: false })),
}));

jest.mock('../ffmpeg-setup', () => ({
  findManagedFfmpeg: jest.fn(() => 'managed-ffmpeg.exe'),
}));

jest.mock('../media-music', () => ({
  chooseMusic: jest.fn(() => ({ path: null, available: 0, reason: 'music is off' })),
}));

jest.mock('../media-render', () => ({
  findFfmpeg: jest.fn(async () => 'mock-ffmpeg.exe'),
  dimensionsFor: jest.fn(() => ({ w: 1080, h: 1920 })),
  renderVideo: jest.fn(async ({ outputPath }: { outputPath: string }) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.alloc(12_000, 1));
    return { path: outputPath, bytes: 12_000, args: [] };
  }),
}));

jest.mock('../media-qa', () => {
  const actual = jest.requireActual('../media-qa');
  return { ...actual, inspectRender: jest.fn() };
});

import { inspectRender } from '../media-qa';
import {
  __resetMediaJobsForTests,
  mediaToolHandlers,
  readJobs,
  writeJobs,
} from '../tools/media';

const mockedInspectRender = inspectRender as jest.MockedFunction<typeof inspectRender>;
const call = (name: string, args: Record<string, unknown>) =>
  mediaToolHandlers[name](args, { executionId: 'qa-trust-test' } as any);

let testRoot: string;
let narrationPath: string;
let captionsPath: string;
let scenePath: string;

function writeReadyJob(title: string): MediaJob {
  narrationPath = path.join(testRoot, 'source', 'narration.wav');
  captionsPath = path.join(testRoot, 'source', 'captions.srt');
  scenePath = path.join(testRoot, 'source', 'scene-1.png');
  fs.mkdirSync(path.dirname(narrationPath), { recursive: true });
  fs.writeFileSync(narrationPath, 'narration');
  fs.writeFileSync(captionsPath, '1\n00:00:00,000 --> 00:00:03,000\nHello\n');
  fs.writeFileSync(scenePath, 'scene');

  const job: MediaJob = {
    id: `media_${title.toLowerCase().replace(/\s+/g, '_')}`,
    title,
    format: 'short',
    state: 'media_production',
    narrationPath,
    captionsPath,
    scenePaths: [scenePath],
    durationSeconds: 3,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    history: [],
  };
  writeJobs([job]);
  return job;
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-qa-trust-'));
  process.env.HOMEBOT_QA_TEST_USER_DATA = testRoot;
  mockedInspectRender.mockReset();
  __resetMediaJobsForTests();
});

afterEach(() => {
  __resetMediaJobsForTests();
  delete process.env.HOMEBOT_QA_TEST_USER_DATA;
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('media_render output trust', () => {
  it('fails closed when the rendered file cannot be measured, while preserving every asset', async () => {
    writeReadyJob('Probe unavailable');
    mockedInspectRender.mockRejectedValueOnce(new Error('FFmpeg inspection timed out'));

    const result: any = await call('media_render', { job: 'Probe unavailable', visuals: 'plain' });
    const persisted = readJobs()[0];

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/could not (check|measure|verify).*FFmpeg inspection timed out/i);
    expect(persisted.state).toBe('needs_revision');
    // A rejected render is parked under its own name rather than claiming
    // video.mp4, so it stays inspectable without overwriting a good export.
    expect(persisted.renderPath).toBe(path.join(testRoot, 'media-assets', persisted.id, 'video.rejected.mp4'));
    expect(fs.statSync(persisted.renderPath!).size).toBe(12_000);
    expect(persisted.narrationPath).toBe(narrationPath);
    expect(persisted.captionsPath).toBe(captionsPath);
    expect(persisted.scenePaths).toEqual([scenePath]);
    expect(persisted.history.at(-1)).toMatchObject({
      from: 'render_qa',
      to: 'needs_revision',
      by: 'render QA',
    });
    expect(persisted.history.map(event => event.to)).toEqual(['render_qa', 'needs_revision']);

    const reviewAdvance: any = await call('media_advance_job', {
      job: persisted.id,
      to: 'awaiting_approval',
    });
    expect(reviewAdvance.success).toBe(false);
    expect(readJobs()[0].state).toBe('needs_revision');

    const approval: any = await call('media_approve_job', { job: persisted.id });
    expect(approval.success).toBe(false);
    expect(readJobs()[0].state).toBe('needs_revision');
  });

  it('persists a measured QA failure without losing the completed render', async () => {
    writeReadyJob('Missing narration stream');
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true, hasAudio: false, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: null, maxVolumeDb: null, frameSamples: null,
    });
    const result = await call('media_render', { job: 'Missing narration stream', visuals: 'plain' });
    const persisted = readJobs()[0];
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/audio/i);
    expect(persisted.state).toBe('needs_revision');
    expect(persisted.history.at(-1)).toMatchObject({ from: 'render_qa', to: 'needs_revision', by: 'render QA' });
    expect(fs.statSync(persisted.renderPath!).size).toBe(12_000);
    expect(persisted.narrationPath).toBe(narrationPath);
  });

  it('a failed replacement leaves the previous good video byte-identical', async () => {
    // The acceptance requirement this protects: re-rendering an episode that
    // already has a good export must not destroy it when the new render is
    // rejected. Rendering wrote straight to video.mp4, so a rejected retry used
    // to overwrite the very file the person was keeping.
    const job = writeReadyJob('Replacement fails');
    const assetDir = path.join(testRoot, 'media-assets', job.id);
    const goodVideo = path.join(assetDir, 'video.mp4');
    fs.mkdirSync(assetDir, { recursive: true });
    const goodBytes = Buffer.alloc(5_000, 7);
    fs.writeFileSync(goodVideo, goodBytes);

    // The retry renders, then fails QA for a missing audio stream.
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true, hasAudio: false, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: null, maxVolumeDb: null, frameSamples: null,
    });
    const result: any = await call('media_render', { job: 'Replacement fails', visuals: 'plain' });

    expect(result.success).toBe(false);
    // The previous export is still exactly what it was.
    expect(fs.existsSync(goodVideo)).toBe(true);
    expect(fs.readFileSync(goodVideo).equals(goodBytes)).toBe(true);
    // And the rejected attempt is still on disk under its own name.
    const persisted = readJobs()[0];
    expect(persisted.renderPath).toBe(path.join(assetDir, 'video.rejected.mp4'));
    expect(fs.statSync(persisted.renderPath!).size).toBe(12_000);
  });

  it('keeps a measured QA success and warning on the existing render_qa path', async () => {
    writeReadyJob('Measured output');
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true,
      hasAudio: true,
      width: 1080,
      height: 1920,
      durationSeconds: 3,
      meanVolumeDb: -21,
      maxVolumeDb: 0,
      frameSamples: null,
    });

    const result: any = await call('media_render', { job: 'Measured output', visuals: 'plain' });
    const persisted = readJobs()[0];

    expect(result.success).toBe(true);
    expect(String(result.result)).toMatch(/checks passed, with a note/i);
    expect(String(result.result)).toMatch(/narration peaks/i);
    expect(persisted.state).toBe('render_qa');
    expect(persisted.renderPath).toBe(path.join(testRoot, 'media-assets', persisted.id, 'video.mp4'));
    expect(fs.existsSync(persisted.renderPath!)).toBe(true);
    expect(persisted.narrationPath).toBe(narrationPath);
    expect(persisted.captionsPath).toBe(captionsPath);
    expect(persisted.scenePaths).toEqual([scenePath]);
    expect(persisted.state).not.toBe('approved');
  });

  it('a placeholder-flat render fails closed through the same trust boundary', async () => {
    writeReadyJob('Flat placeholder');
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true,
      hasAudio: true,
      width: 1080,
      height: 1920,
      durationSeconds: 3,
      meanVolumeDb: -21,
      maxVolumeDb: -14,
      // Every sample reads flat — a solid-color placeholder, not real content.
      frameSamples: [
        { atSeconds: 0.3, stdDev: 0.4 },
        { atSeconds: 0.9, stdDev: 0.2 },
        { atSeconds: 1.5, stdDev: 0.5 },
        { atSeconds: 2.1, stdDev: 0.1 },
        { atSeconds: 2.7, stdDev: 0.3 },
      ],
    });

    const result: any = await call('media_render', { job: 'Flat placeholder', visuals: 'plain' });
    const persisted = readJobs()[0];

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/flat color|placeholder/i);
    expect(persisted.state).toBe('needs_revision');
    // The render itself is preserved, same as every other QA failure here.
    expect(fs.statSync(persisted.renderPath!).size).toBe(12_000);
  });
});
