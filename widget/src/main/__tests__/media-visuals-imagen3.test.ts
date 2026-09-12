import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock http/https modules
jest.mock('http', () => ({
  request: jest.fn(),
  Agent: class MockAgent { constructor() {} },
}));
jest.mock('https', () => ({
  request: jest.fn(),
  Agent: class MockAgent { constructor() {} },
}));
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter() as any;
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    queueMicrotask(() => proc.emit('close', 1));
    return proc;
  }),
  execFileSync: jest.fn(() => { throw new Error('no local backend in this test'); }),
}));

const mockGenerateImagen3 = jest.fn();
jest.mock('../tools/imagen', () => ({
  generateImagen3: (...args: any[]) => mockGenerateImagen3(...args),
}));

import { generateSceneImages } from '../media-visuals';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-visuals-imagen3-'));
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('media-visuals Imagen 3 end-to-end integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaultGenerator uses Imagen 3 when backend is imagen and outputs source imagen-3', async () => {
    mockGenerateImagen3.mockResolvedValueOnce({
      base64: PNG_1PX,
      mimeType: 'png',
    });

    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'ancient ruins on a cliff' }],
      videoTitle: 'Lost Civilizations',
      outDir: dir,
      width: 512,
      height: 512,
      backend: 'imagen',
    });

    expect(res.length).toBe(1);
    expect(res[0].path).toBeTruthy();
    expect(res[0].source).toBe('imagen-3');
    expect(fs.existsSync(res[0].path!)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('defaultGenerator in hybrid mode falls back to Imagen 3 before Pollinations', async () => {
    mockGenerateImagen3.mockResolvedValueOnce({
      base64: PNG_1PX,
      mimeType: 'png',
    });

    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'golden sunrise over mountains' }],
      videoTitle: 'Morning Light',
      outDir: dir,
      width: 512,
      height: 512,
    });

    expect(res.length).toBe(1);
    expect(res[0].path).toBeTruthy();
    expect(res[0].source).toBe('imagen-3');
    expect(fs.existsSync(res[0].path!)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
