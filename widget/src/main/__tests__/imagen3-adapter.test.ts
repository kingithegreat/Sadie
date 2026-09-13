/**
 * Tests for movie/imagen3-adapter.ts — Google AI Studio Imagen 3 image generation.
 * Uses the Gemini API key from settings (google-ai-studio provider vault).
 */

jest.mock('electron', () => ({
  app: { getAppPath: () => 'fake-app-root' },
  nativeImage: require('./helpers/movie-image').movieNativeImageStub,
}));
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockGetSettings = jest.fn();
jest.mock('../config-manager', () => ({
  getSettings: (...a: any[]) => mockGetSettings(...a),
}));

let mockGoogleKey = '';
jest.mock('../../shared/cloud-llm', () => ({
  ...jest.requireActual('../../shared/cloud-llm'),
  apiKeyForProvider: (_settings: any, provider: string) =>
    provider === 'google-ai-studio' ? mockGoogleKey : '',
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  probeImagen3,
  generateImagen3Shot,
  imagen3Provider,
} from '../movie/imagen3-adapter';
import type { GenerationRequest, MediaKind } from '../movie/types';

const fakeRequest: GenerationRequest = {
  kind: 'image' as MediaKind,
  prompt: 'A serene temple at sunset',
  width: 1024,
  height: 1024,
  shotId: 'shot_01',
  shotDir: '/tmp/test-shot',
  freeOnly: true,
  allowWatermark: false,
  allowDeferred: false,
};

describe('imagen3-adapter', () => {
  beforeEach(() => {
    mockGetSettings.mockReturnValue({ useCustomLLM: true });
    mockFetch.mockReset();
    mockGoogleKey = '';
  });

  describe('probeImagen3', () => {
    it('reports Imagen 3 as retired regardless of configured key', async () => {
      mockGoogleKey = '';
      const cap = await probeImagen3(fakeRequest);
      expect(cap.canGenerate).toBe(false);
      mockGoogleKey = 'AIza-test-key';
      const withKey = await probeImagen3(fakeRequest);
      expect(cap.reason).toContain('retired');
      expect(withKey.canGenerate).toBe(false);
      expect(withKey.reason).toBe(cap.reason);
    });
  });

  describe('generateImagen3Shot', () => {
    it('returns a retired-provider failure without writing an asset', async () => {
      mockGoogleKey = 'AIza-test-key';
      const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagen-shot-'));
      try {
        const result = await generateImagen3Shot({ ...fakeRequest, shotDir });
        expect(result.status).toBe('failed');
        expect(result.provider).toBe('imagen-3');
        expect((result as { error: string }).error).toContain('retired');
        expect(mockFetch).not.toHaveBeenCalled();
      } finally { fs.rmSync(shotDir, { recursive: true, force: true }); }
    });

  });

  describe('imagen3Provider', () => {
    it('has correct id and kind', () => {
      expect(imagen3Provider.id).toBe('imagen-3');
      expect(imagen3Provider.kind).toBe('image');
    });

    it('probe and generate are functions', () => {
      expect(typeof imagen3Provider.probe).toBe('function');
      expect(typeof imagen3Provider.generate).toBe('function');
    });
  });
});
