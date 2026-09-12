import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { findFfmpeg } from '../media-render';
import { findManagedFfmpeg } from '../ffmpeg-setup';
import { inspectRender, RenderFacts } from '../media-qa';
import { renderNarrationToFile } from '../tools/voice';
import { renderStoryboardMovie, ShotManifest } from '../movie/storyboard-renderer';
import { mediaGetStoryboardHandler, mediaListStoryboardsHandler, mediaSaveStoryboardHandler } from '../tools/media-storyboard';

jest.mock('../media-render', () => ({
  ...jest.requireActual('../media-render'), findFfmpeg: jest.fn(),
}));
jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: jest.fn() }));
jest.mock('../media-qa', () => ({
  ...jest.requireActual('../media-qa'), inspectRender: jest.fn(),
}));
jest.mock('../tools/voice', () => ({ renderNarrationToFile: jest.fn() }));
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
        narration: `Narration ${n}`, status: 'IMAGE_GENERATED', frameImagePath: frame, frameStale: false,
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
    expect(result.ok).toBe(true);
    expect(findFfmpeg).toHaveBeenCalledWith('/managed/ffmpeg');
    expect(new Set(speechPaths).size).toBe(2);
    const inputs = (execFile as unknown as jest.Mock).mock.calls.flatMap(([, args]) =>
      args.flatMap((arg: string, index: number) => arg === '-i' ? [args[index + 1]] : []));
    for (const actual of speechPaths) expect(inputs).toContain(actual);
    expect(result.durationSec).toBe(movieFacts.durationSeconds);
    expect(fs.readFileSync(output, 'utf8')).toBe('controlled encoder bytes');
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
  ] as Array<[string, Partial<RenderFacts>]>)('rejects %s and retains the previous export', async (_name, facts) => {
    movieFacts = { ...movieFacts, ...facts };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'previous valid export');
    const result = await render();
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(output, 'utf8')).toBe('previous valid export');
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
    expect(fs.existsSync(output)).toBe(true);
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
});
