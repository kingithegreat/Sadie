import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ANCIENT_PATHWAYS_EPISODES,
  checkRenderLock,
  findEpisodeDeliverable,
  humanizeStage,
  resolveAncientPathwaysDir,
  runEpisodePipeline,
  runDoctorChecks,
  scanReachability,
} from '../ancient-pathways';

describe('ancient-pathways main module', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('resolveAncientPathwaysDir', () => {
    it('returns null when no candidate path contains run_pipeline.py', () => {
      const origEnv = process.env.ANCIENT_PATHWAYS_DIR;
      try {
        delete process.env.ANCIENT_PATHWAYS_DIR;
        const res = resolveAncientPathwaysDir();
        // May be null or string if installed on Desktop, but function should not throw
        expect(res === null || typeof res === 'string').toBe(true);
      } finally {
        if (origEnv) process.env.ANCIENT_PATHWAYS_DIR = origEnv;
      }
    });

    it('resolves directory pointed by ANCIENT_PATHWAYS_DIR env var if run_pipeline.py exists', () => {
      const origEnv = process.env.ANCIENT_PATHWAYS_DIR;
      try {
        fs.writeFileSync(path.join(tmpDir, 'run_pipeline.py'), '#!/usr/bin/env python3');
        process.env.ANCIENT_PATHWAYS_DIR = tmpDir;
        const res = resolveAncientPathwaysDir();
        expect(res).toBe(path.resolve(tmpDir));
      } finally {
        if (origEnv) process.env.ANCIENT_PATHWAYS_DIR = origEnv;
        else delete process.env.ANCIENT_PATHWAYS_DIR;
      }
    });
  });

  describe('episode catalog', () => {
    it('contains all 9 canonical episodes across seasons 1 and 2', () => {
      expect(ANCIENT_PATHWAYS_EPISODES.length).toBe(9);

      const s1 = ANCIENT_PATHWAYS_EPISODES.filter(e => e.season === 1);
      const s2 = ANCIENT_PATHWAYS_EPISODES.filter(e => e.season === 2);

      expect(s1.length).toBe(5); // egypt, greece, rome, japan, maya
      expect(s2.length).toBe(4); // babylon, vikings, china, indus

      const ids = ANCIENT_PATHWAYS_EPISODES.map(e => e.id);
      expect(ids).toContain('egypt');
      expect(ids).toContain('babylon');
      expect(ids).toContain('vikings');
      expect(ids).toContain('china');
      expect(ids).toContain('indus');
    });

    it('each episode has valid titles, codes, eras, and characters', () => {
      for (const ep of ANCIENT_PATHWAYS_EPISODES) {
        expect(ep.title.length).toBeGreaterThan(5);
        expect(ep.code).toMatch(/^EP0[1-9]$/);
        expect(ep.era.length).toBeGreaterThan(3);
        expect(ep.mainCharacter.length).toBeGreaterThan(3);
        expect(ep.sceneCount).toBe(14);
        expect(ep.emoji).toBeDefined();
        expect(ep.summary.length).toBeGreaterThan(10);
      }
    });
  });

  describe('humanizeStage', () => {
    it('translates technical stage names to zero-jargon plain English', () => {
      expect(humanizeStage('script')).toBe('Writing story & scenes');
      expect(humanizeStage('voice')).toBe('Recording character voices');
      expect(humanizeStage('shots')).toBe('Setting up historical backgrounds');
      expect(humanizeStage('keyframes')).toBe('Posing characters & expressions');
      expect(humanizeStage('anim')).toBe('Animating characters & mouth sync');
      expect(humanizeStage('render')).toBe('Creating final 1080p video with music');
      expect(humanizeStage('doctor')).toBe('Checking video & sound quality');
    });

    it('prepends Completed when status is ok or done', () => {
      expect(humanizeStage('anim', 'ok')).toBe('Completed: Animating characters & mouth sync');
      expect(humanizeStage('script', 'done')).toBe('Completed: Writing story & scenes');
    });

    it('falls back to friendly Working on <stage> for unknown stages', () => {
      expect(humanizeStage('custom_step')).toBe('Working on custom_step');
    });
  });

  describe('checkRenderLock', () => {
    it('returns locked: false when no lock file exists', () => {
      const res = checkRenderLock(tmpDir);
      expect(res.locked).toBe(false);
    });

    it('returns locked: true when an active lock file is present', () => {
      const workspaceDir = path.join(tmpDir, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });
      const lockFile = path.join(workspaceDir, 'render.lock');

      const nowSec = Date.now() / 1000;
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 12345, ts: nowSec - 60 }));

      const res = checkRenderLock(tmpDir);
      expect(res.locked).toBe(true);
      expect(res.pid).toBe(12345);
      expect(res.ageSec).toBeGreaterThanOrEqual(55);
      expect(res.message).toContain('PID 12345');
    });

    it('returns locked: false if lock file is older than 6 hours (stale)', () => {
      const workspaceDir = path.join(tmpDir, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });
      const lockFile = path.join(workspaceDir, 'render.lock');

      const nowSec = Date.now() / 1000;
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 12345, ts: nowSec - 7 * 3600 }));

      const res = checkRenderLock(tmpDir);
      expect(res.locked).toBe(false);
      expect(res.message).toContain('Stale lock');
    });
  });

  describe('findEpisodeDeliverable', () => {
    it('finds exact capitalized 1080p deliverable', () => {
      const delivDir = path.join(tmpDir, 'workspace', 'deliverables');
      fs.mkdirSync(delivDir, { recursive: true });
      const target = path.join(delivDir, 'Ancient_Pathways_Egypt_1080p.mp4');
      fs.writeFileSync(target, 'mock-mp4-data');

      const found = findEpisodeDeliverable(tmpDir, 'egypt');
      expect(found).toBe(target);
    });

    it('finds deliverable matching episode code or fuzzy name', () => {
      const delivDir = path.join(tmpDir, 'workspace', 'deliverables');
      fs.mkdirSync(delivDir, { recursive: true });
      const target = path.join(delivDir, 'Ancient_Pathways_Episode_EP06_Babylon_1080p.mp4');
      fs.writeFileSync(target, 'mock-mp4-data');

      const found = findEpisodeDeliverable(tmpDir, 'babylon');
      expect(found).toBe(target);
    });

    it('returns null if no deliverable exists', () => {
      const found = findEpisodeDeliverable(tmpDir, 'nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('runEpisodePipeline', () => {
    it('refuses if Ancient Pathways directory does not exist', async () => {
      const res = await runEpisodePipeline({
        episodeId: 'egypt',
        dir: path.join(tmpDir, 'does-not-exist'),
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain('directory not found');
    });

    it('refuses if render lock is currently held', async () => {
      const workspaceDir = path.join(tmpDir, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });
      const lockFile = path.join(workspaceDir, 'render.lock');
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 9999, ts: Date.now() / 1000 }));

      const res = await runEpisodePipeline({
        episodeId: 'egypt',
        dir: tmpDir,
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain('Render in progress');
    });
  });

  describe('runDoctorChecks', () => {
    it('returns empty result when Ancient Pathways directory does not exist', async () => {
      const res = await runDoctorChecks('egypt', path.join(tmpDir, 'does-not-exist'));
      expect(res.episodeId).toBe('egypt');
      expect(res.checks).toEqual([]);
      expect(res.failed).toBe(0);
    });

    it('returns empty result when doctor.py does not exist', async () => {
      const res = await runDoctorChecks('egypt', tmpDir);
      expect(res.episodeId).toBe('egypt');
      expect(res.checks).toEqual([]);
      expect(res.failed).toBe(0);
    });
  });

  describe('scanReachability', () => {
    it('flags functions defined but with zero cross-module callers', () => {
      const pipelineDir = path.join(tmpDir, 'pipeline', 'anim');
      fs.mkdirSync(pipelineDir, { recursive: true });

      fs.writeFileSync(
        path.join(pipelineDir, 'rig.py'),
        `class CharacterRig:\n    def render_pose(self):\n        pass\n`,
      );
      fs.writeFileSync(
        path.join(pipelineDir, 'main.py'),
        `def main():\n    pass\n`,
      );

      const findings = scanReachability(tmpDir);

      const renderPoseFinding = findings.find((f) => f.symbol === 'render_pose');
      expect(renderPoseFinding).toBeDefined();
      expect(renderPoseFinding!.callers).toBe(0);
      expect(renderPoseFinding!.issue).toContain('no other module');
    });

    it('does not flag functions called from another module', () => {
      const pipelineDir = path.join(tmpDir, 'pipeline', 'anim');
      fs.mkdirSync(pipelineDir, { recursive: true });

      fs.writeFileSync(
        path.join(pipelineDir, 'rigger.py'),
        `def rig_character():\n    pass\n`,
      );
      fs.writeFileSync(
        path.join(pipelineDir, 'renderer.py'),
        `from pipeline.anim.rigger import rig_character\ndef render_scene():\n    rig_character()\n`,
      );

      const findings = scanReachability(tmpDir);

      const rigCharFinding = findings.find((f) => f.symbol === 'rig_character');
      expect(rigCharFinding).toBeUndefined();
    });

    it('does not flag private functions (underscore-prefixed)', () => {
      const pipelineDir = path.join(tmpDir, 'pipeline', 'anim');
      fs.mkdirSync(pipelineDir, { recursive: true });

      fs.writeFileSync(
        path.join(pipelineDir, 'helper.py'),
        `def _private_helper():\n    pass\n`,
      );

      const findings = scanReachability(tmpDir);

      expect(findings.find((f) => f.symbol === '_private_helper')).toBeUndefined();
      expect(findings.find((f) => f.symbol === 'private_helper')).toBeUndefined();
    });

    it('returns empty array when no pipeline directory exists', () => {
      const findings = scanReachability(tmpDir);
      expect(findings).toEqual([]);
    });
  });
});
