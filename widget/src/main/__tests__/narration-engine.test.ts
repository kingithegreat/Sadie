/**
 * Narration provider seam tests — voice.ts's Kokoro/Edge decision.
 *
 * Contract under test:
 *  - Default stays Edge; Kokoro runs ONLY when asked (explicit arg or saved
 *    preference).
 *  - Any Kokoro failure falls back to Edge and the RESULT says which engine
 *    actually rendered — a silent substitution must be impossible to ship.
 *  - An Edge-style voice name never reaches the local model (the panel swaps
 *    its list, this is the backstop).
 *  - ±percent rate maps onto Kokoro's speed factor with clamps.
 */

jest.mock('msedge-tts', () => ({
  MsEdgeTTS: jest.fn().mockImplementation(() => ({
    setMetadata: jest.fn().mockResolvedValue(undefined),
    // msedge-tts 2.x contract: writes <dir>/audio.mp3, resolves { audioFilePath }.
    toFile: jest.fn(async (dir: string) => {
      const p = require('path').join(dir, 'audio.mp3');
      require('fs').writeFileSync(p, 'fake-mp3-bytes');
      return { audioFilePath: p };
    }),
  })),
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'audio-24khz-96kbps-mono-mp3' },
}));

const kokoroFromPretrained = jest.fn();
const kokoroGenerate = jest.fn(async (_text: string, opts: any) => {
  void opts;
  return { toWav: () => new ArrayBuffer(64) };
});

jest.mock('kokoro-js', () => ({
  KokoroTTS: {
    from_pretrained: (...args: unknown[]) => kokoroFromPretrained(...args),
  },
}));

jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => ({ narrationEngine: mockNarrationEngine })),
}));

let mockNarrationEngine: 'edge' | 'kokoro' | undefined = undefined;

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderNarrationToFile, resolveNarrationEngine, __resetKokoroForTest } from '../tools/voice';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narration-engine-'));

beforeEach(() => {
  jest.clearAllMocks();
  mockNarrationEngine = undefined;
  __resetKokoroForTest();
  kokoroFromPretrained.mockResolvedValue({ generate: kokoroGenerate });
});

afterEach(() => {
  // nothing persistent beyond tempdirs
});

describe('resolveNarrationEngine', () => {
  test('defaults to Edge with no preference', () => {
    expect(resolveNarrationEngine(undefined)).toBe('edge');
  });

  test('saved kokoro preference applies', () => {
    mockNarrationEngine = 'kokoro';
    expect(resolveNarrationEngine(undefined)).toBe('kokoro');
  });

  test('an explicit request wins over the saved preference, both ways', () => {
    mockNarrationEngine = 'kokoro';
    expect(resolveNarrationEngine('edge')).toBe('edge');
    mockNarrationEngine = undefined;
    expect(resolveNarrationEngine('kokoro')).toBe('kokoro');
  });

  test('garbage values fall through to the default', () => {
    mockNarrationEngine = 'kokoro';
    expect(resolveNarrationEngine('whisper' as any)).toBe('kokoro');
    mockNarrationEngine = undefined;
    expect(resolveNarrationEngine('whisper' as any)).toBe('edge');
  });
});

describe('renderNarrationToFile provider seam', () => {
  test('default renders through Edge and never touches Kokoro', async () => {
    const dir = tmpRoot();
    const r = await renderNarrationToFile('Hello there.', path.join(dir, 'narration.mp3'));
    expect(r.engine).toBe('edge');
    expect(r.path.endsWith('audio.mp3')).toBe(true);
    expect(kokoroFromPretrained).not.toHaveBeenCalled();
  });

  test('kokoro request renders a wav through the local model', async () => {
    const dir = tmpRoot();
    const r = await renderNarrationToFile(
      'Hello there.',
      path.join(dir, 'narration.mp3'),
      { engine: 'kokoro' },
    );
    expect(r.engine).toBe('kokoro');
    expect(path.basename(r.path)).toBe('narration.wav');
    expect(kokoroFromPretrained).toHaveBeenCalledWith(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      expect.objectContaining({ dtype: 'q8', device: 'cpu' }),
    );
    expect(kokoroGenerate).toHaveBeenCalledWith(
      'Hello there.',
      expect.objectContaining({ voice: 'af_heart', speed: 1 }),
    );
  });

  test('a saved kokoro preference is enough; an explicit edge wins over it', async () => {
    mockNarrationEngine = 'kokoro';
    const a = await renderNarrationToFile('Hi.', path.join(tmpRoot(), 'n.mp3'));
    expect(a.engine).toBe('kokoro');

    const b = await renderNarrationToFile('Hi.', path.join(tmpRoot(), 'n.mp3'), { engine: 'edge' });
    expect(b.engine).toBe('edge');
  });

  test('kokoro failure falls back to Edge and SAYS so', async () => {
    kokoroFromPretrained.mockRejectedValue(new Error('weights not downloaded'));
    const dir = tmpRoot();
    const r = await renderNarrationToFile(
      'Hello there.',
      path.join(dir, 'narration.mp3'),
      { engine: 'kokoro' },
    );
    expect(r.engine).toBe('edge');
    expect(r.path.endsWith('audio.mp3')).toBe(true);
  });

  test('an Edge-style voice name never reaches Kokoro', async () => {
    const dir = tmpRoot();
    await renderNarrationToFile('Hi.', path.join(dir, 'narration.mp3'), {
      engine: 'kokoro',
      voice: 'en-GB-SoniaNeural',
    });
    expect(kokoroGenerate).toHaveBeenCalledWith(
      'Hi.',
      expect.objectContaining({ voice: 'af_heart' }),
    );
  });

  test('rate percent maps onto speed with clamps', async () => {
    const cases: Array<[number | undefined, number]> = [
      [undefined, 1],
      [50, 1.5],
      [-60, 0.5],
      [150, 2],
    ];
    for (const [rate, expected] of cases) {
      kokoroGenerate.mockClear();
      await renderNarrationToFile('Hi.', path.join(tmpRoot(), 'n.mp3'), { engine: 'kokoro', rate });
      expect(kokoroGenerate).toHaveBeenCalledWith(
        'Hi.',
        expect.objectContaining({ speed: expected }),
      );
    }
  });
});
