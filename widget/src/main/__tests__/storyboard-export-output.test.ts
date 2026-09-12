import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { findFfmpeg } from '../media-render';
import { findManagedFfmpeg } from '../ffmpeg-setup';
import { inspectRender, RenderFacts } from '../media-qa';
import { renderNarrationToFile } from '../tools/voice';
import { renderStoryboardMovie, ShotManifest } from '../movie/storyboard-renderer';

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

  const save = () => fs.writeFileSync(path.join(scene, 'manifest.json'), JSON.stringify(shots));
  const render = () => renderStoryboardMovie({ projectId: 'export-check', motion: false });

  beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-export-contract-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
    scene = path.join(root, 'export-check', 'scenes', 'scene_01');
    fs.mkdirSync(scene, { recursive: true });
    output = path.join(root, 'export-check', 'renders', 'export-check-1080p.mp4');
    shots = [1, 2].map(n => {
      const frame = path.join(scene, `frame-${n}.png`);
      fs.writeFileSync(frame, `frame fixture ${n}`);
      return {
        shotId: `shot_00${n}`, order: n, prompt: `Scene ${n}`, framing: 'wide',
        lens: '24mm', movement: 'static', durationSec: 3,
        narration: `Narration ${n}`, status: 'IMAGE_GENERATED', frameImagePath: frame,
      };
    });
    save();
    speechPaths = [];
    movieFacts = {
      hasVideo: true, hasAudio: true, width: 1920, height: 1080,
      durationSeconds: 6, meanVolumeDb: -21, maxVolumeDb: -3,
      frameSamples: null,
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
});
