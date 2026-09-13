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
  ...jest.requireActual('../media-render'),
  findFfmpeg: jest.fn(async () => 'mock-ffmpeg.exe'),
  dimensionsFor: jest.fn(() => ({ w: 1080, h: 1920 })),
  renderVideo: jest.fn(async ({ outputPath }: { outputPath: string }) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.alloc(12_000, 1));
    return { path: outputPath, bytes: 12_000, args: [] };
  }),
}));

jest.mock('../media-visuals', () => ({
  ...jest.requireActual('../media-visuals'),
  generateSceneImages: jest.fn(),
}));

jest.mock('../media-qa', () => {
  const actual = jest.requireActual('../media-qa');
  return { ...actual, inspectRender: jest.fn() };
});

import { inspectRender } from '../media-qa';
import { renderVideo } from '../media-render';
import { generateSceneImages } from '../media-visuals';
import { createJob } from '../media-studio';
import { createStudioOutputSpec } from '../../shared/media-output';
import { mediaScriptDigest } from '../media-job-export-state';
import {
  __resetMediaJobsForTests,
  getMediaJobExportState,
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
  const goodFacts = { hasVideo: true, hasAudio: true, width: 1080, height: 1920,
    durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null };

  it('encodes both variants from one frozen input set and preserves two successful files', async () => {
    const job = writeReadyJob('Two frozen outputs');
    job.burnSubtitles = false;
    job.outputSpec = { ...createStudioOutputSpec('16:9'), variants: [
      createStudioOutputSpec('16:9').variants[0], createStudioOutputSpec('9:16').variants[0],
    ] };
    writeJobs([job]);
    const calls: any[] = [];
    const encode = async (options: any) => {
      calls.push(options);
      expect(fs.readFileSync(options.audioPath, 'utf8')).toBe('narration');
      expect(fs.readFileSync(options.imagePath, 'utf8')).toBe('scene');
      fs.writeFileSync(narrationPath, 'a later source edit');
      fs.writeFileSync(scenePath, 'later artwork');
      fs.writeFileSync(options.outputPath, Buffer.alloc(12000, calls.length));
      return { path: options.outputPath, bytes: 12000, args: [] };
    };
    const renderMock = renderVideo as jest.Mock;
    const defaultEncode = renderMock.getMockImplementation();
    renderMock.mockImplementationOnce(encode).mockImplementationOnce(encode);
    mockedInspectRender.mockImplementation(async (_bin, file) => {
      const encoded = calls.find(options => options.outputPath === file);
      return encoded ? { ...goodFacts, width: encoded.outputVariant.width, height: encoded.outputVariant.height }
        : { ...goodFacts, hasVideo: false };
    });
    try {
      const result = await call('media_render', { job: job.id, image: scenePath, visuals: 'plain' });
      expect(result.success).toBe(true);
      expect(calls.map(options => options.outputVariant.id)).toEqual(['landscape', 'portrait']);
      expect(calls[1].audioPath).toBe(calls[0].audioPath);
      expect(calls[1].imagePath).toBe(calls[0].imagePath);
      const state = await getMediaJobExportState(job.id);
      expect(state.outputs).toHaveLength(2);
      expect(new Set(state.outputs.map(item => item.moviePath)).size).toBe(2);
      expect(state.outputs.map(item => item.outputSpec.variants[0].id).sort()).toEqual(['landscape', 'portrait']);
      for (const item of state.outputs) expect(fs.existsSync(item.moviePath)).toBe(true);
    } finally {
      // Early validation can leave both one-shot encoders unused. Clear that
      // queue as well as restoring the default, even when the assertion fails.
      renderMock.mockReset().mockImplementation(defaultEncode);
    }
  });

  it('keeps immutable legacy history and compares content, not save timestamps', async () => {
    const job = writeReadyJob('Immutable legacy history');
    mockedInspectRender.mockResolvedValue(goodFacts);
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(true);
    const first = readJobs()[0];
    const bytes = fs.readFileSync(first.renderPath!);
    let state = await getMediaJobExportState(job.id);
    expect(state.outputs).toHaveLength(1);
    expect(state.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(state.outputs[0].sourceRevision).toBe(state.sourceRevision);
    writeJobs([{ ...first, updatedAt: '2026-09-13T12:00:00Z' }]);
    expect((await getMediaJobExportState(job.id)).sourceRevision).toBe(state.sourceRevision);
    await call('media_advance_job', { job: job.id, to: 'needs_revision' });
    await call('media_advance_job', { job: job.id, to: 'media_production' });
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(true);
    expect(readJobs()[0].renderPath).not.toBe(first.renderPath);
    expect(fs.readFileSync(first.renderPath!).equals(bytes)).toBe(true);
    state = await getMediaJobExportState(job.id);
    expect(state.outputs).toHaveLength(2);
    expect(new Set(state.outputs.map(item => item.exportId)).size).toBe(2);
    const savedAudioTime = fs.statSync(narrationPath).mtime;
    fs.writeFileSync(narrationPath, 'different spoken content');
    fs.utimesSync(narrationPath, savedAudioTime, savedAudioTime);
    expect((await getMediaJobExportState(job.id)).sourceRevision).not.toBe(state.sourceRevision);
    expect((await call('media_advance_job', { job: job.id, to: 'awaiting_approval' })).success).toBe(false);
  });

  it('keeps landscape review independent after portrait fails, retries only portrait and preserves an approved sibling', async () => {
    const job = writeReadyJob('Independent output recovery');
    job.burnSubtitles = false;
    job.outputSpec = { ...createStudioOutputSpec('16:9'), variants: [
      createStudioOutputSpec('16:9').variants[0], createStudioOutputSpec('9:16').variants[0],
    ] };
    writeJobs([job]);
    const calls: any[] = [];
    const renderMock = renderVideo as jest.Mock;
    const defaultEncode = renderMock.getMockImplementation();
    renderMock.mockImplementation(async options => {
      calls.push(options);
      if (calls.length === 2) throw new Error('Portrait encoder stopped');
      fs.writeFileSync(options.outputPath, Buffer.alloc(12000, calls.length));
      return { path: options.outputPath, bytes: 12000, args: [] };
    });
    mockedInspectRender.mockImplementation(async (_bin, file) => {
      const encoded = calls.find(options => options.outputPath === file);
      return encoded ? { ...goodFacts, width: encoded.outputVariant.width, height: encoded.outputVariant.height }
        : { ...goodFacts, hasVideo: false };
    });
    try {
      expect((await call('media_render', { job: job.id, image: scenePath, visuals: 'plain' })).success).toBe(false);
      let state = await getMediaJobExportState(job.id);
      expect(state.outputs).toHaveLength(1);
      expect(state.variantAttempts).toMatchObject({ landscape: { status: 'succeeded' }, portrait: { status: 'failed', error: expect.stringContaining('Portrait encoder stopped') } });
      const first = state.outputs[0];
      const review = readJobs().find(item => item.id === `jobexport_${first.exportId}`)!;
      expect(review).toMatchObject({ state: 'awaiting_approval', renderPath: first.moviePath, outputSpec: createStudioOutputSpec('16:9') });
      const parent = readJobs().find(item => item.id === job.id)!;
      expect(parent.state).toBe('media_production');
      const landscapeRevision = state.variantRevisions?.landscape;
      expect(landscapeRevision).toBe(first.sourceRevision);
      writeJobs(readJobs().map(item => item.id === review.id ? { ...item, state: 'approved' } : item.id === job.id
        ? { ...item, outputSpec: { ...item.outputSpec!, variants: item.outputSpec!.variants.map(v => v.id === 'portrait' ? { ...v, framing: { ...v.framing, mode: 'crop' } } : v) } } : item));
      expect((await getMediaJobExportState(job.id)).variantRevisions?.landscape).toBe(landscapeRevision);
      expect((await call('media_render', { job: job.id, variantId: 'portrait' })).success).toBe(true);
      expect(calls.map(options => options.outputVariant.id)).toEqual(['landscape', 'portrait', 'portrait']);
      state = await getMediaJobExportState(job.id);
      expect(state.outputs).toHaveLength(2);
      expect(readJobs().find(item => item.id === review.id)).toMatchObject({ state: 'approved', renderPath: first.moviePath, renderedOutput: { sha256: first.sha256 } });
      expect((await call('media_advance_job', { job: job.id, to: 'render_qa' })).success).toBe(true);
      const parentReview = await call('media_advance_job', { job: job.id, to: 'awaiting_approval' });
      expect(parentReview.success).toBe(false);
      expect(parentReview.error).toMatch(/each|separate|format/i);
      // Selecting one future output must not turn an existing per-file review
      // into a second parent approval for the same movie.
      writeJobs(readJobs().map(item => item.id === job.id ? { ...item,
        outputSpec: { ...item.outputSpec!, variants: item.outputSpec!.variants.filter(v => v.id === 'portrait') } } : item));
      const narrowedReview = await call('media_advance_job', { job: job.id, to: 'awaiting_approval' });
      expect(narrowedReview.success).toBe(false);
      expect(narrowedReview.error).toMatch(/each|separate|format/i);
    } finally { renderMock.mockReset().mockImplementation(defaultEncode); }
  });

  it('freezes audio, captions and image bytes and preserves later edits plus another job', async () => {
    const job = writeReadyJob('Frozen inputs');
    const originalAudio = fs.readFileSync(narrationPath);
    const originalCaptions = fs.readFileSync(captionsPath);
    const originalImage = fs.readFileSync(scenePath);
    const other = { ...job, id: 'other-job', title: 'Other project' };
    writeJobs([job, other]);
    mockedInspectRender.mockResolvedValue(goodFacts);
    (renderVideo as jest.Mock).mockImplementationOnce(async (options) => {
      fs.writeFileSync(narrationPath, 'later narration');
      fs.writeFileSync(captionsPath, 'later captions');
      fs.writeFileSync(scenePath, 'later artwork');
      expect(fs.readFileSync(options.audioPath)).toEqual(originalAudio);
      expect(fs.readFileSync(options.captionsPath)).toEqual(originalCaptions);
      expect(fs.readFileSync(options.imagePath)).toEqual(originalImage);
      writeJobs(readJobs().map(item => item.id === job.id ? { ...item, title: 'Later saved title' } : { ...item, brief: 'Other edit' }));
      fs.writeFileSync(options.outputPath, Buffer.alloc(12_000, 1));
      return { path: options.outputPath, bytes: 12_000, args: [] };
    });
    expect((await call('media_render', { job: job.id, image: scenePath })).success).toBe(true);
    expect(readJobs()[0].title).toBe('Later saved title');
    expect(readJobs()[1].brief).toBe('Other edit');
    const state = await getMediaJobExportState(job.id);
    expect(state.outputs[0].sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(state.sourceRevision).not.toBe(state.outputs[0].sourceRevision);
  });

  it('persists early and encoder failures without losing an earlier success', async () => {
    const job = writeReadyJob('Early failure');
    mockedInspectRender.mockResolvedValue(goodFacts);
    await call('media_render', { job: job.id, visuals: 'plain' });
    const good = readJobs()[0];
    await call('media_advance_job', { job: job.id, to: 'needs_revision' });
    await call('media_advance_job', { job: job.id, to: 'media_production' });
    (renderVideo as jest.Mock).mockRejectedValueOnce(new Error('Encoder stopped'));
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(false);
    expect(readJobs()[0]).toMatchObject({ renderPath: good.renderPath, latestExportAttempt: { status: 'failed', error: expect.stringContaining('Encoder stopped') } });
    fs.unlinkSync(narrationPath);
    expect((await call('media_render', { job: job.id })).success).toBe(false);
    expect(readJobs()[0]).toMatchObject({ renderPath: good.renderPath, latestExportAttempt: { status: 'failed', error: expect.stringContaining('no narration') } });
  });

  it('recovers a saved interrupted attempt once without starting another render', () => {
    const job = writeReadyJob('Restart recovery');
    writeJobs([{ ...job, renderPath: 'existing-good.mp4', latestExportAttempt: {
      id: 'stopped-attempt', status: 'rendering', sourceRevision: null, startedAt: '2026-09-13T00:00:00Z' } }]);
    const renderCount = (renderVideo as jest.Mock).mock.calls.length;
    const first = readJobs()[0];
    expect(first).toMatchObject({ renderPath: 'existing-good.mp4', latestExportAttempt: { status: 'interrupted' } });
    expect(readJobs()[0].latestExportAttempt).toEqual(first.latestExportAttempt);
    expect(renderVideo).toHaveBeenCalledTimes(renderCount);
  });

  it('does not claim a script revision for old narration and refuses a known mismatched script', async () => {
    const job = writeReadyJob('Script provenance');
    writeJobs([{ ...job, script: 'Original words' }]);
    mockedInspectRender.mockResolvedValue(goodFacts);
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(true);
    expect((await getMediaJobExportState(job.id)).sourceRevision).toBeNull();
    writeJobs([{ ...readJobs()[0], state: 'media_production', narrationScriptHash: mediaScriptDigest('Original words'), script: 'Changed words' }]);
    const result = await call('media_render', { job: job.id, visuals: 'plain' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/script changed/i);
  });

  it('keeps the last successful movie selected when its replacement fails QA', async () => {
    const job = writeReadyJob('Previous success stays selected');
    mockedInspectRender.mockResolvedValue({ hasVideo: true, hasAudio: true, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null });
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(true);
    const good = readJobs()[0];
    const goodBytes = fs.readFileSync(good.renderPath!);
    expect((await call('media_advance_job', { job: job.id, to: 'needs_revision' })).success).toBe(true);
    expect((await call('media_advance_job', { job: job.id, to: 'media_production' })).success).toBe(true);
    mockedInspectRender.mockResolvedValue({ hasVideo: true, hasAudio: false, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: null, maxVolumeDb: null, frameSamples: null });
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(false);
    const failed = readJobs()[0] as any;
    expect(fs.readFileSync(good.renderPath!).equals(goodBytes)).toBe(true);
    expect(failed.renderPath).toBe(good.renderPath);
    expect(failed.rejectedRenderPath).not.toBe(good.renderPath);
    expect(fs.existsSync(failed.rejectedRenderPath)).toBe(true);
    expect(failed.latestExportAttempt).toMatchObject({ status: 'failed', error: expect.stringMatching(/audio/i) });
    expect((await call('media_advance_job', { job: job.id, to: 'awaiting_approval' })).success).toBe(false);
  });

  it('retries unchanged scenes from saved plates without another generator call', async () => {
    const job = writeReadyJob('Reuse scene inputs');
    (generateSceneImages as jest.Mock).mockResolvedValueOnce([{ index: 0, path: scenePath }]);
    mockedInspectRender.mockResolvedValue(goodFacts);
    expect((await call('media_render', { job: job.id })).success).toBe(true);
    const first = readJobs()[0];
    const calls = (generateSceneImages as jest.Mock).mock.calls.length;
    await call('media_advance_job', { job: job.id, to: 'needs_revision' });
    await call('media_advance_job', { job: job.id, to: 'media_production' });
    expect((await call('media_render', { job: job.id })).success).toBe(true);
    expect(generateSceneImages).toHaveBeenCalledTimes(calls);
    expect(readJobs()[0].renderedOutput?.sourceRevision).toBe(first.renderedOutput?.sourceRevision);
    expect(readJobs()[0].scenePaths![0]).not.toBe(first.scenePaths![0]);
    expect(fs.readFileSync(readJobs()[0].scenePaths![0]!)).toEqual(fs.readFileSync(first.scenePaths![0]!));
    expect((await getMediaJobExportState(job.id)).outputs).toHaveLength(2);
  });

  it('keeps the saved music choice on retry and snapshots its bytes', async () => {
    const job = writeReadyJob('Saved music');
    const music = path.join(testRoot, 'music.wav');
    fs.writeFileSync(music, 'chosen track');
    writeJobs([{ ...job, renderInputs: { imagePath: null, scenePaths: [], musicPath: music, zoom: true, visuals: 'plain' } }]);
    mockedInspectRender.mockResolvedValue(goodFacts);
    expect((await call('media_render', { job: job.id })).success).toBe(true);
    const options = (renderVideo as jest.Mock).mock.calls.at(-1)![0];
    expect(options.musicPath).not.toBe(music);
    expect(fs.readFileSync(options.musicPath, 'utf8')).toBe('chosen track');
    expect(readJobs()[0].renderInputs?.musicPath).toBe(music);
  });

  it('keeps the good pointer when writing the new export record fails', async () => {
    const job = writeReadyJob('Record write failure');
    mockedInspectRender.mockResolvedValue(goodFacts);
    await call('media_render', { job: job.id, visuals: 'plain' });
    const good = readJobs()[0];
    await call('media_advance_job', { job: job.id, to: 'needs_revision' });
    await call('media_advance_job', { job: job.id, to: 'media_production' });
    const originalWrite = fs.writeFileSync;
    const write = jest.spyOn(require('fs') as typeof fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (String(file).endsWith('.mp4.json')) throw new Error('Export record disk write failed');
      return originalWrite(file, ...args);
    });
    try {
      const result = await call('media_render', { job: job.id, visuals: 'plain' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/record disk write failed/);
      expect(readJobs()[0]).toMatchObject({ renderPath: good.renderPath, latestExportAttempt: { status: 'failed' } });
      expect(fs.existsSync(good.renderPath!)).toBe(true);
    } finally { write.mockRestore(); }
  });

  it('does not recreate a job removed while encoding finishes', async () => {
    const job = writeReadyJob('Removed while rendering');
    mockedInspectRender.mockResolvedValue(goodFacts);
    (renderVideo as jest.Mock).mockImplementationOnce(async ({ outputPath }) => {
      writeJobs([]);
      fs.writeFileSync(outputPath, Buffer.alloc(12_000, 1));
      return { path: outputPath, bytes: 12_000, args: [] };
    });
    const result = await call('media_render', { job: job.id, visuals: 'plain' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/removed while rendering/);
    expect(readJobs()).toEqual([]);
    expect(fs.readdirSync(path.join(testRoot, 'media-assets', job.id)).filter(file => /^video-legacy-.*\.mp4$/.test(file))).toHaveLength(1);
  });

  it('uses measured fractional narration length and rejects an encoder tail beyond it', async () => {
    const job = writeReadyJob('Fractional narration');
    writeJobs([{ ...job, outputSpec: createStudioOutputSpec(), burnSubtitles: false }]);
    mockedInspectRender.mockResolvedValueOnce({ hasVideo: false, hasAudio: true, width: null, height: null,
      durationSeconds: 3.49, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null });
    mockedInspectRender.mockResolvedValueOnce({ hasVideo: true, hasAudio: true, width: 1920, height: 1080,
      durationSeconds: 4.6, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null });
    const result = await call('media_render', { job: job.id, visuals: 'solid' });
    expect(renderVideo).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: 3.49 }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/duration|narration/i);
    expect(readJobs()[0].state).toBe('needs_revision');
  });

  it('persists a landscape format on a short job and inspects the requested dimensions', async () => {
    const job = writeReadyJob('Short landscape');
    const outputSpec = createStudioOutputSpec('16:9', 'short', '720p');
    expect((await call('media_set_output', { job: job.id, outputSpec })).success).toBe(true);
    expect(readJobs()[0]).toMatchObject({ outputSpec, format: 'short', narrationPath });
    mockedInspectRender.mockResolvedValue({ hasVideo: true, hasAudio: true, width: 1280, height: 720,
      durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null });
    const result = await call('media_render', { job: job.id, visuals: 'solid' });
    expect(result.success).toBe(true);
    expect(renderVideo).toHaveBeenLastCalledWith(expect.objectContaining({ outputVariant: outputSpec.variants[0] }));
    const saved = readJobs()[0];
    expect(saved.renderPath).toMatch(/video-landscape-[\w-]+\.mp4$/);
    expect(saved.renderedOutput).toMatchObject({ outputSpec, durationSeconds: 3 });
    expect(JSON.parse(fs.readFileSync(`${saved.renderPath}.json`, 'utf8'))).toEqual(saved.renderedOutput);
  });

  it.each([
    { externalRenderer: 'ancient-pathways' },
    { history: [{ note: 'Showrunner runs its own stages internally' }] },
  ])('does not claim control over an external renderer: %j', async external => {
    const job = writeReadyJob('External production');
    writeJobs([{ ...job, ...external } as MediaJob]);
    const result = await call('media_set_output', { job: job.id, burnSubtitles: false });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/controlled by Ancient Pathways/);
    expect(readJobs()[0].burnSubtitles).toBeUndefined();
  });

  it('defaults new jobs to captions off and persists a deliberate choice without touching audio', async () => {
    expect((createJob({ title: 'New production' }) as any).burnSubtitles).toBe(false);
    const job = writeReadyJob('Caption preference');
    const result = await call('media_set_output', { job: job.id, burnSubtitles: false });
    expect(result.success).toBe(true);
    expect(readJobs()[0]).toMatchObject({ burnSubtitles: false, narrationPath, captionsPath, state: 'media_production' });
    const invalid = await call('media_set_output', { job: job.id, burnSubtitles: 'false' });
    expect(invalid.success).toBe(false);
    expect((readJobs()[0] as any).burnSubtitles).toBe(false);
  });

  it('allows intentional no-caption output without an SRT while retaining audio and picture QA', async () => {
    const job = writeReadyJob('No captions');
    writeJobs([{ ...job, burnSubtitles: false } as any]);
    fs.unlinkSync(captionsPath);
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true, hasAudio: true, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null,
    });
    expect((await call('media_render', { job: job.id, visuals: 'plain' })).success).toBe(true);
    expect(renderVideo).toHaveBeenLastCalledWith(expect.objectContaining({ captionsPath: null }));
    expect(readJobs()[0].state).toBe('render_qa');
  });

  it('does not burn a retained timing SRT when captions are off', async () => {
    const job = writeReadyJob('Retain cue timing');
    writeJobs([{ ...job, burnSubtitles: false } as any]);
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true, hasAudio: true, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null,
    });
    await call('media_render', { job: job.id, visuals: 'plain' });
    expect(renderVideo).toHaveBeenLastCalledWith(expect.objectContaining({ captionsPath: null }));
    expect(fs.readFileSync(captionsPath, 'utf8')).toContain('Hello');
  });

  it('still builds scene images and their timing from cues when burn-in is off', async () => {
    const job = writeReadyJob('Cue-driven scenes without captions');
    writeJobs([{ ...job, burnSubtitles: false }]);
    (generateSceneImages as jest.Mock).mockImplementationOnce(async ({ outDir }) => {
      fs.mkdirSync(outDir, { recursive: true });
      return [{ path: scenePath }];
    });
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true, hasAudio: true, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null,
    });
    const result = await call('media_render', { job: job.id, visuals: 'scenes' });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(generateSceneImages).toHaveBeenLastCalledWith(expect.objectContaining({
      scenes: [expect.objectContaining({ text: 'Hello' })],
    }));
    const render = (renderVideo as jest.Mock).mock.calls.at(-1)![0];
    expect(render.captionsPath).toBeNull();
    expect(fs.readFileSync(render.concatPath, 'utf8')).toContain('duration 3.000');
  });

  it('rejects output changes and duplicate renders while a job is rendering, then releases the lock', async () => {
    const job = writeReadyJob('Output snapshot');
    let releaseQa!: (facts: any) => void;
    let reachedQa!: () => void;
    const atQa = new Promise<void>(resolve => { reachedQa = resolve; });
    mockedInspectRender.mockImplementationOnce(() => {
      reachedQa();
      return new Promise(resolve => { releaseQa = resolve; });
    });
    const rendering = call('media_render', { job: job.id, visuals: 'plain' });
    await atQa;
    try {
      const changed = await call('media_set_output', { job: job.id, burnSubtitles: false });
      expect(changed.success).toBe(false);
      expect(changed.error).toMatch(/rendering/i);
      const duplicate = await call('media_render', { job: job.id, visuals: 'plain' });
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toMatch(/rendering/i);
    } finally {
      releaseQa({ hasVideo: true, hasAudio: false, width: 1080, height: 1920,
        durationSeconds: 3, meanVolumeDb: null, maxVolumeDb: null, frameSamples: null });
      await rendering;
    }
    expect((await call('media_set_output', { job: job.id, burnSubtitles: false })).success).toBe(true);
  });

  it('refuses to silently change the output choice of an approved master', async () => {
    const job = writeReadyJob('Approved master');
    writeJobs([{ ...job, state: 'approved' }]);
    expect((await call('media_set_output', { job: job.id, burnSubtitles: false })).success).toBe(false);
    expect(readJobs()[0].state).toBe('approved');
    expect((readJobs()[0] as any).burnSubtitles).toBeUndefined();
  });

  it('still rejects a caption-enabled movie with a missing SRT', async () => {
    const job = writeReadyJob('Captions required');
    writeJobs([{ ...job, burnSubtitles: true }]);
    fs.unlinkSync(captionsPath);
    mockedInspectRender.mockResolvedValueOnce({
      hasVideo: true, hasAudio: true, width: 1080, height: 1920,
      durationSeconds: 3, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null,
    });
    const result = await call('media_render', { job: job.id, visuals: 'plain' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/caption/i);
    expect(readJobs()[0].state).toBe('needs_revision');
  });

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
    expect(persisted.renderPath).toBeUndefined();
    expect(persisted.rejectedRenderPath).toMatch(/video-[\w-]+\.rejected\.mp4$/);
    expect(fs.statSync(persisted.rejectedRenderPath!).size).toBe(12_000);
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
    expect(persisted.renderPath).toBeUndefined();
    expect(fs.statSync(persisted.rejectedRenderPath!).size).toBe(12_000);
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
    expect(persisted.renderPath).toBeUndefined();
    expect(persisted.rejectedRenderPath).toMatch(/video-[\w-]+\.rejected\.mp4$/);
    expect(fs.statSync(persisted.rejectedRenderPath!).size).toBe(12_000);
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
    expect(persisted.renderPath).toMatch(/video-legacy-[\w-]+\.mp4$/);
    expect(fs.existsSync(persisted.renderPath!)).toBe(true);
    expect(persisted.narrationPath).toBe(narrationPath);
    expect(persisted.captionsPath).toBe(captionsPath);
    expect(persisted.scenePaths).toEqual([]); // Plain output must not display obsolete plates.
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
    expect(persisted.renderPath).toBeUndefined();
    expect(fs.statSync(persisted.rejectedRenderPath!).size).toBe(12_000);
  });
});
