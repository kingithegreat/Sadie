/**
 * Tests for movie/imagen3-adapter.ts and tools/imagen.ts — Google Imagen 3 was
 * shut down on 10 November 2025, so both must refuse before any request, never
 * read or send the Gemini key, and never write a shot image.
 */

jest.mock('electron', () => ({
  app: { getAppPath: () => 'fake-app-root' },
  nativeImage: require('./helpers/movie-image').movieNativeImageStub,
}));
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { movieImageFixture } from './helpers/movie-image';

const mockGetSettings = jest.fn();
jest.mock('../config-manager', () => ({
  getSettings: (...a: any[]) => mockGetSettings(...a),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  probeImagen3,
  generateImagen3,
  generateImagen3Shot,
  imagen3Provider,
  IMAGEN3_COST_MICRO_USD,
} from '../movie/imagen3-adapter';
import { IMAGEN3_RETIRED_MESSAGE } from '../tools/imagen';
import { GenerationRouter } from '../movie/router';
import type { GenerationRequest, MediaKind } from '../movie/types';

const fakeRequest: GenerationRequest = {
  kind: 'image' as MediaKind,
  prompt: 'A serene temple at sunset',
  width: 1024,
  height: 1024,
  shotId: 'shot_01',
  shotDir: '/tmp/test-shot',
  freeOnly: false,
  allowWatermark: true,
  allowDeferred: false,
};

describe('imagen3-adapter (retired)', () => {
  beforeEach(() => {
    // The most permissive setup: Online on and a key saved. Retirement must still refuse.
    mockGetSettings.mockReturnValue({ useCustomLLM: true, providerApiKeys: { 'google-ai-studio': 'AIza-test-key' } });
    mockFetch.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: [{ bytesBase64Encoded: movieImageFixture.toString('base64'), mimeType: 'image/png' }] }),
    });
  });

  it('probe reports it cannot generate, with the retirement reason, without reading settings', async () => {
    const cap = await probeImagen3(fakeRequest);
    expect(cap).toMatchObject({ canGenerate: false, availability: 'offline', reason: IMAGEN3_RETIRED_MESSAGE });
    expect(cap.costMicroUsd).toBe(IMAGEN3_COST_MICRO_USD); // never presented as free
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('the client refuses before any request, even with a key and a valid response waiting', async () => {
    await expect(generateImagen3('test prompt', 1024, 1024)).rejects.toMatchObject({
      code: 'IMAGEN3_RETIRED', message: IMAGEN3_RETIRED_MESSAGE,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('shot generation fails with the retirement message and writes no image', async () => {
    const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagen-shot-'));
    try {
      const result = await generateImagen3Shot({ ...fakeRequest, shotDir });
      expect(result).toMatchObject({ status: 'failed', provider: 'imagen-3', error: IMAGEN3_RETIRED_MESSAGE });
      expect(fs.existsSync(path.join(shotDir, 'image'))).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally { fs.rmSync(shotDir, { recursive: true, force: true }); }
  });

  it('a router rejects it with the retirement reason even when paid generation is allowed', async () => {
    const decision = await new GenerationRouter().register(imagen3Provider).route(fakeRequest, { freeOnly: false });
    expect(decision.chosen).toBeNull();
    expect(decision.rejected).toEqual([expect.objectContaining({ providerId: 'imagen-3', reason: IMAGEN3_RETIRED_MESSAGE })]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps its registration identity so routing decisions can name it', () => {
    expect(imagen3Provider.id).toBe('imagen-3');
    expect(imagen3Provider.kind).toBe('image');
  });
});
