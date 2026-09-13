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

// The real, retired Imagen client runs underneath; the spy only records calls.
const mockGenerateImagen3 = jest.fn();
jest.mock('../tools/imagen', () => {
  const actual = jest.requireActual('../tools/imagen');
  return { ...actual, generateImagen3: (...args: any[]) => mockGenerateImagen3(...args) };
});
const { generateImagen3: realGenerateImagen3 } = jest.requireActual('../tools/imagen');

import { generateSceneImages } from '../media-visuals';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-visuals-imagen3-'));

describe('media-visuals with Imagen 3 retired (Google shut it down on 10 November 2025)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateImagen3.mockReset().mockImplementation(realGenerateImagen3);
  });

  it('an explicit imagen backend makes no Imagen scene image and sends no request', async () => {
    const dir = tmp();
    try {
      const res = await generateSceneImages({
        scenes: [{ text: 'ancient ruins on a cliff' }],
        videoTitle: 'Lost Civilizations',
        outDir: dir,
        width: 512,
        height: 512,
        backend: 'imagen',
      });
      expect(res.length).toBe(1);
      expect(res[0].source).not.toBe('imagen-3');
      // The scene generator retries a failed scene; every attempt is refused locally.
      expect(mockGenerateImagen3).toHaveBeenCalled();
      for (const call of mockGenerateImagen3.mock.results) await expect(call.value).rejects.toMatchObject({ code: 'IMAGEN3_RETIRED' });
      expect(require('https').request).not.toHaveBeenCalled();
      expect(require('http').request).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hybrid mode never yields an Imagen image; the retired client refuses instantly', async () => {
    const dir = tmp();
    try {
      const res = await generateSceneImages({
        scenes: [{ text: 'golden sunrise over mountains' }],
        videoTitle: 'Morning Light',
        outDir: dir,
        width: 512,
        height: 512,
      });
      expect(res.length).toBe(1);
      expect(res[0].source).not.toBe('imagen-3');
      for (const call of mockGenerateImagen3.mock.results) await expect(call.value).rejects.toMatchObject({ code: 'IMAGEN3_RETIRED' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
