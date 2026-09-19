/**
 * studio-series-settings-ipc.test.ts — Stage Sets catalog segment/save/delete IPC.
 *
 * The segment handler now accepts a caller-supplied file path (the sandboxed renderer
 * cannot read the plate itself). That makes the handler an arbitrary-file-read
 * primitive unless the path is confined, so the load-bearing assertions here are the
 * confinement ones — this surface is reachable from the renderer.
 *
 * Does real file work under a temp APPDATA root, so it gets an explicit timeout
 * above the 5s Jest default.
 */
jest.setTimeout(15_000);

const handlers: Record<string, (...args: any[]) => Promise<any>> = {};

const segmentCall: { buffer?: Buffer } = {};
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => { handlers[name] = handler; } } }));
jest.mock('../tools/media-foreground-segmenter', () => ({
  segmentSettingImage: jest.fn(async (buf: Buffer) => {
    segmentCall.buffer = buf;
    return { ok: true, bgBuffer: Buffer.from('bg-bytes'), fgBuffer: Buffer.from('fg-bytes'), engineUsed: 'mock' };
  }),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerStudioIpc } from '../modules/bundled/studio-ipc';

const invokeTool = jest.fn(async () => ({ success: true, result: {} }));

let tempRoot: string;
let savedAppData: string | undefined;
let platePath: string;

beforeAll(() => {
  // Isolate the whole series storage tree under a temp APPDATA so getSeriesStorageBaseDir
  // resolves here (the mocked electron has no `app`, so it falls back to APPDATA).
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-series-settings-'));
  savedAppData = process.env.APPDATA;
  process.env.APPDATA = tempRoot;

  const dir = path.join(tempRoot, 'HomeBot', 'series', 'ancient-pathways', 'settings', 'throne_room');
  fs.mkdirSync(dir, { recursive: true });
  platePath = path.join(dir, 'bg.png');
  fs.writeFileSync(platePath, Buffer.from('real-png-bytes'));
});

afterAll(() => {
  if (savedAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = savedAppData;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  delete segmentCall.buffer;
  registerStudioIpc((_channel, handler) => handler, invokeTool, () => undefined);
});

describe('series-settings segment path confinement', () => {
  test('reads the named plate and segments its real bytes', async () => {
    const res = await handlers['homebot:media:series-settings:segment']({}, { bgPath: platePath, preferCpu: true });
    expect(res.ok).toBe(true);
    expect(segmentCall.buffer?.toString()).toBe('real-png-bytes');
  });

  test('refuses a plate path outside the series storage root', async () => {
    const outside = path.join(tempRoot, 'elsewhere.png');
    fs.writeFileSync(outside, Buffer.from('secret'));
    const res = await handlers['homebot:media:series-settings:segment']({}, { bgPath: outside });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('outside the series settings storage');
    expect(segmentCall.buffer).toBeUndefined();
  });

  test('refuses a directory rather than walking into one', async () => {
    const dir = path.join(tempRoot, 'HomeBot', 'series', 'ancient-pathways', 'settings', 'throne_room');
    const res = await handlers['homebot:media:series-settings:segment']({}, { bgPath: dir });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('outside the series settings storage');
  });

  test('reports a missing plate instead of segmenting nothing', async () => {
    const res = await handlers['homebot:media:series-settings:segment']({}, {
      bgPath: path.join(tempRoot, 'HomeBot', 'series', 'ancient-pathways', 'settings', 'nope', 'bg.png'),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not found');
  });

  test('still accepts inline bytes, and errors when neither is given', async () => {
    const res = await handlers['homebot:media:series-settings:segment']({}, {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain('imageBase64 or bgPath');

    const inline = await handlers['homebot:media:series-settings:segment']({}, { imageBase64: 'aGVsbG8=' });
    expect(inline.ok).toBe(true);
    expect(segmentCall.buffer?.toString()).toBe('hello');
  });

  test('an escape attempt via .. is confined', async () => {
    const escaped = path.join(tempRoot, 'HomeBot', 'series', 'ancient-pathways', 'settings', 'throne_room', '..', '..', '..', '..', 'elsewhere.png');
    const res = await handlers['homebot:media:series-settings:segment']({}, { bgPath: escaped });
    expect(res.ok).toBe(false);
  });
});
