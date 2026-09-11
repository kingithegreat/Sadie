import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Node contract tests use a decoder double that accepts only the known fixture.
jest.mock('electron', () => ({ nativeImage: require('./helpers/movie-image').movieNativeImageStub }));
let mockOnline = true;
jest.mock('../config-manager', () => ({ getSettings: () => ({ useCustomLLM: mockOnline, allowCloud: mockOnline }) }));

import { movieImageFixture } from './helpers/movie-image';
import {
  discoverDriveQueue,
  computeColabJobId,
  stageColabJob,
  checkAndIngestColabResult,
  cancelColabJob,
  retryColabJob,
} from '../movie/colab-queue';
import type { GenerationRequest } from '../movie/types';
import { ShotStatus } from '../movie/types';

describe('Colab Worker Queue & Portable Job Manifests', () => {
  let tmpDir: string;
  let queueDir: string;
  let shotDir: string;
  let sampleRefImg: string;

  beforeEach(() => {
    mockOnline = true;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-queue-test-'));
    queueDir = path.join(tmpDir, 'mock_drive_queue');
    shotDir = path.join(tmpDir, 'project', 'shots', 'shot_001');
    fs.mkdirSync(shotDir, { recursive: true });

    sampleRefImg = path.join(tmpDir, 'alice_ref.png');
    fs.writeFileSync(sampleRefImg, movieImageFixture);
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
    prompt: 'Alice exploring the ancient library at dusk',
    width: 1024,
    height: 576,
    shotId: 'shot_001',
    shotDir,
    freeOnly: true,
    allowWatermark: false,
    allowDeferred: true,
    ...over,
  });

  describe('Drive Queue Discovery', () => {
    it('initializes queue directories with custom root', () => {
      const q = discoverDriveQueue(queueDir);
      expect(q.available).toBe(true);
      expect(q.rootDir).toBe(queueDir);
      expect(fs.existsSync(q.ticketsDir)).toBe(true);
      expect(fs.existsSync(q.inputsDir)).toBe(true);
      expect(fs.existsSync(q.outputsDir)).toBe(true);
    });

    it('discovers queue via HOMEBOT_COLAB_QUEUE environment variable', () => {
      const envQueue = path.join(tmpDir, 'env_queue');
      fs.mkdirSync(envQueue, { recursive: true });
      process.env.HOMEBOT_COLAB_QUEUE = envQueue;
      try {
        const q = discoverDriveQueue();
        expect(q.source).toBe('env');
        expect(q.rootDir).toBe(envQueue);
      } finally {
        delete process.env.HOMEBOT_COLAB_QUEUE;
      }
    });

    it('falls back to local staging when no Google Drive is mounted', () => {
      const q = discoverDriveQueue();
      expect(q.rootDir).toBeDefined();
      expect(q.ticketsDir).toContain('tickets');
    });
  });

  describe('Deterministic Job IDs', () => {
    it('produces identical IDs for identical inputs', () => {
      const req1 = baseReq();
      const req2 = baseReq();
      expect(computeColabJobId(req1)).toBe(computeColabJobId(req2));
    });

    it('produces different IDs when prompt or references change', () => {
      const req1 = baseReq({ prompt: 'A temple in morning light' });
      const req2 = baseReq({ prompt: 'A temple in evening light' });
      expect(computeColabJobId(req1)).not.toBe(computeColabJobId(req2));

      const reqWithRef = baseReq({ characterRefs: [sampleRefImg] });
      expect(computeColabJobId(req1)).not.toBe(computeColabJobId(reqWithRef));
    });
  });

  describe('Portable Job Staging', () => {
    it('fails closed when online access is disabled', () => {
      mockOnline = false;
      const q = discoverDriveQueue(queueDir);
      expect(() => stageColabJob(baseReq(), q)).toThrow(/online access/i);
    });

    it('stages job manifest and reference images into queue', () => {
      const q = discoverDriveQueue(queueDir);
      const req = baseReq({ characterRefs: [sampleRefImg] });
      const manifest = stageColabJob(req, q);

      expect(manifest.shotId).toBe('shot_001');
      expect(manifest.status).toBe(ShotStatus.AWAITING_WORKER);
      expect(manifest.stagedCharacterRefs).toHaveLength(1);
      expect(manifest.stagedCharacterRefs[0]).toMatch(/^inputs\/[a-f0-9]+\/ref_0\.png$/);

      // Verify staged image in queue inputs/
      const stagedAbs = path.join(q.rootDir, manifest.stagedCharacterRefs[0]);
      expect(fs.existsSync(stagedAbs)).toBe(true);
      expect(fs.readFileSync(stagedAbs)).toEqual(movieImageFixture);

      // Verify ticket in queue tickets/
      const ticketPath = path.join(q.ticketsDir, `${manifest.ticketId}.json`);
      expect(fs.existsSync(ticketPath)).toBe(true);
      const savedTicket = JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));
      expect(savedTicket.ticketId).toBe(manifest.ticketId);
      expect(savedTicket.relativeOutputPath).toBe(`outputs/${manifest.jobId}/shot_001.png`);

      // Verify local shotDir status and ticket
      const localTicket = path.join(shotDir, 'ticket.json');
      expect(fs.existsSync(localTicket)).toBe(true);
      const localStatus = path.join(shotDir, 'status.json');
      expect(fs.existsSync(localStatus)).toBe(true);
      const statusData = JSON.parse(fs.readFileSync(localStatus, 'utf-8'));
      expect(statusData.status).toBe(ShotStatus.AWAITING_WORKER);
      expect(statusData.deferredTicket).toBe(manifest.ticketId);
    });
  });

  describe('Worker Result Ingestion & Validation', () => {
    it('returns pending when worker output has not arrived', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const result = checkAndIngestColabResult(shotDir, manifest.ticketId, q);

      expect(result.status).toBe('pending');
      expect(result.ticketId).toBe(manifest.ticketId);
    });

    it('atomically ingests valid worker image and marks IMAGE_GENERATED', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      // Simulate worker creating output image in queue outputs/
      const outAbs = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, movieImageFixture);

      // Ingest result
      const result = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      expect(result.status).toBe('imported');
      if (result.status === 'imported') {
        expect(result.imagePath).toBe(path.join(shotDir, 'image', 'shot_001.png'));
        expect(fs.existsSync(result.imagePath)).toBe(true);
        expect(fs.readFileSync(result.imagePath)).toEqual(movieImageFixture);

        // Verify local status.json updated
        const statusData = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
        expect(statusData.status).toBe(ShotStatus.IMAGE_GENERATED);
        expect(statusData.outputFiles).toEqual([path.join('image', 'shot_001.png')]);
        expect(statusData.deferredTicket).toBeUndefined();
      }
    });

    it('rejects corrupt or unreadable worker image output', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      // Simulate worker outputting corrupt garbage
      const outAbs = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, Buffer.from('corrupt non-image garbage data'));

      const result = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error).toContain('The worker image is unreadable');

        // Corrupt file must NOT remain in shotDir/image/
        const localImg = path.join(shotDir, 'image', 'shot_001.png');
        expect(fs.existsSync(localImg)).toBe(false);

        // status.json must record FAILED honestly
        const statusData = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
        expect(statusData.status).toBe(ShotStatus.FAILED);
      }
    });

    it('rejects 0-byte empty worker output', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      const outAbs = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, Buffer.alloc(0));

      const result = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error).toContain('unreadable');
      }
    });

    it('reports failure when worker marked ticket completed but image is missing', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      // Mark ticket completed in queue but omit the image
      manifest.status = ShotStatus.IMAGE_GENERATED;
      fs.writeFileSync(
        path.join(q.ticketsDir, `${manifest.ticketId}.json`),
        JSON.stringify(manifest),
        'utf-8',
      );

      const result = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error).toContain('missing');
      }
    });
  });

  describe('Resume and Partial Results', () => {
    it('survives repeated ingestion calls without duplicate errors', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      const outAbs = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, movieImageFixture);

      const first = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      expect(first.status).toBe('imported');

      // Second check should still report imported and valid
      const second = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      expect(second.status).toBe('imported');
    });
  });

  describe('Cancellation & Retry', () => {
    it('cancels pending job in queue and resets shot status to PLANNED', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      cancelColabJob(shotDir, manifest.ticketId, q);

      const savedTicket = JSON.parse(
        fs.readFileSync(path.join(q.ticketsDir, `${manifest.ticketId}.json`), 'utf-8'),
      );
      expect(savedTicket.status).toBe('CANCELLED');

      const statusData = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
      expect(statusData.status).toBe(ShotStatus.PLANNED);
      expect(statusData.deferredTicket).toBeUndefined();
    });

    it('retries job, increments attempts, clears errors, and resets to AWAITING_WORKER', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      // Simulate failure first
      manifest.status = ShotStatus.FAILED;
      manifest.error = 'CUDA Out Of Memory';
      fs.writeFileSync(
        path.join(q.ticketsDir, `${manifest.ticketId}.json`),
        JSON.stringify(manifest),
        'utf-8',
      );

      const retried = retryColabJob(shotDir, manifest.ticketId, q);
      expect(retried).not.toBeNull();
      expect(retried?.status).toBe(ShotStatus.AWAITING_WORKER);
      expect(retried?.attempts).toBe(2);
      expect(retried?.error).toBeUndefined();

      const statusData = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
      expect(statusData.status).toBe(ShotStatus.AWAITING_WORKER);
      expect(statusData.attempts).toBe(2);
      expect(statusData.lastError).toBeUndefined();
    });
  });
});
