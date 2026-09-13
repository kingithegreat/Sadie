/**
 * The Ancient Pathways bridge's job-tracking, not its Python internals.
 *
 * Two real bugs lived here, invisible to every existing test (which only
 * covers `ancient-pathways.ts`'s pure functions and refusal paths):
 *
 * 1. Both `homebot:media:ancient-pathways-run`/`-showrunner` handlers
 *    attempted a single-hop transition to `media_production`/`render_qa`
 *    that is only actually legal from `script_qa` — `idea`'s only legal
 *    next states are researching/blocked/rejected. A freshly created job
 *    (which the showrunner path always is; the episode path is too, the
 *    first time an episode is run) threw `InvalidTransitionError`, caught
 *    by the handler and returned as `ok: false`, even when the underlying
 *    Python render genuinely succeeded.
 * 2. Once past that, both handlers judged success purely by exit code plus
 *    `fs.existsSync` and transitioned straight to `render_qa` with no
 *    content check — a solid-color placeholder clip would pass.
 *
 * This mocks the Python-spawning boundary (`runEpisodePipeline`/
 * `runShowrunner`) and the ffmpeg boundary (`inspectRender`) — everything
 * else, including the real transition state machine, runs for real.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ap-ipc-'));
const JOBS = path.join(userData, 'media-jobs.json');

const handlers: Record<string, Function> = {};
const mockMainFrame = {};
const mockMainSender = { mainFrame: mockMainFrame, send: jest.fn() };
const mockMainWindow = {
  isDestroyed: jest.fn(() => false),
  webContents: mockMainSender,
};

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function) => { handlers[channel] = fn; },
    on: jest.fn(),
  },
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  app: { isPackaged: false, getPath: () => userData, getAppPath: () => userData },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

jest.mock('../window-manager', () => ({
  getMainWindow: () => mockMainWindow,
  toggleWidgetMode: jest.fn(),
  getWidgetMode: jest.fn(() => false),
}));

const mockRunEpisodePipeline = jest.fn();
const mockRunShowrunner = jest.fn();
const mockResolveAncientPathwaysDir = jest.fn();
jest.mock('../ancient-pathways', () => ({
  ...jest.requireActual('../ancient-pathways'),
  runEpisodePipeline: (...args: any[]) => mockRunEpisodePipeline(...args),
  runShowrunner: (...args: any[]) => mockRunShowrunner(...args),
  resolveAncientPathwaysDir: () => mockResolveAncientPathwaysDir(),
}));

jest.mock('../ffmpeg-setup', () => ({
  findManagedFfmpeg: jest.fn(() => 'managed-ffmpeg.exe'),
}));
jest.mock('../media-render', () => ({
  findFfmpeg: jest.fn(async () => 'mock-ffmpeg.exe'),
}));
const mockInspectRender = jest.fn();
jest.mock('../media-qa', () => ({
  ...jest.requireActual('../media-qa'),
  inspectRender: (...args: any[]) => mockInspectRender(...args),
}));

import { registerIpcHandlers } from '../ipc-handlers';
import { bundledModuleHost } from '../modules/bundled';
import { STUDIO_MODULE_ID } from '../modules/bundled/studio';

const trustedEvent = () => ({ sender: mockMainSender, senderFrame: mockMainFrame });
const readBack = () => JSON.parse(fs.readFileSync(JOBS, 'utf8'));
const ensureStudioEnabled = () => {
  const studio = bundledModuleHost.list().find(item => item.manifest.id === STUDIO_MODULE_ID);
  if (studio?.state !== 'enabled') bundledModuleHost.enable(STUDIO_MODULE_ID);
};

// Real, non-flat frame samples — a genuine picture, not a placeholder.
const REAL_FRAMES = [
  { atSeconds: 1, stdDev: 42 },
  { atSeconds: 3, stdDev: 38 },
  { atSeconds: 5, stdDev: 51 },
];
// Every sample flat — exactly the placeholder shape the gate exists to catch.
const FLAT_FRAMES = [
  { atSeconds: 1, stdDev: 0.3 },
  { atSeconds: 3, stdDev: 0.1 },
  { atSeconds: 5, stdDev: 0.2 },
];
const REAL_FACTS = (frameSamples: typeof REAL_FRAMES) => ({
  hasVideo: true, hasAudio: true, width: 1920, height: 1080,
  durationSeconds: 20, meanVolumeDb: -18, maxVolumeDb: -6, frameSamples,
});

beforeAll(() => { registerIpcHandlers(); });
beforeEach(() => {
  ensureStudioEnabled();
  fs.writeFileSync(JOBS, '[]', 'utf8');
  mockRunEpisodePipeline.mockReset();
  mockRunShowrunner.mockReset();
  mockInspectRender.mockReset();
  mockResolveAncientPathwaysDir.mockReset().mockReturnValue(userData);
});
afterEach(() => { ensureStudioEnabled(); });

describe('ancient-pathways-showrunner — fast-forward and real QA', () => {
  const run = (options: any) => handlers['homebot:media:ancient-pathways-showrunner'](trustedEvent(), options);
  const outputPath = path.join(userData, 'showrunner-output.mp4');

  beforeEach(() => { fs.writeFileSync(outputPath, 'fake mp4 bytes', 'utf8'); });

  test('a fresh job (state idea) reaches render_qa instead of throwing on an illegal transition', async () => {
    mockRunShowrunner.mockResolvedValue({ ok: true, outputPath });
    mockInspectRender.mockResolvedValue(REAL_FACTS(REAL_FRAMES));

    const res: any = await run({ prompt: 'A myth retold', duration: 20, characters: 'Imhotep', name: 'prod-1' });

    expect(res.ok).toBe(true);
    expect(res.job.state).toBe('render_qa');
    const jobs = readBack();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe('render_qa');
    expect(jobs[0].renderPath).toBe(outputPath);
  });

  test('a flat placeholder render is rejected to needs_revision, file preserved', async () => {
    mockRunShowrunner.mockResolvedValue({ ok: true, outputPath });
    mockInspectRender.mockResolvedValue(REAL_FACTS(FLAT_FRAMES));

    const res: any = await run({ prompt: 'A myth retold', duration: 20, characters: 'Imhotep', name: 'prod-2' });

    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/flat color|placeholder/i);
    expect(res.job.state).toBe('needs_revision');
    expect(res.job.renderPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  test('QA is skipped (not blocked) when ffmpeg is unavailable', async () => {
    const mediaRender = require('../media-render');
    mediaRender.findFfmpeg.mockResolvedValueOnce(null);
    mockRunShowrunner.mockResolvedValue({ ok: true, outputPath });

    const res: any = await run({ prompt: 'A myth retold', duration: 20, characters: 'Imhotep', name: 'prod-3' });

    expect(res.ok).toBe(true);
    expect(res.job.state).toBe('render_qa');
    expect(mockInspectRender).not.toHaveBeenCalled();
  });
});

describe('ancient-pathways-run — fast-forward and real QA', () => {
  const run = (episodeId: string) => handlers['homebot:media:ancient-pathways-run'](trustedEvent(), episodeId);
  const renderPath = path.join(userData, 'episode-output.mp4');

  beforeEach(() => { fs.writeFileSync(renderPath, 'fake mp4 bytes', 'utf8'); });

  test('a brand-new episode job (state idea) reaches render_qa instead of throwing', async () => {
    mockRunEpisodePipeline.mockResolvedValue({ ok: true, renderPath });
    mockInspectRender.mockResolvedValue(REAL_FACTS(REAL_FRAMES));

    const res: any = await run('egypt');

    expect(res.ok).toBe(true);
    expect(res.job.state).toBe('render_qa');
    const jobs = readBack();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe('render_qa');
    expect(jobs[0].renderPath).toBe(renderPath);
  });

  test('a flat placeholder episode render is rejected to needs_revision', async () => {
    mockRunEpisodePipeline.mockResolvedValue({ ok: true, renderPath });
    mockInspectRender.mockResolvedValue(REAL_FACTS(FLAT_FRAMES));

    const res: any = await run('egypt');

    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/flat color|placeholder/i);
    expect(res.job.state).toBe('needs_revision');
    expect(fs.existsSync(renderPath)).toBe(true);
  });

  test('re-running an existing in-progress job (already past idea) still works', async () => {
    // Seed a job already at media_production, matching the title-match branch.
    fs.writeFileSync(JOBS, JSON.stringify([{
      id: 'existing1',
      title: 'Ancient Pathways: Ancient Egypt: The Secret of the Pyramid Builders',
      format: 'long',
      state: 'media_production',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      history: [],
    }]), 'utf8');
    mockRunEpisodePipeline.mockResolvedValue({ ok: true, renderPath });
    mockInspectRender.mockResolvedValue(REAL_FACTS(REAL_FRAMES));

    const res: any = await run('egypt');

    expect(res.ok).toBe(true);
    expect(res.job.id).toBe('existing1');
    expect(res.job.state).toBe('render_qa');
  });

  test('an unknown episode id is refused before touching the job store', async () => {
    const res: any = await run('not-a-real-episode');
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/unknown episode/i);
  });
});

describe('Character Anchor Workbench through the Studio gateway', () => {
  // Disposable fixture checkout, resolved via ANCIENT_PATHWAYS_DIR. The resolver only
  // accepts a folder containing run_pipeline.py and otherwise falls through to the
  // owner's real Desktop checkout, so the marker is required and asserted below.
  const fixture = path.join(userData, 'ap-fixture');
  const charDir = path.join(fixture, 'workspace', 'branding', 'characters', 'leila');
  const manifestPath = path.join(charDir, 'manifest.json');
  const original = process.env.ANCIENT_PATHWAYS_DIR;
  const save = (event: any, args: unknown) => handlers['homebot:media:ancient-pathways-save-anchor'](event, args);

  beforeEach(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.mkdirSync(path.join(charDir, 'pose_a'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../../../resources/icon.png'), path.join(charDir, 'pose_a', 'idle.png'));
    fs.writeFileSync(manifestPath, JSON.stringify({ pose_a: { idle: 'pose_a/idle.png' }, _mouth_anchors: { pose_a: { idle: [200, 300, 60, 40] } } }));
    fs.writeFileSync(path.join(fixture, 'run_pipeline.py'), '# fixture marker');
    process.env.ANCIENT_PATHWAYS_DIR = fixture;
    const { resolveAncientPathwaysDir } = jest.requireActual('../ancient-pathways');
    expect(resolveAncientPathwaysDir()).toBe(path.resolve(fixture)); // never the real checkout
  });
  afterEach(() => { if (original === undefined) delete process.env.ANCIENT_PATHWAYS_DIR; else process.env.ANCIENT_PATHWAYS_DIR = original; });

  it('reads anchors and refuses to replace a hand-placed one until the owner confirms', async () => {
    const read = await handlers['homebot:media:ancient-pathways-get-anchors'](trustedEvent(), 'leila');
    expect(read.ok).toBe(true);
    expect(read.characters.map((c: any) => c.slug)).toEqual(['leila']); // the fixture, and only the fixture
    expect(read.characters[0]).toMatchObject({ handPlacedMouthAnchors: 1 });
    const args = { character: 'leila', group: 'pose_a', pose: 'idle', anchorType: 'mouth', box: [210, 310, 50, 30] };
    expect(await save(trustedEvent(), args)).toMatchObject({ ok: false, code: 'CONFIRM_OVERWRITE', existingBox: [200, 300, 60, 40] });
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))._mouth_anchors.pose_a.idle).toEqual([200, 300, 60, 40]);
    expect(await save(trustedEvent(), { ...args, confirmOverwrite: true })).toMatchObject({ ok: true });
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))._mouth_anchors.pose_a.idle).toEqual([210, 310, 50, 30]);
  });

  it('rejects malformed requests and other senders before touching the manifest', async () => {
    const before = fs.readFileSync(manifestPath);
    expect(await save(trustedEvent(), 'not an object')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(await save({ sender: {}, senderFrame: {} }, { character: 'leila', group: 'pose_a', pose: 'idle', anchorType: 'mouth', box: [1, 1, 1, 1], confirmOverwrite: true }))
      .toMatchObject({ ok: false, code: 'INVALID_SENDER' });
    expect(fs.readFileSync(manifestPath)).toEqual(before);
  });
});
