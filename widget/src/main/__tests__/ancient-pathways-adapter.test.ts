import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GenerationRouter } from '../movie/router';
import {
  ancientPathwaysProvider,
  ANCIENT_PATHWAYS_PROVIDER_ID,
  extractCharactersFromRequest,
  probeAncientPathways,
} from '../movie/ancient-pathways-adapter';
import { pollinationsProvider } from '../movie/pollinations-adapter';
import { localSD15Provider } from '../movie/local-sd15-adapter';
import { colabProvider } from '../movie/colab-adapter';
import type { GenerationRequest } from '../movie/types';

// Mock resolveAncientPathwaysDir so the adapter does not depend on the
// `~/Desktop/Ancient Pathways` folder existing on the host running the tests.
// On CI runners this path does not exist; mocking makes the suite hermetic.
const mockResolveAncientPathwaysDir = jest.fn();
const mockCheckRenderLock = jest.fn();
jest.mock('../ancient-pathways', () => ({
  resolveAncientPathwaysDir: () => mockResolveAncientPathwaysDir(),
  checkRenderLock: (dir: string) => mockCheckRenderLock(dir),
  runShowrunner: jest.fn(),
}));

describe('Ancient Pathways Local Movie Adapter', () => {
  let tmpDir: string;
  const origEnv = process.env.ANCIENT_PATHWAYS_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-adapter-test-'));
    fs.writeFileSync(path.join(tmpDir, 'run_pipeline.py'), '# mock pipeline runner\n');
    process.env.ANCIENT_PATHWAYS_DIR = tmpDir;
    // Default: AP is available at tmpDir and the render lock is clear.
    mockResolveAncientPathwaysDir.mockReturnValue(tmpDir);
    mockCheckRenderLock.mockReturnValue({ locked: false });
  });

  afterEach(() => {
    mockResolveAncientPathwaysDir.mockReset();
    mockCheckRenderLock.mockReset();
    if (origEnv !== undefined) {
      process.env.ANCIENT_PATHWAYS_DIR = origEnv;
    } else {
      delete process.env.ANCIENT_PATHWAYS_DIR;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const baseReq = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
    kind: 'video',
    prompt: 'Imhotep and Leila discuss temple construction at golden hour',
    width: 1920,
    height: 1080,
    durationSec: 8,
    shotId: 'shot_ap_001',
    shotDir: path.join(tmpDir, 'shot_ap_001'),
    freeOnly: true,
    allowWatermark: false,
    allowDeferred: false,
    ...over,
  });

  describe('capabilities & probe', () => {
    it('advertises free, 1080p, multi-character refs, and imageToVideo on local CPU', async () => {
      const cap = await probeAncientPathways(baseReq());
      expect(cap.canGenerate).toBe(true);
      expect(cap.costMicroUsd).toBe(0);
      expect(cap.maxWidth).toBeGreaterThanOrEqual(1920);
      expect(cap.maxHeight).toBeGreaterThanOrEqual(1080);
      expect(cap.referenceImages).toBe('multi');
      expect(cap.imageToVideo).toBe(true);
      expect(cap.watermark).toBe('none');
      expect(cap.deferred).toBe(false);
      expect(ancientPathwaysProvider.kind).toBe('both');
    });
  });

  describe('character extraction', () => {
    it('extracts known characters from prompt', () => {
      const chars = extractCharactersFromRequest(baseReq({
        prompt: 'Imhotep stands beside Socrates near the pyramids',
      }));
      expect(chars).toContain('imhotep');
      expect(chars).toContain('socrates');
    });

    it('extracts known characters from characterRefs paths', () => {
      const chars = extractCharactersFromRequest(baseReq({
        prompt: 'A figure explains mathematics',
        characterRefs: ['/path/to/imhotep_sheet.png', '/path/to/flappy_front.png'],
      }));
      expect(chars).toContain('imhotep');
      expect(chars).toContain('flappy');
    });

    it('falls back to leila,flappy when no character matches', () => {
      const chars = extractCharactersFromRequest(baseReq({
        prompt: 'An ancient temple at sunrise with nobody around',
        characterRefs: [],
      }));
      expect(chars).toBe('leila,flappy');
    });
  });

  describe('router integration with competing providers', () => {
    it('wins for 1080p video with character references when deferred is disallowed', async () => {
      const router = new GenerationRouter()
        .register(pollinationsProvider)   // rejected: video? kind='image' only, refImages='none'
        .register(localSD15Provider)       // rejected: kind='image', 512x512
        .register(colabProvider)           // rejected: allowDeferred=false
        .register(ancientPathwaysProvider); // eligible! kind='both', 1920x1080, multi-ref, ready

      const req = baseReq({
        kind: 'video',
        durationSec: 8,
        characterRefs: ['/refs/imhotep.png'],
        allowDeferred: false,
      });

      const decision = await router.route(req);
      expect(decision.chosen?.providerId).toBe(ANCIENT_PATHWAYS_PROVIDER_ID);
      expect(decision.chosen?.eligible).toBe(true);
    });

    it('wins for 1080p stills with character references when deferred is disallowed', async () => {
      const router = new GenerationRouter()
        .register(pollinationsProvider)   // rejected: referenceImages='none'
        .register(localSD15Provider)       // rejected: 512x512 < 1920x1080
        .register(colabProvider)           // rejected: allowDeferred=false
        .register(ancientPathwaysProvider); // eligible!

      const req = baseReq({
        kind: 'image',
        width: 1920,
        height: 1080,
        characterRefs: ['/refs/imhotep.png'],
        allowDeferred: false,
      });

      const decision = await router.route(req);
      expect(decision.chosen?.providerId).toBe(ANCIENT_PATHWAYS_PROVIDER_ID);
    });

    it('wins over colab for character stills even when deferral is allowed because it is ready', async () => {
      const router = new GenerationRouter()
        .register(colabProvider)           // availability='needs_human' (score 49)
        .register(ancientPathwaysProvider); // availability='ready' (score 125+)

      const req = baseReq({
        kind: 'image',
        width: 1920,
        height: 1080,
        characterRefs: ['/refs/imhotep.png'],
        allowDeferred: true,
      });

      const decision = await router.route(req);
      expect(decision.chosen?.providerId).toBe(ANCIENT_PATHWAYS_PROVIDER_ID);
      expect(decision.fallbacks.map((f) => f.providerId)).toContain('colab-worker');
    });
  });
});
