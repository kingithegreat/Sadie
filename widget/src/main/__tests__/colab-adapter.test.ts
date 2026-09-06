import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GenerationRouter } from '../movie/router';
import { colabProvider, COLAB_WORKER_ID, probeColabWorker } from '../movie/colab-adapter';
import { pollinationsProvider } from '../movie/pollinations-adapter';
import { localSD15Provider } from '../movie/local-sd15-adapter';
import type { GenerationRequest } from '../movie/types';
import { ShotStatus } from '../movie/types';

describe('Colab T4 Worker Adapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-adapter-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const baseReq = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
    kind: 'image',
    prompt: 'Imhotep standing before the temple at golden hour',
    width: 1024,
    height: 576,
    shotId: 'shot_test_001',
    shotDir: path.join(tmpDir, 'shot_test_001'),
    freeOnly: true,
    allowWatermark: false,
    allowDeferred: false,
    ...over,
  });

  describe('capabilities & probe', () => {
    it('honestly advertises deferred, needs_human, and multi character reference support at $0', async () => {
      const cap = await probeColabWorker(baseReq());
      expect(cap.canGenerate).toBe(true);
      expect(cap.costMicroUsd).toBe(0);
      expect(cap.deferred).toBe(true);
      expect(cap.availability).toBe('needs_human');
      expect(cap.referenceImages).toBe('multi');
      expect(cap.maxWidth).toBeGreaterThanOrEqual(1920);
      expect(cap.maxHeight).toBeGreaterThanOrEqual(1080);
      expect(cap.watermark).toBe('none');
    });
  });

  describe('routing decisions under character references', () => {
    it('is rejected when allowDeferred is false', async () => {
      const router = new GenerationRouter().register(colabProvider);
      const decision = await router.route(baseReq({ allowDeferred: false }));
      expect(decision.chosen).toBeNull();
      expect(decision.rejected[0]?.providerId).toBe(COLAB_WORKER_ID);
      expect(decision.rejected[0]?.reason).toContain('deferred');
    });

    it('wins when character references are supplied and deferral is allowed', async () => {
      const router = new GenerationRouter()
        .register(pollinationsProvider)
        .register(localSD15Provider)
        .register(colabProvider);

      // Pollinations has referenceImages: 'none' (rejected)
      // Local SD15 max 512x512 < requested 1024x576 (rejected)
      // Colab T4 has referenceImages: 'multi' and supports 1024x576 (eligible!)
      const req = baseReq({
        characterRefs: ['/refs/imhotep_sheet.png'],
        allowDeferred: true,
        allowWatermark: true,
      });

      const decision = await router.route(req);
      expect(decision.chosen?.providerId).toBe(COLAB_WORKER_ID);
      expect(decision.chosen?.eligible).toBe(true);

      const pollinationsRejection = decision.rejected.find((r) => r.providerId === 'pollinations');
      expect(pollinationsRejection?.reason).toContain('provider accepts none');
    });

    it('loses to ready providers when no character references are needed', async () => {
      const router = new GenerationRouter()
        .register(colabProvider)
        .register(pollinationsProvider);

      // When watermarks are allowed and no character refs are required,
      // Pollinations is rate_limited (score 64) vs Colab needs_human (score 49)
      const req = baseReq({
        allowDeferred: true,
        allowWatermark: true,
      });

      const decision = await router.route(req);
      expect(decision.chosen?.providerId).toBe('pollinations');
      expect(decision.fallbacks.map((f) => f.providerId)).toContain(COLAB_WORKER_ID);
    });
  });

  describe('deferred ticket generation', () => {
    it('refuses to generate if allowDeferred is false', async () => {
      const req = baseReq({ allowDeferred: false });
      const result = await colabProvider.generate(req);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error).toContain('deferred');
      }
    });

    it('creates ticket.json and marks status.json as AWAITING_WORKER', async () => {
      const shotDir = path.join(tmpDir, 'shot_042');
      const req = baseReq({
        shotId: 'shot_042',
        shotDir,
        allowDeferred: true,
        characterRefs: ['/refs/imhotep_face.png'],
      });

      const result = await colabProvider.generate(req);
      expect(result.status).toBe('deferred');
      if (result.status === 'deferred') {
        expect(result.provider).toBe(COLAB_WORKER_ID);
        expect(result.ticket).toContain('colab_ticket_shot_042');
        expect(result.where).toContain('notebooks/colab_sdxl_ipadapter.ipynb');

        // Verify ticket.json on disk
        const ticketPath = path.join(shotDir, 'ticket.json');
        expect(fs.existsSync(ticketPath)).toBe(true);
        const ticket = JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));
        expect(ticket.ticketId).toBe(result.ticket);
        expect(ticket.shotId).toBe('shot_042');
        expect(ticket.status).toBe(ShotStatus.AWAITING_WORKER);
        expect(ticket.characterRefs).toEqual(['/refs/imhotep_face.png']);

        // Verify status.json on disk
        const statusPath = path.join(shotDir, 'status.json');
        expect(fs.existsSync(statusPath)).toBe(true);
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        expect(status.status).toBe(ShotStatus.AWAITING_WORKER);
        expect(status.deferredTicket).toBe(result.ticket);
        expect(status.deferredProvider).toBe(COLAB_WORKER_ID);

        // Verify prompt.json on disk
        const promptPath = path.join(shotDir, 'prompt.json');
        expect(fs.existsSync(promptPath)).toBe(true);
      }
    });
  });
});
