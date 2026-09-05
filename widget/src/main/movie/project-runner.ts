/**
 * project-runner.ts — Movie Project Runner & Orchestrator
 *
 * Implements the file-based movie project pipeline defined in MOVIE_PROJECT_STRUCTURE.md.
 *
 * Key Design Invariants:
 * 1. JSON ON DISK: Portable file tree surviving crashes mid-movie.
 * 2. CRASH RESILIENCE: status.json is written before and after generation.
 *    Re-running skips completed shots and resumes exactly where interrupted.
 * 3. AUDIT TRAIL: Every routing decision is appended as a single line to
 *    logs/router-decisions.jsonl.
 * 4. STANDARD ROUTER: Pre-registers all 5 providers (Ancient Pathways, Colab,
 *    Pollinations, Imagen 3, Local SD 1.5).
 */

import * as fs from 'fs';
import * as path from 'path';
import { GenerationRouter } from './router';
import type {
  CharacterBibleEntry,
  GenerationRequest,
  ShotBibleEntry,
  ShotJobState,
} from './types';
import { ShotStatus } from './types';
import { ancientPathwaysProvider } from './ancient-pathways-adapter';
import { colabProvider } from './colab-adapter';
import { pollinationsProvider } from './pollinations-adapter';
import { imagen3Provider } from './imagen3-adapter';
import { localSD15Provider } from './local-sd15-adapter';

export interface MovieProject {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  freeOnly: boolean;
  defaultResolution: [number, number];
  defaultDurationSec: number;
  notes?: string;
}

export interface SceneManifest {
  sceneId: string;
  title: string;
  description: string;
  order: number;
  shots: string[];
}

export interface ProjectRunnerOptions {
  allowDeferred?: boolean;
  freeOnly?: boolean;
  allowWatermark?: boolean;
  router?: GenerationRouter;
}

export interface ShotExecutionResult {
  shotId: string;
  sceneId: string;
  status: ShotStatus;
  provider: string;
  files?: string[];
  ticket?: string;
  error?: string;
}

export interface ProjectRunReport {
  projectId: string;
  totalShots: number;
  completedShots: number;
  deferredShots: number;
  failedShots: number;
  skippedShots: number;
  results: ShotExecutionResult[];
}

/**
 * Creates a GenerationRouter with all 5 standard providers registered.
 */
export function createStandardRouter(): GenerationRouter {
  return new GenerationRouter()
    .register(ancientPathwaysProvider)
    .register(colabProvider)
    .register(pollinationsProvider)
    .register(imagen3Provider)
    .register(localSD15Provider);
}

export class MovieProjectRunner {
  /**
   * Initializes a movie project folder structure on disk.
   */
  static createProject(
    projectDir: string,
    project: MovieProject,
    characters: CharacterBibleEntry[] = [],
  ): void {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'characters'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'scenes'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'render'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });

    // Write project.json
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );

    // Write character bible entries
    for (const char of characters) {
      fs.writeFileSync(
        path.join(projectDir, 'characters', `${char.id}.json`),
        JSON.stringify(char, null, 2),
        'utf-8',
      );
    }
  }

  /**
   * Adds a scene and its planned shots to the project.
   */
  static addScene(
    projectDir: string,
    scene: SceneManifest,
    shots: ShotBibleEntry[],
  ): void {
    const sceneDir = path.join(projectDir, 'scenes', scene.sceneId);
    fs.mkdirSync(sceneDir, { recursive: true });

    // Write scene.json
    fs.writeFileSync(
      path.join(sceneDir, 'scene.json'),
      JSON.stringify(scene, null, 2),
      'utf-8',
    );

    // Read project defaults
    let projectDefaults: Partial<MovieProject> = {};
    const projectPath = path.join(projectDir, 'project.json');
    if (fs.existsSync(projectPath)) {
      try {
        projectDefaults = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
      } catch {
        /* ignore */
      }
    }

    const defaultWidth = projectDefaults.defaultResolution?.[0] ?? 1024;
    const defaultHeight = projectDefaults.defaultResolution?.[1] ?? 576;
    const freeOnly = projectDefaults.freeOnly ?? true;

    // Initialize each shot folder
    for (const shot of shots) {
      const shotDir = path.join(sceneDir, shot.shotId);
      fs.mkdirSync(shotDir, { recursive: true });
      fs.mkdirSync(path.join(shotDir, 'image'), { recursive: true });
      fs.mkdirSync(path.join(shotDir, 'video'), { recursive: true });

      // Build GenerationRequest
      const req: GenerationRequest = {
        kind: shot.generationMethod === 'generative_video' || shot.generationMethod === 'image_to_animation'
          ? 'video'
          : 'image',
        prompt: shot.action,
        width: defaultWidth,
        height: defaultHeight,
        durationSec: shot.durationSec,
        characterRefs: shot.visualReferences,
        shotId: shot.shotId,
        shotDir,
        freeOnly,
        allowWatermark: false,
        allowDeferred: false,
      };

      fs.writeFileSync(
        path.join(shotDir, 'prompt.json'),
        JSON.stringify(req, null, 2),
        'utf-8',
      );

      // Initial state
      const state: ShotJobState = {
        shotId: shot.shotId,
        status: shot.status ?? ShotStatus.PLANNED,
        attempts: 0,
        characterRevisions: {},
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(shotDir, 'status.json'),
        JSON.stringify(state, null, 2),
        'utf-8',
      );
    }
  }

  /**
   * Executes or resumes generation for all scenes and shots in a project.
   */
  static async runProject(
    projectDir: string,
    options: ProjectRunnerOptions = {},
  ): Promise<ProjectRunReport> {
    const projectPath = path.join(projectDir, 'project.json');
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project metadata not found: ${projectPath}`);
    }

    const project: MovieProject = JSON.parse(
      fs.readFileSync(projectPath, 'utf-8'),
    );
    const router = options.router ?? createStandardRouter();
    const freeOnly = options.freeOnly ?? project.freeOnly;
    const allowDeferred = options.allowDeferred ?? false;
    const allowWatermark = options.allowWatermark ?? false;

    const scenesDir = path.join(projectDir, 'scenes');
    if (!fs.existsSync(scenesDir)) {
      return {
        projectId: project.projectId,
        totalShots: 0,
        completedShots: 0,
        deferredShots: 0,
        failedShots: 0,
        skippedShots: 0,
        results: [],
      };
    }

    const sceneFolders = fs.readdirSync(scenesDir).filter((f) => {
      return fs.statSync(path.join(scenesDir, f)).isDirectory();
    });

    // Read scene orders if scene.json exists
    sceneFolders.sort((a, b) => {
      try {
        const sa = JSON.parse(fs.readFileSync(path.join(scenesDir, a, 'scene.json'), 'utf-8'));
        const sb = JSON.parse(fs.readFileSync(path.join(scenesDir, b, 'scene.json'), 'utf-8'));
        return (sa.order ?? 0) - (sb.order ?? 0);
      } catch {
        return a.localeCompare(b);
      }
    });

    const report: ProjectRunReport = {
      projectId: project.projectId,
      totalShots: 0,
      completedShots: 0,
      deferredShots: 0,
      failedShots: 0,
      skippedShots: 0,
      results: [],
    };

    const logsDir = path.join(projectDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'router-decisions.jsonl');

    for (const sceneId of sceneFolders) {
      const sceneDir = path.join(scenesDir, sceneId);
      const shotFolders = fs.readdirSync(sceneDir).filter((f) => {
        return fs.statSync(path.join(sceneDir, f)).isDirectory();
      });

      for (const shotId of shotFolders) {
        report.totalShots++;
        const shotDir = path.join(sceneDir, shotId);
        const statusPath = path.join(shotDir, 'status.json');
        const promptPath = path.join(shotDir, 'prompt.json');

        let state: ShotJobState = {
          shotId,
          status: ShotStatus.PLANNED,
          attempts: 0,
          characterRevisions: {},
          updatedAt: new Date().toISOString(),
        };

        if (fs.existsSync(statusPath)) {
          try {
            state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
          } catch {
            /* ignore */
          }
        }

        // Check if already completed
        if (
          state.status === ShotStatus.IMAGE_GENERATED ||
          state.status === ShotStatus.VIDEO_GENERATED ||
          state.status === ShotStatus.APPROVED
        ) {
          report.completedShots++;
          report.skippedShots++;
          report.results.push({
            shotId,
            sceneId,
            status: state.status,
            provider: 'cached',
          });
          continue;
        }

        // Check if already awaiting worker and worker output arrived
        if (state.status === ShotStatus.AWAITING_WORKER) {
          const imgOut = path.join(shotDir, 'image', `${shotId}.png`);
          const vidOut = path.join(shotDir, 'video', `${shotId}.mp4`);
          if (fs.existsSync(imgOut) || fs.existsSync(vidOut)) {
            state.status = fs.existsSync(vidOut) ? ShotStatus.VIDEO_GENERATED : ShotStatus.IMAGE_GENERATED;
            state.updatedAt = new Date().toISOString();
            fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
            report.completedShots++;
            report.results.push({
              shotId,
              sceneId,
              status: state.status,
              provider: state.deferredProvider ?? 'colab-worker',
              files: [fs.existsSync(vidOut) ? vidOut : imgOut],
            });
            continue;
          }

          report.deferredShots++;
          report.results.push({
            shotId,
            sceneId,
            status: ShotStatus.AWAITING_WORKER,
            provider: state.deferredProvider ?? 'colab-worker',
            ticket: state.deferredTicket,
          });
          continue;
        }

        // Must have prompt.json to generate
        if (!fs.existsSync(promptPath)) {
          report.failedShots++;
          report.results.push({
            shotId,
            sceneId,
            status: ShotStatus.FAILED,
            provider: 'none',
            error: 'prompt.json not found in shot directory',
          });
          continue;
        }

        let req: GenerationRequest;
        try {
          req = JSON.parse(fs.readFileSync(promptPath, 'utf-8'));
        } catch (err) {
          report.failedShots++;
          report.results.push({
            shotId,
            sceneId,
            status: ShotStatus.FAILED,
            provider: 'none',
            error: `Failed to parse prompt.json: ${(err as Error).message}`,
          });
          continue;
        }

        // Apply options
        req.freeOnly = freeOnly;
        req.allowDeferred = allowDeferred;
        req.allowWatermark = allowWatermark;
        req.shotDir = shotDir;

        // Advance to PROMPTED
        state.status = ShotStatus.PROMPTED;
        state.attempts = (state.attempts ?? 0) + 1;
        state.updatedAt = new Date().toISOString();
        fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');

        // Execute generation via router
        const { decision, result } = await router.generate(req);

        // Append to audit log
        const logEntry = {
          timestamp: new Date().toISOString(),
          shotId,
          sceneId,
          chosen: decision.chosen?.providerId ?? null,
          freeOnly: decision.freeOnly,
          summary: decision.summary,
          rejected: decision.rejected.map((r) => ({
            providerId: r.providerId,
            reason: r.reason,
          })),
        };
        fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf-8');

        // Handle result
        if (result.status === 'done') {
          state.status = req.kind === 'video' ? ShotStatus.VIDEO_GENERATED : ShotStatus.IMAGE_GENERATED;
          state.lastError = undefined;
          state.updatedAt = new Date().toISOString();
          fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');

          report.completedShots++;
          report.results.push({
            shotId,
            sceneId,
            status: state.status,
            provider: result.provider,
            files: result.files,
          });
        } else if (result.status === 'deferred') {
          state.status = ShotStatus.AWAITING_WORKER;
          state.deferredTicket = result.ticket;
          state.deferredProvider = result.provider;
          state.lastError = undefined;
          state.updatedAt = new Date().toISOString();
          fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');

          report.deferredShots++;
          report.results.push({
            shotId,
            sceneId,
            status: ShotStatus.AWAITING_WORKER,
            provider: result.provider,
            ticket: result.ticket,
          });
        } else {
          state.status = ShotStatus.FAILED;
          state.lastError = result.error;
          state.updatedAt = new Date().toISOString();
          fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');

          report.failedShots++;
          report.results.push({
            shotId,
            sceneId,
            status: ShotStatus.FAILED,
            provider: result.provider,
            error: result.error,
          });
        }
      }
    }

    return report;
  }
}
