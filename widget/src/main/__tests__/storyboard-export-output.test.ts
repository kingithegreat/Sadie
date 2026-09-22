import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { findFfmpeg } from '../media-render';
import { findManagedFfmpeg } from '../ffmpeg-setup';
import { inspectRender, RenderFacts } from '../media-qa';
import { renderNarrationToFile } from '../tools/voice';
import { renderStoryboardMovie, ShotManifest } from '../movie/storyboard-renderer';
import { mediaGetStoryboardHandler, mediaListStoryboardsHandler, mediaSaveStoryboardHandler, mediaRenderStoryboardHandler } from '../tools/media-storyboard';
import { readJobs, writeJobs } from '../tools/media';
import { createStudioOutputSpec } from '../../shared/media-output';

// Unit adapters must not implicitly depend on a downloaded Electron binary.
// CI installs it later for the real renderer tests; the local install hid this.
jest.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => { throw new Error('Provider image decoding is outside this render-adapter unit suite.'); } },
}));
jest.mock('../config-manager', () => ({ getSettings: jest.fn(() => ({ narrationEngine: 'edge' })) }));

jest.mock('../media-render', () => ({
  ...jest.requireActual('../media-render'), findFfmpeg: jest.fn(),
}));
jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: jest.fn() }));
jest.mock('../media-qa', () => ({
  ...jest.requireActual('../media-qa'), inspectRender: jest.fn(),
}));
jest.mock('../tools/voice', () => ({ renderNarrationToFile: jest.fn() }));
jest.mock('../tools/media', () => ({ readJobs: jest.fn(), writeJobs: jest.fn() }));
jest.mock('child_process', () => ({ execFile: jest.fn() }));

describe('storyboard export output contract', () => {
  let root: string;
  let scene: string;
  let output: string;
  let shots: ShotManifest[];
  let speechPaths: string[];
  let movieFacts: RenderFacts;
  let speechFacts: RenderFacts;
  const priorRoot = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;

  const save = () => {
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId: 'scene_01', shots: shots.map(shot => shot.shotId) }));
    for (const shot of shots) {
      const shotDir = path.join(scene, shot.shotId);
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify(shot));
      fs.writeFileSync(path.join(shotDir, 'script.txt'), shot.narration || '');
      const frame = path.join(shotDir, 'image', 'frame.png');
      if (!shot.frameImagePath && fs.existsSync(frame)) fs.unlinkSync(frame);
    }
  };
  const render = () => renderStoryboardMovie({ projectId: 'export-check', motion: false });

  beforeEach(() => {
    jest.clearAllMocks();
    (readJobs as jest.Mock).mockReturnValue([]);
    (writeJobs as jest.Mock).mockReset();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-export-contract-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
    scene = path.join(root, 'export-check', 'scenes', 'scene_01');
    fs.mkdirSync(scene, { recursive: true });
    output = path.join(root, 'export-check', 'renders', 'export-check-1080p.mp4');
    shots = [1, 2].map(n => {
      const frame = path.join(scene, `shot_00${n}`, 'image', 'frame.png');
      fs.mkdirSync(path.dirname(frame), { recursive: true });
      fs.writeFileSync(frame, `frame fixture ${n}`);
      return {
        shotId: `shot_00${n}`, order: n, prompt: `Scene ${n}`, framing: 'wide',
        lens: '24mm', movement: 'static', durationSec: 3,
        narration: `Narration ${n}`, status: 'IMAGE_GENERATED', frameImagePath: frame, videoClipPath: null, frameStale: false,
      };
    });
    save();
    speechPaths = [];
    movieFacts = {
      hasVideo: true, hasAudio: true, width: 1920, height: 1080,
      durationSeconds: 6, meanVolumeDb: -21, maxVolumeDb: -3, frameSamples: null,
    };
    speechFacts = { ...movieFacts, hasVideo: false, width: null, height: null, durationSeconds: 1 };
    (findManagedFfmpeg as jest.Mock).mockReturnValue('/managed/ffmpeg');
    (findFfmpeg as jest.Mock).mockResolvedValue('/managed/ffmpeg');
    (renderNarrationToFile as jest.Mock).mockImplementation(async (_text: string, requested: string) => {
      // Both real speech adapters may return a different basename/extension.
      const actual = path.join(path.dirname(requested), 'narration.wav');
      fs.mkdirSync(path.dirname(actual), { recursive: true });
      fs.writeFileSync(actual, 'controlled speech bytes');
      speechPaths.push(actual);
      return { path: actual, bytes: fs.statSync(actual).size, engine: 'kokoro' };
    });
    (inspectRender as jest.Mock).mockImplementation(async (_bin: string, file: string) =>
      file.endsWith('.mp4') ? movieFacts : speechFacts);
    (execFile as unknown as jest.Mock).mockImplementation((_bin, args, _options, callback) => {
      const target = args[args.length - 1];
      if (typeof target === 'string' && /\.(mp4|mp3|wav)$/.test(target)) {
        fs.writeFileSync(target, 'controlled encoder bytes');
      }
      callback(null, '', '');
    });
  });

  afterEach(() => {
    if (priorRoot === undefined) delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
    else process.env.HOMEBOT_MOVIE_PROJECTS_DIR = priorRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('uses the managed video engine and the distinct speech files actually returned', async () => {
    const result = await render();
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true });
    expect(findFfmpeg).toHaveBeenCalledWith('/managed/ffmpeg');
    expect(new Set(speechPaths).size).toBe(2);
    const inputs = (execFile as unknown as jest.Mock).mock.calls.flatMap(([, args]) =>
      args.flatMap((arg: string, index: number) => arg === '-i' ? [args[index + 1]] : []));
    for (const actual of speechPaths) expect(inputs).toContain(actual);
    expect(result.durationSec).toBe(movieFacts.durationSeconds);
    expect(fs.readFileSync(result.moviePath!, 'utf8')).toBe('controlled encoder bytes');
  });

  test('renders explicit landscape and portrait movies while preparing narration only once', async () => {
    const outputSpec = { ...createStudioOutputSpec('16:9'), variants: [
      createStudioOutputSpec('16:9').variants[0], createStudioOutputSpec('9:16').variants[0],
    ] };
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ projectId: 'export-check', outputSpec, burnSubtitles: false }));
    let checkedMovies = 0;
    (inspectRender as jest.Mock).mockImplementation(async (_bin: string, file: string) => {
      if (!file.endsWith('.mp4')) return speechFacts;
      checkedMovies++;
      return checkedMovies === 1 ? movieFacts : { ...movieFacts, width: 1080, height: 1920 };
    });
    const result = await render() as any;
    expect(result.ok).toBe(true);
    expect(result.variants).toHaveLength(2);
    expect(result.variants.map((item: any) => item.renderedOutput.outputSpec.variants[0].id)).toEqual(['landscape', 'portrait']);
    expect(new Set(result.variants.map((item: any) => item.moviePath)).size).toBe(2);
    expect(renderNarrationToFile).toHaveBeenCalledTimes(2); // two shots, not four variant-dependent calls
    expect(checkedMovies).toBe(2);
    for (const item of result.variants) {
      expect(item.ok).toBe(true);
      expect(fs.existsSync(item.moviePath)).toBe(true);
      expect(item.renderedOutput.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('tracks the saved source revision without inventing a change on a no-op save', async () => {
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ projectId: 'export-check', outputSpec: createStudioOutputSpec(), burnSubtitles: false }));
    const read = async () => (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    const before = await read();
    expect(before.exportState?.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    // Match the saved/default motion intent; an explicit no-motion override is a different source.
    const first = await renderStoryboardMovie({ projectId: 'export-check' });
    expect(first.ok).toBe(true);
    expect((first.renderedOutput as any)?.sourceRevision).toBe(before.exportState.sourceRevision);
    expect((await read()).exportState.latestAttempt).toMatchObject({ status: 'succeeded', exportId: first.renderedOutput?.exportId });
    expect((await mediaSaveStoryboardHandler({ projectId: 'export-check', shots, outputSpec: createStudioOutputSpec(), burnSubtitles: false }, {} as any)).success).toBe(true);
    expect((await read()).exportState.sourceRevision).toBe(before.exportState.sourceRevision);
    shots[0].prompt = 'A deliberately changed source prompt';
    expect((await mediaSaveStoryboardHandler({ projectId: 'export-check', shots }, {} as any)).success).toBe(true);
    const changed = await read();
    expect(changed.exportState.sourceRevision).not.toBe(before.exportState.sourceRevision);
    expect(changed.renderedMoviePath).toBe(first.moviePath);
  });

  test('keeps a successful batch review and retries only the failed format using verified cached speech', async () => {
    const outputSpec = { ...createStudioOutputSpec('16:9'), variants: [
      createStudioOutputSpec('16:9').variants[0], createStudioOutputSpec('9:16').variants[0],
    ] };
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ projectId: 'export-check', outputSpec, burnSubtitles: false }));
    const stored: any[] = [];
    (readJobs as jest.Mock).mockImplementation(() => stored);
    (writeJobs as jest.Mock).mockImplementation(jobs => stored.splice(0, stored.length, ...jobs));
    let movies = 0;
    (inspectRender as jest.Mock).mockImplementation(async (_bin: string, file: string) => {
      if (!file.endsWith('.mp4')) return speechFacts;
      movies++;
      // Portrait's first encode is genuinely rejected by the unchanged geometry QA.
      return movies < 3 ? movieFacts : { ...movieFacts, width: 1080, height: 1920 };
    });
    const first = await mediaRenderStoryboardHandler({ projectId: 'export-check', motion: false }, {} as any);
    expect(first.success).toBe(false);
    expect(first.result.variants).toHaveLength(2);
    expect(stored).toHaveLength(1);
    const review = { ...stored[0], state: 'approved' };
    stored[0] = review;
    const retry = await mediaRenderStoryboardHandler({ projectId: 'export-check', variantId: 'portrait', motion: false }, {} as any);
    expect(retry.success).toBe(true);
    expect(movies).toBe(3);
    expect(renderNarrationToFile).toHaveBeenCalledTimes(2);
    expect(stored).toHaveLength(2);
    expect(stored.find(item => item.id === review.id)).toEqual(review);
    expect(stored[1].renderPath).not.toBe(review.renderPath);
    expect(stored[1].outputSpec.variants[0].id).toBe('portrait');
  });

  test('a shared preparation failure leaves both formats retryable after reopening', async () => {
    const outputSpec = { ...createStudioOutputSpec(), variants: [createStudioOutputSpec().variants[0], createStudioOutputSpec('9:16').variants[0]] };
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ outputSpec, burnSubtitles: false }));
    (findFfmpeg as jest.Mock).mockResolvedValue(null);
    expect((await render()).ok).toBe(false);
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState.variantAttempts).toMatchObject({ landscape: { status: 'failed' }, portrait: { status: 'failed' } });
    expect(renderNarrationToFile).not.toHaveBeenCalled();
  });

  test('malformed per-format attempt fields never reach the renderer as objects', async () => {
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ outputSpec: createStudioOutputSpec(),
      variantExportAttempts: { landscape: { id: 'bad-note', variantId: 'landscape', status: 'failed',
        startedAt: '2026-09-13T00:00:00Z', sourceRevision: null, error: { injected: 'not display text' } } } }));
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState.variantAttempts.landscape?.error).toBeUndefined();
  });

  test('changed cached audio cannot be reused and output-only changes do reuse verified speech', async () => {
    expect((await render()).ok).toBe(true);
    expect(renderNarrationToFile).toHaveBeenCalledTimes(2);
    expect((await renderStoryboardMovie({ projectId: 'export-check', burnSubtitles: false, motion: false })).ok).toBe(true);
    expect(renderNarrationToFile).toHaveBeenCalledTimes(2);
    const cacheDir = path.join(root, 'export-check', 'renders', '.homebot-narration');
    const cacheRecords = fs.readdirSync(cacheDir).filter(name => name.endsWith('.json'));
    expect(cacheRecords).toHaveLength(2);
    const record = JSON.parse(fs.readFileSync(path.join(cacheDir, cacheRecords[0]), 'utf8'));
    fs.writeFileSync(path.join(cacheDir, record.filename), 'changed cached bytes');
    expect((await render()).ok).toBe(true);
    expect(renderNarrationToFile).toHaveBeenCalledTimes(3);
  });

  test.each(['square', '__proto__', null])('an unavailable retry format %s fails before narration or encoding', async variantId => {
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ outputSpec: createStudioOutputSpec() }));
    const result = await renderStoryboardMovie({ projectId: 'export-check', variantId } as any);
    expect(result.ok).toBe(false);
    expect(renderNarrationToFile).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  test('persists a failed latest attempt separately from successful export history', async () => {
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ projectId: 'export-check', outputSpec: createStudioOutputSpec(), burnSubtitles: false }));
    const first = await render();
    const second = await render();
    expect(first.ok && second.ok).toBe(true);
    movieFacts.width = 640;
    expect((await render()).ok).toBe(false);
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState?.latestAttempt).toMatchObject({ status: 'failed', error: expect.stringMatching(/picture size|match the storyboard/i) });
    expect(reopened.renderedMoviePath).toBe(second.moviePath);
    expect(reopened.exportState.outputs.map((item: any) => item.exportId)).toEqual(expect.arrayContaining([first.renderedOutput!.exportId, second.renderedOutput!.exportId]));
    expect(fs.readFileSync(first.moviePath!, 'utf8')).toBe('controlled encoder bytes');
  });

  test('detects changed source image bytes and recovers an interrupted attempt on reopen', async () => {
    const metaPath = path.join(root, 'export-check', 'project.json');
    fs.writeFileSync(metaPath, JSON.stringify({ projectId: 'export-check', outputSpec: createStudioOutputSpec(), burnSubtitles: false }));
    const first = await render();
    expect(first.ok).toBe(true);
    const previousRevision = (first.renderedOutput as any)?.sourceRevision;
    expect(previousRevision).toMatch(/^[a-f0-9]{64}$/);
    fs.writeFileSync(shots[0].frameImagePath!, 'different source pixels');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.latestExportAttempt = { id: 'interrupted-fixture', status: 'rendering', sourceRevision: previousRevision, startedAt: new Date().toISOString() };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState.sourceRevision).not.toBe(previousRevision);
    expect(reopened.exportState.latestAttempt.status).toBe('interrupted');
    expect(JSON.parse(fs.readFileSync(metaPath, 'utf8')).latestExportAttempt.status).toBe('interrupted');
    expect(reopened.renderedMoviePath).toBe(first.moviePath);
  });

  test('saved captions off reaches export without a caller override and survives reopening', async () => {
    const metaPath = path.join(root, 'export-check', 'project.json');
    fs.writeFileSync(metaPath, JSON.stringify({ projectId: 'export-check', notes: 'keep this', burnSubtitles: true }));
    const saved = await mediaSaveStoryboardHandler({ projectId: 'export-check', shots, burnSubtitles: false }, {} as any);
    expect(saved.success).toBe(true);
    const reopened = await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any);
    expect(reopened.result.project).toMatchObject({ burnSubtitles: false, notes: 'keep this' });
    const result = await mediaRenderStoryboardHandler({ projectId: 'export-check', motion: false }, {} as any);
    expect(result.success).toBe(true);
    const commands = (execFile as unknown as jest.Mock).mock.calls.map(([, args]) => args.join(' '));
    expect(commands.some(command => command.includes('subtitles='))).toBe(false);
    expect(readJobs).toHaveBeenCalled();
    expect(writeJobs).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ burnSubtitles: false })]));
  });

  test('new legacy exports preserve the fixed-name master and its approved review record', async () => {
    const approved = { id: 'sb_export-check', renderPath: output, state: 'approved', approvedBy: 'owner' };
    (readJobs as jest.Mock).mockReturnValue([approved]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'legacy approved master');
    const rendered = await mediaRenderStoryboardHandler({ projectId: 'export-check', motion: false }, {} as any);
    expect(rendered.success).toBe(true);
    expect(rendered.result.moviePath).not.toBe(output);
    expect(rendered.result.jobId).not.toBe(approved.id);
    expect((writeJobs as jest.Mock).mock.calls[0][0]).toContainEqual(approved);
    expect(fs.readFileSync(output, 'utf8')).toBe('legacy approved master');
    // The new review card must describe the actual landscape legacy movie,
    // not infer portrait just because this complete movie is under a minute.
    expect((writeJobs as jest.Mock).mock.calls[0][0].find((job: any) => job.id === rendered.result.jobId))
      .toMatchObject({ outputSpec: createStudioOutputSpec('16:9', 'short', '1080p', 'crop') });
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.renderedMoviePath).toBe(rendered.result.moviePath);
    expect(reopened.exportState.untrackedOutputs).toContainEqual({ filename: path.basename(output), moviePath: output });
    expect(reopened.exportState.outputs[0]).toMatchObject({ outputSpec: createStudioOutputSpec('16:9', 'short', '1080p', 'crop'), sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  test('an active render keeps its copied source while an edit is saved and rejects a duplicate render', async () => {
    const metaPath = path.join(root, 'export-check', 'project.json');
    fs.writeFileSync(metaPath, JSON.stringify({ outputSpec: createStudioOutputSpec(), burnSubtitles: false, updatedAt: '2026-09-12T00:00:00Z' }));
    const before = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = (renderNarrationToFile as jest.Mock).getMockImplementation()!;
    (renderNarrationToFile as jest.Mock).mockImplementationOnce(async (...args) => { entered(); await gate; return original(...args); });
    const pending = renderStoryboardMovie({ projectId: 'export-check' });
    await started;
    try {
      fs.writeFileSync(shots[0].frameImagePath!, 'edited while rendering');
      shots[0].prompt = 'Saved while exporting';
      expect((await mediaSaveStoryboardHandler({ projectId: 'export-check', shots }, {} as any)).success).toBe(true);
      const during = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
      // Speech is now an explicit shared preparation phase, before either encode.
      expect(during.exportState.latestAttempt.status).toBe('preparing');
      expect(during.exportState.sourceRevision).not.toBe(before.exportState.sourceRevision);
      const duplicate = await render();
      expect(duplicate).toMatchObject({ ok: false, error: expect.stringMatching(/already rendering/) });
      expect(JSON.parse(fs.readFileSync(metaPath, 'utf8')).latestExportAttempt.id).toBe(during.exportState.latestAttempt.id);
    } finally { release(); await pending; }
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.renderedOutput?.sourceRevision).toBe(before.exportState.sourceRevision);
    expect(result.renderedOutput?.sourceSavedAt).toBe('2026-09-12T00:00:00Z');
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.scenes[0].shots[0].prompt).toBe('Saved while exporting');
    expect(reopened.exportState.sourceRevision).not.toBe(result.renderedOutput?.sourceRevision);
  });

  test('an early engine failure is persisted and cannot remove the last good file', async () => {
    const first = await render();
    expect(first.ok).toBe(true);
    (findFfmpeg as jest.Mock).mockResolvedValue(null);
    expect((await render()).ok).toBe(false);
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState.latestAttempt).toMatchObject({ status: 'failed', error: expect.stringMatching(/FFmpeg was not found/) });
    expect(reopened.renderedMoviePath).toBe(first.moviePath);
  });

  test('an explicit motion override has different provenance from the saved default', async () => {
    const first = await render(); // Explicit motion=false, unlike the Studio default.
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(first.ok).toBe(true);
    expect(first.renderedOutput?.motion).toBe(false);
    expect(first.renderedOutput?.sourceRevision).not.toBe(reopened.exportState.sourceRevision);
  });

  test('malformed provenance stays unknown and an unreadable attempt does not crash the workspace', async () => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'older untracked movie');
    fs.writeFileSync(`${output}.json`, JSON.stringify({ filename: path.basename(output), exportId: 'old', createdAt: '2026-09-12T00:00:00Z', durationSeconds: 6 }));
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ latestExportAttempt: { status: { bad: true } } }));
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState.latestAttempt).toBeUndefined();
    expect(reopened.exportState.outputs).toEqual([]);
    expect(reopened.exportState.untrackedOutputs).toContainEqual({ filename: path.basename(output), moviePath: output });
    expect(reopened.exportState.warning).toMatch(/unreadable/);
    expect(reopened.renderedMoviePath).toBe(output);
  });

  test('an existing explicitly named export cannot be overwritten, even on a legacy project', async () => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'approved master');
    const result = await renderStoryboardMovie({ projectId: 'export-check', outputName: path.basename(output) });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Existing exports are preserved/) });
    expect(fs.readFileSync(output, 'utf8')).toBe('approved master');
    expect(renderNarrationToFile).not.toHaveBeenCalled();
  });

  test('another export claiming the requested filename during rendering is not overwritten', async () => {
    (inspectRender as jest.Mock).mockImplementation(async (_bin: string, file: string) => {
      if (!file.endsWith('.mp4')) return speechFacts;
      fs.writeFileSync(output, 'master created by another process');
      return movieFacts;
    });
    const result = await renderStoryboardMovie({ projectId: 'export-check', outputName: path.basename(output), motion: false });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(output, 'utf8')).toBe('master created by another process');
  });

  test('rejects malformed caption preferences before writing any saved shot', async () => {
    const prompt = path.join(scene, shots[0].shotId, 'prompt.json');
    const before = fs.readFileSync(prompt);
    const result = await mediaSaveStoryboardHandler({ projectId: 'export-check', shots: [{ ...shots[0], prompt: 'changed' }], burnSubtitles: 'false' }, {} as any);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(prompt)).toEqual(before);
  });

  test('saved portrait settings survive reopening, reach the encoder and preserve reviewed masters', async () => {
    const metaPath = path.join(root, 'export-check', 'project.json');
    const outputSpec = createStudioOutputSpec('9:16', 'long', '720p', 'fit');
    fs.writeFileSync(metaPath, JSON.stringify({ projectId: 'export-check', notes: 'keep this', burnSubtitles: false }));
    const approved = { id: 'sb_export-check', renderPath: output, state: 'approved', approvedBy: 'owner' };
    (readJobs as jest.Mock).mockReturnValue([approved]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'approved landscape master');
    expect((await mediaSaveStoryboardHandler({ projectId: 'export-check', shots, outputSpec }, {} as any)).success).toBe(true);
    expect((await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result.project)
      .toMatchObject({ outputSpec, burnSubtitles: false, notes: 'keep this' });
    movieFacts.width = 720;
    movieFacts.height = 1280;
    const result = await mediaRenderStoryboardHandler({ projectId: 'export-check', motion: false }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.outputSpec).toEqual(outputSpec);
    expect(result.result.moviePath).not.toBe(output);
    expect(result.result.jobId).not.toBe(approved.id);
    expect(fs.readFileSync(output, 'utf8')).toBe('approved landscape master');
    const jobs = (writeJobs as jest.Mock).mock.calls[0][0];
    expect(jobs).toContainEqual(approved);
    expect(jobs).toContainEqual(expect.objectContaining({ id: result.result.jobId, outputSpec, format: 'long', burnSubtitles: false }));
    const reopened = await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any);
    expect(reopened.result.renderedMoviePath).toBe(result.result.moviePath);
    expect(reopened.result.renderedOutput).toMatchObject({ outputSpec, burnSubtitles: false, durationSeconds: 6 });
    const commands = (execFile as unknown as jest.Mock).mock.calls.map(([, args]) => args.join(' '));
    expect(commands.some(command => command.includes('pad=720:1280:'))).toBe(true);
    expect(commands.some(command => command.includes('subtitles='))).toBe(false);
  });

  test('malformed saved formats cannot mutate shot files', async () => {
    const prompt = path.join(scene, shots[0].shotId, 'prompt.json');
    const before = fs.readFileSync(prompt);
    const result = await mediaSaveStoryboardHandler({ projectId: 'export-check', shots: [{ ...shots[0], prompt: 'changed' }], outputSpec: { schemaVersion: 99 } }, {} as any);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(prompt)).toEqual(before);
  });

  test('new exports are immutable and a failed variant retains the last successful pointer', async () => {
    const metaPath = path.join(root, 'export-check', 'project.json');
    fs.writeFileSync(metaPath, JSON.stringify({ projectId: 'export-check', outputSpec: createStudioOutputSpec(), burnSubtitles: false }));
    const first = await render();
    const second = await render();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.moviePath).not.toBe(first.moviePath);
    expect(fs.existsSync(first.moviePath!)).toBe(true);
    movieFacts.width = 640;
    expect((await render()).ok).toBe(false);
    const reopened = await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any);
    expect(reopened.result.renderedMoviePath).toBe(second.moviePath);
    expect(JSON.parse(fs.readFileSync(`${second.moviePath}.json`, 'utf8'))).toEqual(second.renderedOutput);
  });

  test('an invalid export pointer cannot escape the project render directory', async () => {
    fs.writeFileSync(path.join(root, 'export-check', 'project.json'), JSON.stringify({ latestSuccessfulOutput: { filename: '../../private.mp4' } }));
    fs.writeFileSync(path.join(root, 'private.mp4'), 'private');
    const result = await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any);
    expect(result.result.renderedMoviePath).toBeNull();
  });

  test('a narration failure cannot become a successful silent movie or replace the old export', async () => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'previous valid export');
    (renderNarrationToFile as jest.Mock).mockRejectedValue(new Error('Online is off. Choose an installed local voice.'));
    const result = await render();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/narration|voice/i);
    expect(fs.readFileSync(output, 'utf8')).toBe('previous valid export');
  });

  test.each([false, true])('a missing shot image blocks the complete export (motion=%s)', async motion => {
    shots[1].frameImagePath = null;
    save();
    const result = await renderStoryboardMovie({ projectId: 'export-check', motion });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/frame|image/i);
    expect(renderNarrationToFile).not.toHaveBeenCalled();
    expect(fs.existsSync(output)).toBe(false);
  });

  test.each([0, -3, '3', null])('rejects an invalid persisted duration: %s', async duration => {
    shots[0].durationSec = duration as number;
    save();
    expect((await render()).ok).toBe(false);
    expect(renderNarrationToFile).not.toHaveBeenCalled();
  });

  test('rejects a narration file the adapter did not write', async () => {
    (renderNarrationToFile as jest.Mock).mockResolvedValue({ path: path.join(root, 'missing.wav'), bytes: 100, engine: 'kokoro' });
    const result = await render();
    expect(result.ok).toBe(false);
    expect(fs.existsSync(output)).toBe(false);
  });

  test('asks for a longer shot instead of cutting off its narration', async () => {
    speechFacts.durationSeconds = 5;
    const result = await render();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/longer|duration|shorten/i);
    expect(fs.existsSync(output)).toBe(false);
  });

  test.each([
    ['missing duration', { durationSeconds: null }],
    ['truncated video', { durationSeconds: 2 }],
    ['wrong dimensions', { width: 640, height: 480 }],
    ['no video', { hasVideo: false }],
    ['no audio', { hasAudio: false }],
    ['silent narration', { meanVolumeDb: -91, maxVolumeDb: -91 }],
    ['unmeasured narration', { meanVolumeDb: null, maxVolumeDb: null }],
    ['flat placeholder frames', { frameSamples: [{ atSeconds: 1.5, stdDev: 0.1 }, { atSeconds: 3, stdDev: 0.4 }, { atSeconds: 4.5, stdDev: 2.9 }] }],
  ] as Array<[string, Partial<RenderFacts>]>)('rejects %s and retains the previous export', async (_name, facts) => {
    movieFacts = { ...movieFacts, ...facts };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'previous valid export');
    const result = await render();
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(output, 'utf8')).toBe('previous valid export');
  });

  test('real frame content passes the flat-frame gate, and one simple frame among real ones does not trip it', async () => {
    // Positive control: the gate must be able to pass, not just reject.
    movieFacts.frameSamples = [{ atSeconds: 1.5, stdDev: 18 }, { atSeconds: 3, stdDev: 24 }, { atSeconds: 4.5, stdDev: 15 }];
    expect((await render()).ok).toBe(true);
    // A legitimately simple frame (a title card, a dark shot) beside real art is not a placeholder.
    movieFacts.frameSamples = [{ atSeconds: 1.5, stdDev: 0.2 }, { atSeconds: 3, stdDev: 21 }, { atSeconds: 4.5, stdDev: 1.1 }];
    expect((await render()).ok).toBe(true);
  });

  test('an inspection failure stays a failed export', async () => {
    (inspectRender as jest.Mock).mockRejectedValue(new Error('decoder could not inspect media'));
    expect((await render()).ok).toBe(false);
    expect(fs.existsSync(output)).toBe(false);
  });

  test('a deliberately unnarrated storyboard can still export with its silent audio bed', async () => {
    shots.forEach(shot => { shot.narration = ''; });
    movieFacts.meanVolumeDb = -91;
    movieFacts.maxVolumeDb = -91;
    save();
    const result = await render();
    expect(result.ok).toBe(true);
    expect(renderNarrationToFile).not.toHaveBeenCalled();
    expect(fs.existsSync(result.moviePath!)).toBe(true);
  });

  test('the complete movie includes every saved scene in its declared order', async () => {
    const secondScene = path.join(path.dirname(scene), 'scene_02');
    fs.cpSync(scene, secondScene, { recursive: true });
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId: 'scene_01', order: 2, shots: shots.map(shot => shot.shotId) }));
    fs.writeFileSync(path.join(secondScene, 'scene.json'), JSON.stringify({ sceneId: 'scene_02', order: 1, shots: shots.map(shot => shot.shotId) }));
    for (const shot of shots) fs.writeFileSync(path.join(secondScene, shot.shotId, 'script.txt'), `Opening ${shot.narration}`);
    movieFacts.durationSeconds = 12;

    const saved = await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any);
    expect(saved.result.scenes.map((item: any) => item.sceneId)).toEqual(['scene_02', 'scene_01']);
    const result = await render();
    expect(result).toMatchObject({ ok: true, totalShots: 4, durationSec: 12 });
    expect((renderNarrationToFile as jest.Mock).mock.calls.map(call => call[0]))
      .toEqual(['Opening Narration 1', 'Opening Narration 2', 'Narration 1', 'Narration 2']);
  });

  test('a missing ending frame blocks the whole movie instead of exporting just its first scene', async () => {
    const ending = path.join(path.dirname(scene), 'scene_02', 'shot_001');
    fs.mkdirSync(ending, { recursive: true });
    fs.writeFileSync(path.join(ending, 'prompt.json'), JSON.stringify({ prompt: 'Ending', durationSec: 3 }));
    fs.writeFileSync(path.join(ending, 'script.txt'), 'The complete ending.');
    const result = await render();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/frame|image/i);
    expect(renderNarrationToFile).not.toHaveBeenCalled();
  });

  test('a shot removed by Save Board stays removed after reopening and export while its assets remain', async () => {
    const saved = await mediaSaveStoryboardHandler({ projectId: 'export-check', sceneId: 'scene_01', shots: [shots[1]] }, {} as any);
    expect(saved.success).toBe(true);
    const reopened = await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any);
    expect(reopened.result.scenes[0].shots.map((shot: any) => shot.shotId)).toEqual(['shot_002']);
    fs.writeFileSync(path.join(path.dirname(path.dirname(scene)), 'project.json'), JSON.stringify({ name: 'Export check' }));
    const listed = await mediaListStoryboardsHandler({}, {} as any);
    expect(listed.result.storyboards[0]).toMatchObject({ totalShots: 1, renderedFrames: 1, totalDurationSec: 3 });
    expect(fs.existsSync(shots[0].frameImagePath!)).toBe(true);
    movieFacts.durationSeconds = 3;
    expect(await render()).toMatchObject({ ok: true, totalShots: 1, durationSec: 3 });
    expect((renderNarrationToFile as jest.Mock).mock.calls.map(call => call[0])).toEqual(['Narration 2']);
  });

  test('invalid timing is rejected before Save Board changes any saved files', async () => {
    const promptPath = path.join(scene, shots[0].shotId, 'prompt.json');
    const before = fs.readFileSync(promptPath, 'utf8');
    const result = await mediaSaveStoryboardHandler({ projectId: 'export-check', shots: [{ ...shots[0], prompt: 'Must not be saved', durationSec: 0 }] }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/duration|timing/i);
    expect(fs.readFileSync(promptPath, 'utf8')).toBe(before);
  });

  test('an explicit scene export does not replace the complete-project movie', async () => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'complete project movie');
    const result = await renderStoryboardMovie({ projectId: 'export-check', sceneId: 'scene_01', motion: false });
    expect(result.ok).toBe(true);
    expect(result.moviePath).not.toBe(output);
    expect(fs.readFileSync(output, 'utf8')).toBe('complete project movie');
  });

  test('scene-only history compares the saved scene rather than the whole project revision', async () => {
    const ending = path.join(path.dirname(scene), 'scene_02');
    fs.cpSync(scene, ending, { recursive: true });
    const result = await renderStoryboardMovie({ projectId: 'export-check', sceneId: 'scene_01' });
    expect(result.ok).toBe(true);
    const reopened = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(reopened.exportState.sceneRevisions?.scene_01).toBe(result.renderedOutput?.sourceRevision);
    expect(reopened.exportState.sourceRevision).not.toBe(result.renderedOutput?.sourceRevision);
    fs.writeFileSync(path.join(ending, shots[0].shotId, 'script.txt'), 'Changed only the other scene.');
    const changed = (await mediaGetStoryboardHandler({ projectId: 'export-check' }, {} as any)).result;
    expect(changed.exportState.sceneRevisions.scene_01).toBe(result.renderedOutput?.sourceRevision);
    expect(changed.exportState.sourceRevision).not.toBe(reopened.exportState.sourceRevision);
  });

  test('an explicit scene export cannot replace the complete movie review job', async () => {
    const completeJob = { id: 'sb_export-check', renderPath: output, state: 'awaiting_approval' };
    (readJobs as jest.Mock).mockReturnValue([completeJob]);
    const result = await mediaRenderStoryboardHandler({ projectId: 'export-check', sceneId: 'scene_01', motion: false }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.jobId).not.toBe(completeJob.id);
    expect((writeJobs as jest.Mock).mock.calls[0][0]).toContainEqual(completeJob);
  });

  test('a movie saved without a review-queue record reports the partial outcome honestly', async () => {
    (writeJobs as jest.Mock).mockImplementation(() => { throw new Error('Queue disk full'); });
    const result = await mediaRenderStoryboardHandler({ projectId: 'export-check', motion: false }, {} as any);
    expect(result.success).toBe(true);
    expect(fs.existsSync(result.result.moviePath)).toBe(true);
    expect(result.result.jobId).toBeUndefined();
    expect(result.result.warning).toMatch(/review queue/i);
  });
  test('a crossfade dissolves the shots, shortens the movie and re-times the captions (MS-2)', async () => {
    (shots[0] as any).transition = 'crossfade';
    (shots[0] as any).transitionSec = 0.5;
    save();
    let srt = '';
    const previous = (execFile as unknown as jest.Mock).getMockImplementation()!;
    (execFile as unknown as jest.Mock).mockImplementation((bin, args: string[], options, callback) => {
      for (const arg of args) {
        const match = typeof arg === 'string' && arg.match(/subtitles='([^']*subtitles\.srt)'/);
        // escapeFilterPath escapes the drive colon for ffmpeg; undo that to read it.
        if (match) srt = fs.readFileSync(match[1].split('\\:').join(':'), 'utf-8');
      }
      return previous(bin, args, options, callback);
    });
    // Two 3s shots with a 0.5s dissolve make 5.5s of movie, so the duration
    // check inside the renderer has to be told the same number.
    movieFacts = { ...movieFacts, durationSeconds: 5.5 };

    const result = await render();
    expect(result.error).toBeUndefined();
    const calls = (execFile as unknown as jest.Mock).mock.calls.map(call => (call[1] as string[]).join(' '));
    const mux = calls.find(line => line.includes('xfade'))!;
    expect(mux).toContain('xfade=transition=fade:duration=0.5:offset=2.5');
    // Each voice is placed where its own shot starts, at full level.
    expect(mux).toContain('adelay=2500:all=1');
    expect(mux).toContain('amix=inputs=2:normalize=0');
    expect(mux).toContain('-t 5.5');

    // The second cue starts at 2.5s, not 3s: the words follow the pictures.
    expect(srt).toContain('00:00:02,500 --> 00:00:05,500');
  }, 30_000);

  test('a board of cuts renders exactly as before, with no transition filters', async () => {
    await render();
    const calls = (execFile as unknown as jest.Mock).mock.calls.map(call => (call[1] as string[]).join(' '));
    expect(calls.some(line => line.includes('xfade') || line.includes('adelay'))).toBe(false);
  });

  // Real text measurement (Pango) plus a render: past the 5s default under CI load (AGENTS.md).
  test('a title card on a shot is burned into the export, over the captions (MS-5)', async () => {
    (shots[0] as any).textCard = { heading: 'Chapter One: the ramps', subline: 'Giza, 2560 BC', position: 'top' };
    save();
    // The card file lives in a temp dir the render cleans up, so read it as it is used.
    const burned: string[] = [];
    const previous = (execFile as unknown as jest.Mock).getMockImplementation()!;
    (execFile as unknown as jest.Mock).mockImplementation((bin, args: string[], options, callback) => {
      for (const arg of args) {
        const match = typeof arg === 'string' && arg.match(/subtitles='([^']*text-cards\.ass)'/);
        // escapeFilterPath escapes the drive colon for ffmpeg; undo that to read it.
        if (match) burned.push(fs.readFileSync(match[1].split('\\:').join(':'), 'utf-8'));
      }
      return previous(bin, args, options, callback);
    });

    const result = await render();
    expect(result.error).toBeUndefined();
    expect(burned).not.toHaveLength(0);
    const ass = burned[0];
    expect(ass).toContain('Chapter One: the ramps');
    expect(ass).toContain('Giza, 2560 BC');
    // Shot one runs 0-3s, and a top card is alignment 8.
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:03.00');
    expect(ass).toMatch(/Style: card_top_\d+,Arial,\d+.*,8,/);

    // The captions filter comes first, so the card sits over them.
    const vf = (execFile as unknown as jest.Mock).mock.calls
      .map(call => (call[1] as string[]).join(' ')).find(line => line.includes('text-cards.ass'))!;
    expect(vf.indexOf('subtitles.srt')).toBeLessThan(vf.indexOf('text-cards.ass'));
  }, 30_000);

  test('a board with no cards renders no card file at all', async () => {
    await render();
    const args = (execFile as unknown as jest.Mock).mock.calls.map(call => (call[1] as string[]).join(' '));
    expect(args.some(line => line.includes('text-cards.ass'))).toBe(false);
  });
});
