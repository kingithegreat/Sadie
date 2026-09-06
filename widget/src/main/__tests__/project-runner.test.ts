import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
    fs.writeFileSync(outFile, 'fake-media-content', 'utf-8');
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
          fs.writeFileSync(outFile, 'x');
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
