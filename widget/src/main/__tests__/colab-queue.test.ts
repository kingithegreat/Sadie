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
  listColabJobs,
  cancelColabJob,
  retryColabJob,
} from '../movie/colab-queue';
import type { GenerationRequest } from '../movie/types';
import { ShotStatus } from '../movie/types';

describe('Colab Worker Queue & Portable Job Manifests', () => {
  let tmpDir: string;
  let queueDir: string;
  let projectDir: string;
  let shotDir: string;
  let sampleRefImg: string;

  beforeEach(() => {
    mockOnline = true;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-queue-test-'));
    queueDir = path.join(tmpDir, 'mock_drive_queue');
    projectDir = path.join(tmpDir, 'project');
    shotDir = path.join(projectDir, 'scenes', 'scene_01', 'shot_001');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ projectId: 'project' }));
    fs.writeFileSync(
      path.join(projectDir, 'scenes', 'scene_01', 'scene.json'),
      JSON.stringify({ sceneId: 'scene_01', shots: ['shot_001'] }),
    );

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
      expect(savedTicket.attemptId).toMatch(/^attempt_1_/);
      expect(savedTicket.relativeOutputPath).toBe(
        `outputs/${manifest.jobId}/${savedTicket.attemptId}/shot_001.png`,
      );

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
        for (const file of [
          path.join(shotDir, 'ticket.json'),
          path.join(q.ticketsDir, `${manifest.ticketId}.json`),
          path.join(q.ticketsDir, `${manifest.jobId}.json`),
        ]) {
          expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({
            status: ShotStatus.FAILED,
            attemptId: manifest.attemptId,
          });
        }
        expect(listColabJobs(projectDir, q)[0]).toMatchObject({ status: ShotStatus.FAILED, canRetry: true });
      }
    });

    it('preserves the last-good image when worker bytes change during the copy', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const output = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, movieImageFixture);
      const lastGood = path.join(shotDir, 'image', 'shot_001.png');
      fs.mkdirSync(path.dirname(lastGood), { recursive: true });
      fs.writeFileSync(lastGood, movieImageFixture);

      const rawFs = require('fs') as typeof fs;
      const originalCopy = rawFs.copyFileSync;
      (rawFs as any).copyFileSync = (source: fs.PathLike, target: fs.PathLike) => {
        if (path.resolve(String(source)) === path.resolve(output) && path.basename(String(target)).startsWith('.')) {
          fs.writeFileSync(target, Buffer.from('worker changed this file mid-copy'));
          return;
        }
        return originalCopy(source, target);
      };
      let result;
      try {
        result = checkAndIngestColabResult(shotDir, manifest.ticketId, q);
      } finally {
        (rawFs as any).copyFileSync = originalCopy;
      }

      expect(result).toMatchObject({ status: 'failed' });
      expect(fs.existsSync(lastGood)).toBe(true);
      expect(fs.readFileSync(lastGood)).toEqual(movieImageFixture);
      expect(fs.readdirSync(path.dirname(lastGood)).some(name => name.endsWith('.tmp'))).toBe(false);
      expect(listColabJobs(projectDir, q)[0]).toMatchObject({ status: ShotStatus.FAILED, canRetry: true });
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
      expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'ticket.json'), 'utf-8')).status).toBe(ShotStatus.FAILED);
      expect(listColabJobs(projectDir, q)[0]).toMatchObject({ status: ShotStatus.FAILED, canRetry: true });
    });

    it('fails closed for traversal IDs and a ticket copied into the wrong shot', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const otherShot = path.join(projectDir, 'scenes', 'scene_01', 'shot_other');
      fs.mkdirSync(otherShot);
      fs.copyFileSync(path.join(shotDir, 'ticket.json'), path.join(otherShot, 'ticket.json'));
      const output = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, movieImageFixture);

      expect(checkAndIngestColabResult(otherShot, manifest.ticketId, q)).toEqual({
        status: 'pending', ticketId: manifest.ticketId,
      });
      expect(fs.existsSync(path.join(otherShot, 'image', 'shot_001.png'))).toBe(false);
      fs.unlinkSync(path.join(otherShot, 'ticket.json'));
      expect(checkAndIngestColabResult(otherShot, '../ticket', q)).toEqual({
        status: 'pending', ticketId: '../ticket',
      });
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
    it('lists only manifest-declared project tickets with action flags and output readiness', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const hiddenDir = path.join(projectDir, 'scenes', 'scene_01', 'not_in_scene_manifest');
      fs.mkdirSync(hiddenDir);
      fs.writeFileSync(path.join(hiddenDir, 'ticket.json'), JSON.stringify({ ...manifest, shotId: 'not_in_scene_manifest', shotDir: hiddenDir }));

      expect(listColabJobs(projectDir, q)).toEqual([
        expect.objectContaining({
          ticketId: manifest.ticketId,
          sceneId: 'scene_01',
          shotId: 'shot_001',
          attempts: 1,
          status: ShotStatus.AWAITING_WORKER,
          outputReady: false,
          canCancel: true,
          canRetry: false,
        }),
      ]);

      const output = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, Buffer.from('not a decodable image'));
      expect(listColabJobs(projectDir, q)[0].outputReady).toBe(false);
      fs.writeFileSync(output, movieImageFixture);
      expect(listColabJobs(projectDir, q)[0].outputReady).toBe(true);
    });

    it('cancels pending job in queue and resets shot status to PLANNED', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);

      const rawFs = require('fs') as typeof fs;
      const originalRename = rawFs.renameSync;
      const manifestRenames: Array<[fs.PathLike, fs.PathLike]> = [];
      (rawFs as any).renameSync = (temporary: fs.PathLike, target: fs.PathLike) => {
        if (path.basename(String(temporary)).startsWith('.colab-manifest-')) {
          manifestRenames.push([temporary, target]);
        }
        return originalRename(temporary, target);
      };
      try {
        cancelColabJob({ projectDir, ticketId: manifest.ticketId }, q);
      } finally {
        (rawFs as any).renameSync = originalRename;
      }

      expect(manifestRenames).toHaveLength(3);
      for (const [temporary, target] of manifestRenames) {
        expect(path.dirname(String(temporary))).toBe(path.dirname(String(target)));
      }
      expect(fs.readdirSync(q.ticketsDir).some(name => name.startsWith('.colab-manifest-'))).toBe(false);
      expect(fs.readdirSync(shotDir).some(name => name.startsWith('.colab-manifest-'))).toBe(false);

      for (const filename of [`${manifest.ticketId}.json`, `${manifest.jobId}.json`]) {
        const savedTicket = JSON.parse(fs.readFileSync(path.join(q.ticketsDir, filename), 'utf-8'));
        expect(savedTicket.status).toBe('CANCELLED');
      }
      expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'ticket.json'), 'utf-8')).status).toBe('CANCELLED');

      const statusData = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
      expect(statusData.status).toBe(ShotStatus.PLANNED);
      expect(statusData.deferredTicket).toBeUndefined();
      expect(() => cancelColabJob({ projectDir, ticketId: manifest.ticketId }, q)).toThrow(/only a pending/i);
    });

    it('ignores a result that arrives after its pending ticket was cancelled', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      cancelColabJob({ projectDir, ticketId: manifest.ticketId }, q);
      const output = path.join(q.rootDir, manifest.relativeOutputPath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, movieImageFixture);
      // A notebook that loaded the ticket before cancellation may write a
      // stale completion back afterward. Local cancellation is the tombstone.
      const staleCompletion = { ...manifest, status: ShotStatus.IMAGE_GENERATED };
      fs.writeFileSync(path.join(q.ticketsDir, `${manifest.ticketId}.json`), JSON.stringify(staleCompletion));
      fs.writeFileSync(path.join(q.ticketsDir, `${manifest.jobId}.json`), JSON.stringify(staleCompletion));

      expect(checkAndIngestColabResult(shotDir, manifest.ticketId, q)).toEqual({
        status: 'cancelled', ticketId: manifest.ticketId,
      });
      expect(fs.existsSync(path.join(shotDir, 'image', 'shot_001.png'))).toBe(false);
      expect(listColabJobs(projectDir, q)[0]).toMatchObject({
        status: 'CANCELLED', outputReady: false, canRetry: true,
      });
    });

    it('keeps a maximum-length valid shot ticket manageable by list and cancel', () => {
      const q = discoverDriveQueue(queueDir);
      const longShotId = `s${'a'.repeat(127)}`;
      const longShotDir = path.join(projectDir, 'scenes', 'scene_01', longShotId);
      fs.mkdirSync(longShotDir);
      fs.writeFileSync(
        path.join(projectDir, 'scenes', 'scene_01', 'scene.json'),
        JSON.stringify({ sceneId: 'scene_01', shots: [longShotId] }),
      );

      const manifest = stageColabJob(baseReq({ shotId: longShotId, shotDir: longShotDir }), q);
      expect(manifest.ticketId.length).toBeGreaterThan(128);
      expect(listColabJobs(projectDir, q)).toEqual([
        expect.objectContaining({ ticketId: manifest.ticketId, shotId: longShotId, canCancel: true }),
      ]);

      cancelColabJob({ projectDir, ticketId: manifest.ticketId }, q);
      expect(listColabJobs(projectDir, q)[0]).toMatchObject({ status: 'CANCELLED', canRetry: true });
    });

    it('retries job, increments attempts, clears errors, and resets to AWAITING_WORKER', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const firstAttemptId = manifest.attemptId;
      const firstOutputPath = manifest.relativeOutputPath;
      const firstOutput = path.join(q.rootDir, firstOutputPath);
      fs.mkdirSync(path.dirname(firstOutput), { recursive: true });
      fs.writeFileSync(firstOutput, movieImageFixture);
      const lastGoodImage = path.join(shotDir, 'image', 'shot_001.png');
      fs.mkdirSync(path.dirname(lastGoodImage), { recursive: true });
      fs.writeFileSync(lastGoodImage, movieImageFixture);

      // Simulate failure first
      manifest.status = ShotStatus.FAILED;
      manifest.error = 'CUDA Out Of Memory';
      for (const file of [
        path.join(q.ticketsDir, `${manifest.ticketId}.json`),
        path.join(q.ticketsDir, `${manifest.jobId}.json`),
        path.join(shotDir, 'ticket.json'),
      ]) fs.writeFileSync(file, JSON.stringify(manifest), 'utf-8');

      const retried = retryColabJob({ projectDir, ticketId: manifest.ticketId }, q);
      expect(retried.status).toBe(ShotStatus.AWAITING_WORKER);
      expect(retried.attempts).toBe(2);
      expect(retried.error).toBeUndefined();

      const statusData = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
      expect(statusData.status).toBe(ShotStatus.AWAITING_WORKER);
      expect(statusData.attempts).toBe(2);
      expect(statusData.lastError).toBeUndefined();

      for (const filename of [`${manifest.ticketId}.json`, `${manifest.jobId}.json`]) {
        const saved = JSON.parse(fs.readFileSync(path.join(q.ticketsDir, filename), 'utf-8'));
        expect(saved.status).toBe(ShotStatus.AWAITING_WORKER);
        expect(saved.attempts).toBe(2);
        expect(saved.attemptId).not.toBe(firstAttemptId);
        expect(saved.relativeOutputPath).not.toBe(firstOutputPath);
        expect(saved.relativeOutputPath).toContain(`/attempt_2_`);
      }
      expect(fs.existsSync(firstOutput)).toBe(true);
      expect(fs.existsSync(lastGoodImage)).toBe(true);
      expect(() => cancelColabJob({
        projectDir, ticketId: manifest.ticketId, expectedAttempts: 1,
      }, q)).toThrow(/changed.*refresh/i);
      expect(() => retryColabJob({ projectDir, ticketId: manifest.ticketId }, q)).toThrow(/only a failed or cancelled/i);
    });

    it.each(['ticket', 'job'] as const)(
      'ignores an old worker completion written to only the %s alias after cancel then retry',
      alias => {
        const q = discoverDriveQueue(queueDir);
        const first = stageColabJob(baseReq(), q);
        const oldOutput = path.join(q.rootDir, first.relativeOutputPath);
        cancelColabJob({ projectDir, ticketId: first.ticketId }, q);
        const current = retryColabJob({ projectDir, ticketId: first.ticketId }, q);
        expect(current.attempts).toBe(2);

        fs.mkdirSync(path.dirname(oldOutput), { recursive: true });
        fs.writeFileSync(oldOutput, movieImageFixture);
        const lastGoodImage = path.join(shotDir, 'image', 'shot_001.png');
        fs.mkdirSync(path.dirname(lastGoodImage), { recursive: true });
        fs.writeFileSync(lastGoodImage, movieImageFixture);
        const staleCompletion = { ...first, status: ShotStatus.IMAGE_GENERATED };
        const staleAlias = alias === 'ticket' ? first.ticketId : first.jobId;
        fs.writeFileSync(path.join(q.ticketsDir, `${staleAlias}.json`), JSON.stringify(staleCompletion));

        expect(listColabJobs(projectDir, q)).toEqual([
          expect.objectContaining({
            ticketId: first.ticketId,
            attempts: 2,
            status: ShotStatus.AWAITING_WORKER,
            outputReady: false,
            canCancel: true,
          }),
        ]);
        expect(checkAndIngestColabResult(shotDir, first.ticketId, q)).toEqual({
          status: 'pending', ticketId: first.ticketId,
        });
        expect(fs.readFileSync(lastGoodImage)).toEqual(movieImageFixture);
        expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'ticket.json'), 'utf-8'))).toMatchObject({
          attempts: 2,
          status: ShotStatus.AWAITING_WORKER,
        });
      },
    );

    it.each(['ticket', 'job'] as const)(
      'accepts the current attempt when only the %s alias reports completion',
      alias => {
        const q = discoverDriveQueue(queueDir);
        const manifest = stageColabJob(baseReq(), q);
        const output = path.join(q.rootDir, manifest.relativeOutputPath);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, movieImageFixture);
        const completed = { ...manifest, status: ShotStatus.IMAGE_GENERATED };
        const completedAlias = alias === 'ticket' ? manifest.ticketId : manifest.jobId;
        fs.writeFileSync(path.join(q.ticketsDir, `${completedAlias}.json`), JSON.stringify(completed));

        expect(checkAndIngestColabResult(shotDir, manifest.ticketId, q).status).toBe('imported');
        for (const file of [
          path.join(q.ticketsDir, `${manifest.ticketId}.json`),
          path.join(q.ticketsDir, `${manifest.jobId}.json`),
          path.join(shotDir, 'ticket.json'),
        ]) {
          expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({
            attemptId: manifest.attemptId,
            status: ShotStatus.IMAGE_GENERATED,
          });
        }
      },
    );

    it('upgrades a legacy failed manifest to an attempt-scoped output path on retry', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const legacy = {
        ...manifest,
        status: ShotStatus.FAILED,
        error: 'legacy failure',
        relativeOutputPath: `outputs/${manifest.jobId}/${manifest.shotId}.png`,
      } as any;
      delete legacy.attemptId;
      for (const file of [
        path.join(q.ticketsDir, `${manifest.ticketId}.json`),
        path.join(q.ticketsDir, `${manifest.jobId}.json`),
        path.join(shotDir, 'ticket.json'),
      ]) fs.writeFileSync(file, JSON.stringify(legacy));

      const retried = retryColabJob({ projectDir, ticketId: manifest.ticketId }, q);
      expect(retried).toMatchObject({ status: ShotStatus.AWAITING_WORKER, attempts: 2 });
      const saved = JSON.parse(fs.readFileSync(path.join(shotDir, 'ticket.json'), 'utf-8'));
      expect(saved.attemptId).toMatch(/^attempt_2_/);
      expect(saved.relativeOutputPath).toBe(`outputs/${manifest.jobId}/${saved.attemptId}/shot_001.png`);
    });

    it('refuses retry while Online is off without changing either alias', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      manifest.status = ShotStatus.FAILED;
      manifest.error = 'worker failed';
      for (const filename of [`${manifest.ticketId}.json`, `${manifest.jobId}.json`]) {
        fs.writeFileSync(path.join(q.ticketsDir, filename), JSON.stringify(manifest));
      }
      fs.writeFileSync(path.join(shotDir, 'ticket.json'), JSON.stringify(manifest));
      mockOnline = false;

      expect(() => retryColabJob({ projectDir, ticketId: manifest.ticketId }, q)).toThrow(/online access/i);
      for (const filename of [`${manifest.ticketId}.json`, `${manifest.jobId}.json`]) {
        expect(JSON.parse(fs.readFileSync(path.join(q.ticketsDir, filename), 'utf-8')).status).toBe(ShotStatus.FAILED);
      }
    });

    it('rejects stale attempts, traversal IDs, cross-project tickets, and untrusted project paths', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      expect(() => cancelColabJob({ projectDir, ticketId: manifest.ticketId, expectedAttempts: 99 }, q)).toThrow(/changed.*refresh/i);
      expect(() => cancelColabJob({ projectDir, ticketId: '../ticket' }, q)).toThrow(/invalid/i);
      expect(() => cancelColabJob({ projectDir, ticketId: `colab_ticket_${'a'.repeat(228)}` }, q)).toThrow(/invalid/i);
      expect(() => stageColabJob(baseReq({ shotId: `s${'a'.repeat(128)}` }), q)).toThrow(/shot ID.*safe/i);

      const otherProject = path.join(tmpDir, 'other-project');
      const otherShot = path.join(otherProject, 'scenes', 'scene_01', 'shot_001');
      fs.mkdirSync(otherShot, { recursive: true });
      fs.writeFileSync(path.join(otherProject, 'project.json'), '{}');
      fs.writeFileSync(path.join(otherProject, 'scenes', 'scene_01', 'scene.json'), JSON.stringify({ sceneId: 'scene_01', shots: ['shot_001'] }));
      fs.copyFileSync(path.join(shotDir, 'ticket.json'), path.join(otherShot, 'ticket.json'));
      expect(listColabJobs(otherProject, q)).toEqual([]);
      expect(() => cancelColabJob({ projectDir: otherProject, ticketId: manifest.ticketId }, q)).toThrow(/does not belong/i);
      expect(() => listColabJobs(path.parse(os.homedir()).root, q)).toThrow(/inside your user folder/i);
    });

    it('derives the shot directory from scene.json instead of accepting a renderer path', () => {
      const q = discoverDriveQueue(queueDir);
      const manifest = stageColabJob(baseReq(), q);
      const unrelated = path.join(tmpDir, 'unrelated');
      fs.mkdirSync(unrelated);
      fs.writeFileSync(path.join(unrelated, 'status.json'), JSON.stringify({ status: ShotStatus.AWAITING_WORKER }));

      cancelColabJob({ projectDir, ticketId: manifest.ticketId, shotDir: unrelated } as any, q);
      expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8')).status).toBe(ShotStatus.PLANNED);
      expect(JSON.parse(fs.readFileSync(path.join(unrelated, 'status.json'), 'utf-8')).status).toBe(ShotStatus.AWAITING_WORKER);
    });
  });
});
