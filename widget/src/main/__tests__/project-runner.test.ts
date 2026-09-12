import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { movieImageFixture } from './helpers/movie-image';
jest.mock('electron', () => ({ nativeImage: require('./helpers/movie-image').movieNativeImageStub }));
import {
  MovieProjectRunner,
  createStandardRouter,
  MovieProject,
  SceneManifest,
} from '../movie/project-runner';
import { GenerationRouter } from '../movie/router';
import type {
  CharacterBibleEntry,
  GenerationCapability,
  GenerationProvider,
  ShotBibleEntry,
} from '../movie/types';
import { ShotStatus } from '../movie/types';

const mockProvider = (
  id: string,
  overrides: Partial<GenerationCapability> = {},
): GenerationProvider => ({
  id,
  kind: 'both',
  probe: async () => ({
    canGenerate: true,
    costMicroUsd: 0,
    maxDurationSec: 60,
    maxWidth: 1920,
    maxHeight: 1080,
    imageToVideo: true,
    referenceImages: 'multi',
    watermark: 'none',
    availability: 'ready',
    deferred: false,
    ...overrides,
  }),
  generate: async (req) => {
    const ext = req.kind === 'video' ? 'mp4' : 'png';
    const outFile = path.join(req.shotDir, `${req.shotId}_out.${ext}`);
    fs.mkdirSync(req.shotDir, { recursive: true });
    fs.writeFileSync(outFile, req.kind === 'image' ? movieImageFixture : Buffer.from('fake-video-content'));
    return {
      status: 'done',
      provider: id,
      files: [outFile],
      costMicroUsd: 0,
    };
  },
});

describe('MovieProjectRunner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-runner-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const sampleProject: MovieProject = {
    projectId: 'imhotep-temple-01',
    name: 'Imhotep Approaches the Temple',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    freeOnly: true,
    defaultResolution: [1024, 576],
    defaultDurationSec: 8,
    notes: 'Golden hour test sequence',
  };

  const sampleCharacter: CharacterBibleEntry = {
    id: 'imhotep',
    name: 'Imhotep',
    age: '40s',
    face: 'olive skin, dark eyes, angular jaw',
    hair: 'black, tied back',
    clothing: 'white linen robes with thin gold trim',
    body: 'lean, athletic',
    voice: 'deep, measured',
    personality: 'wise, calm',
    visualReferences: ['characters/imhotep/ref_01.png'],
    consistencyNotes: ['eyes are dark brown, never blue'],
    revision: 1,
    updatedAt: new Date().toISOString(),
  };

  const sampleScene: SceneManifest = {
    sceneId: 'scene_01',
    title: 'Approach at Golden Hour',
    description: 'Imhotep walks toward the temple entrance',
    order: 1,
    shots: ['shot_001', 'shot_002'],
  };

  const sampleShots: ShotBibleEntry[] = [
    {
      shotId: 'shot_001',
      scene: 'scene_01',
      characters: ['imhotep'],
      action: 'Establishing wide shot of Karnak temple entrance at golden hour',
      camera: { framing: 'wide', lens: '24mm', movement: 'slow pan right' },
      lighting: 'Warm low directional sunlight',
      durationSec: 8,
      visualReferences: ['characters/imhotep/ref_01.png'],
      generationMethod: 'still',
      status: ShotStatus.PLANNED,
    },
    {
      shotId: 'shot_002',
      scene: 'scene_01',
      characters: ['imhotep'],
      action: 'Imhotep walking between towering carved columns with hieroglyphs',
      camera: { framing: 'medium', lens: '50mm', movement: 'tracking forward' },
      lighting: 'Long shadows between columns',
      durationSec: 8,
      visualReferences: ['characters/imhotep/ref_01.png'],
      generationMethod: 'image_to_animation',
      status: ShotStatus.PLANNED,
    },
  ];

  describe('createProject and addScene', () => {
    it('sets up the directory structure and files per MOVIE_PROJECT_STRUCTURE.md', () => {
      MovieProjectRunner.createProject(tmpDir, sampleProject, [sampleCharacter]);

      expect(fs.existsSync(path.join(tmpDir, 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'characters', 'imhotep.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'scenes'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'render'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(true);

      MovieProjectRunner.addScene(tmpDir, sampleScene, sampleShots);

      const sceneDir = path.join(tmpDir, 'scenes', 'scene_01');
      expect(fs.existsSync(path.join(sceneDir, 'scene.json'))).toBe(true);

      for (const shot of sampleShots) {
        const shotDir = path.join(sceneDir, shot.shotId);
        expect(fs.existsSync(path.join(shotDir, 'prompt.json'))).toBe(true);
        expect(fs.existsSync(path.join(shotDir, 'status.json'))).toBe(true);

        const status = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
        expect(status.status).toBe(ShotStatus.PLANNED);
      }
    });
  });

  describe('runProject execution & resumption', () => {
    it('executes shots and logs decisions to router-decisions.jsonl', async () => {
      MovieProjectRunner.createProject(tmpDir, sampleProject, [sampleCharacter]);
      MovieProjectRunner.addScene(tmpDir, sampleScene, sampleShots);

      const router = new GenerationRouter().register(mockProvider('mock-engine'));

      const report = await MovieProjectRunner.runProject(tmpDir, { router });
      expect(report.totalShots).toBe(2);
      expect(report.completedShots).toBe(2);
      expect(report.failedShots).toBe(0);

      // Verify status.json updated
      const s1 = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'scenes', 'scene_01', 'shot_001', 'status.json'), 'utf-8'),
      );
      expect(s1.status).toBe(ShotStatus.IMAGE_GENERATED);

      const s2 = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'scenes', 'scene_01', 'shot_002', 'status.json'), 'utf-8'),
      );
      expect(s2.status).toBe(ShotStatus.VIDEO_GENERATED);

      // Verify shotDir decision.json
      const shot1DecisionPath = path.join(tmpDir, 'scenes', 'scene_01', 'shot_001', 'decision.json');
      expect(fs.existsSync(shot1DecisionPath)).toBe(true);
      const shot1Decision = JSON.parse(fs.readFileSync(shot1DecisionPath, 'utf-8'));
      expect(shot1Decision.shotId).toBe('shot_001');
      expect(shot1Decision.chosen).toBe('mock-engine');
      expect(shot1Decision.resultStatus).toBe('done');

      // Verify audit log
      const logPath = path.join(tmpDir, 'logs', 'router-decisions.jsonl');
      expect(fs.existsSync(logPath)).toBe(true);
      const logLines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      expect(logLines.length).toBe(2);
      const parsedLog1 = JSON.parse(logLines[0]);
      expect(parsedLog1.shotId).toBe('shot_001');
      expect(parsedLog1.chosen).toBe('mock-engine');
    });

    it('skips already generated shots on resumption (crash recovery)', async () => {
      MovieProjectRunner.createProject(tmpDir, sampleProject, [sampleCharacter]);
      MovieProjectRunner.addScene(tmpDir, sampleScene, sampleShots);

      let generateCalls = 0;
      const countingProvider: GenerationProvider = {
        ...mockProvider('mock-engine'),
        generate: async (req) => {
          generateCalls++;
          const outFile = path.join(req.shotDir, `${req.shotId}.png`);
          fs.writeFileSync(outFile, movieImageFixture);
          return { status: 'done', provider: 'mock-engine', files: [outFile], costMicroUsd: 0 };
        },
      };

      const router = new GenerationRouter().register(countingProvider);

      // First run: executes both
      const rep1 = await MovieProjectRunner.runProject(tmpDir, { router });
      expect(rep1.completedShots).toBe(2);
      expect(generateCalls).toBe(2);

      // Second run: skips both
      const rep2 = await MovieProjectRunner.runProject(tmpDir, { router });
      expect(rep2.skippedShots).toBe(2);
      expect(generateCalls).toBe(2); // No new calls!
    });

    it('ingests completed Colab worker results from the Drive queue on resumption', async () => {
      MovieProjectRunner.createProject(tmpDir, sampleProject, [sampleCharacter]);
      MovieProjectRunner.addScene(tmpDir, sampleScene, [sampleShots[0]]);

      const shotDir = path.join(tmpDir, 'scenes', 'scene_01', 'shot_001');
      const queueDir = path.join(tmpDir, 'mock_queue');
      process.env.HOMEBOT_COLAB_QUEUE = queueDir;

      try {
        // Stage a deferred ticket
        const ticketId = 'colab_ticket_shot_001_12345678';
        const manifest = {
          version: '1.0',
          jobId: '12345678',
          ticketId,
          createdAt: new Date().toISOString(),
          shotId: 'shot_001',
          shotDir,
          prompt: 'test prompt',
          width: 1024,
          height: 576,
          stagedCharacterRefs: [],
          relativeOutputPath: 'outputs/12345678/shot_001.png',
          status: ShotStatus.AWAITING_WORKER,
          attempts: 1,
        };

        // Write ticket in queue and shot directory
        fs.mkdirSync(path.join(queueDir, 'tickets'), { recursive: true });
        fs.writeFileSync(
          path.join(queueDir, 'tickets', `${ticketId}.json`),
          JSON.stringify(manifest, null, 2),
        );
        fs.writeFileSync(path.join(shotDir, 'ticket.json'), JSON.stringify(manifest, null, 2));

        // Mark shot as AWAITING_WORKER
        const statusData = {
          shotId: 'shot_001',
          status: ShotStatus.AWAITING_WORKER,
          deferredTicket: ticketId,
          deferredProvider: 'colab-worker',
          attempts: 1,
          characterRevisions: {},
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(shotDir, 'status.json'), JSON.stringify(statusData, null, 2));

        // Simulate Colab worker producing the completed image
        const outImg = path.join(queueDir, 'outputs', '12345678', 'shot_001.png');
        fs.mkdirSync(path.dirname(outImg), { recursive: true });
        fs.writeFileSync(outImg, movieImageFixture);

        // Run project runner
        const router = new GenerationRouter().register(mockProvider('mock-engine'));
        const report = await MovieProjectRunner.runProject(tmpDir, { router });

        expect(report.completedShots).toBe(1);
        expect(report.deferredShots).toBe(0);

        // Image should be imported into shotDir/image/shot_001.png
        const importedImg = path.join(shotDir, 'image', 'shot_001.png');
        expect(fs.existsSync(importedImg)).toBe(true);
        expect(fs.readFileSync(importedImg)).toEqual(movieImageFixture);

        // status.json should be IMAGE_GENERATED
        const finalStatus = JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf-8'));
        expect(finalStatus.status).toBe(ShotStatus.IMAGE_GENERATED);
        expect(finalStatus.outputFiles).toEqual([path.join('image', 'shot_001.png')]);
      } finally {
        delete process.env.HOMEBOT_COLAB_QUEUE;
      }
    });

    it('handles partial results: ingests finished shot and preserves pending shot', async () => {
      MovieProjectRunner.createProject(tmpDir, sampleProject, [sampleCharacter]);
      MovieProjectRunner.addScene(tmpDir, sampleScene, sampleShots);

      const shot1Dir = path.join(tmpDir, 'scenes', 'scene_01', 'shot_001');
      const shot2Dir = path.join(tmpDir, 'scenes', 'scene_01', 'shot_002');
      const queueDir = path.join(tmpDir, 'mock_queue_partial');
      process.env.HOMEBOT_COLAB_QUEUE = queueDir;

      try {
        fs.mkdirSync(path.join(queueDir, 'tickets'), { recursive: true });

        // Ticket 1: finished
        const t1 = 'colab_ticket_shot_001_aaa';
        const m1 = {
          version: '1.0',
          jobId: 'aaa',
          ticketId: t1,
          createdAt: new Date().toISOString(),
          shotId: 'shot_001',
          shotDir: shot1Dir,
          prompt: 'shot 1',
          width: 1024,
          height: 576,
          stagedCharacterRefs: [],
          relativeOutputPath: 'outputs/aaa/shot_001.png',
          status: ShotStatus.AWAITING_WORKER,
          attempts: 1,
        };
        fs.writeFileSync(path.join(queueDir, 'tickets', `${t1}.json`), JSON.stringify(m1));
        fs.writeFileSync(path.join(shot1Dir, 'ticket.json'), JSON.stringify(m1));
        fs.writeFileSync(
          path.join(shot1Dir, 'status.json'),
          JSON.stringify({
            shotId: 'shot_001',
            status: ShotStatus.AWAITING_WORKER,
            deferredTicket: t1,
            deferredProvider: 'colab-worker',
            attempts: 1,
            characterRevisions: {},
          }),
        );
        const out1 = path.join(queueDir, 'outputs', 'aaa', 'shot_001.png');
        fs.mkdirSync(path.dirname(out1), { recursive: true });
        fs.writeFileSync(out1, movieImageFixture);

        // Ticket 2: still pending (no output in queue)
        const t2 = 'colab_ticket_shot_002_bbb';
        const m2 = {
          version: '1.0',
          jobId: 'bbb',
          ticketId: t2,
          createdAt: new Date().toISOString(),
          shotId: 'shot_002',
          shotDir: shot2Dir,
          prompt: 'shot 2',
          width: 1024,
          height: 576,
          stagedCharacterRefs: [],
          relativeOutputPath: 'outputs/bbb/shot_002.png',
          status: ShotStatus.AWAITING_WORKER,
          attempts: 1,
        };
        fs.writeFileSync(path.join(queueDir, 'tickets', `${t2}.json`), JSON.stringify(m2));
        fs.writeFileSync(path.join(shot2Dir, 'ticket.json'), JSON.stringify(m2));
        fs.writeFileSync(
          path.join(shot2Dir, 'status.json'),
          JSON.stringify({
            shotId: 'shot_002',
            status: ShotStatus.AWAITING_WORKER,
            deferredTicket: t2,
            deferredProvider: 'colab-worker',
            attempts: 1,
            characterRevisions: {},
          }),
        );

        const router = new GenerationRouter().register(mockProvider('mock-engine'));
        const report = await MovieProjectRunner.runProject(tmpDir, { router });

        // Shot 1 finished, Shot 2 remains deferred
        expect(report.completedShots).toBe(1);
        expect(report.deferredShots).toBe(1);

        const s1 = JSON.parse(fs.readFileSync(path.join(shot1Dir, 'status.json'), 'utf-8'));
        expect(s1.status).toBe(ShotStatus.IMAGE_GENERATED);

        const s2 = JSON.parse(fs.readFileSync(path.join(shot2Dir, 'status.json'), 'utf-8'));
        expect(s2.status).toBe(ShotStatus.AWAITING_WORKER);
      } finally {
        delete process.env.HOMEBOT_COLAB_QUEUE;
      }
    });
  });

  describe('createStandardRouter', () => {
    it('registers all 5 standard providers', () => {
      const router = createStandardRouter();
      const list = router.list();
      const ids = list.map((p) => p.id);
      expect(ids).toContain('ancient-pathways');
      expect(ids).toContain('colab-worker');
      expect(ids).toContain('pollinations');
      expect(ids).toContain('imagen-3');
      expect(ids).toContain('local-sd15');
    });
  });
});
