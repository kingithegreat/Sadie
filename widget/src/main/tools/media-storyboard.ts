/**
 * media-storyboard.ts — Storyboard planning, shot cards & frame generation tools.
 *
 * Connects HomeBot chat and Media Studio to the file-based movie project pipeline,
 * allowing the user or assistant to plan multi-shot scenes, assign framing/dialogue,
 * generate frame thumbnails via free providers, and hand off between Chat and Studio.
 */

import { isShotTransition, MAX_TRANSITION_SEC, MIN_TRANSITION_SEC } from '../../shared/transitions';
import { sanitizeTextCard } from '../../shared/text-card';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import {
  MovieProjectRunner,
  type MovieProject,
  type SceneManifest,
} from '../movie/project-runner';
import {
  storyboardFrameShape,
  routerForStoryboardFrame,
  storyboardFrameRequestPolicy,
  resolveAvailableStoryboardFrameProvider,
} from '../movie/storyboard-frame-providers';
import { STORYBOARD_FRAME_PROVIDERS, isStoryboardFrameProviderId, storyboardFrameProvider, type StoryboardFrameProviderId } from '../../shared/storyboard-frame-providers';
import {
  ShotStatus,
  type ShotBibleEntry,
  type GenerationRequest,
} from '../movie/types';
import { assembleStoryboardScenes } from '../movie/storyboard-assembly';
import { createStoryboardOutputSpec, resolveBurnSubtitles, resolveStudioOutputSpec } from '../../shared/media-output';
import { resolveCaptionStyle, type CaptionStyle } from '../../shared/caption-style';
import { readStoryboardExportState, resolveStoryboardExportPath } from '../movie/storyboard-export-state';
import { createStudioExportReview } from '../movie/studio-export-review';
import { getMediaCapabilityRegistry } from '../provider-capability-registry';

export function getStoryboardsRootDir(): string {
  const custom = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  if (custom && fs.existsSync(custom)) return custom;
  return path.join(os.homedir(), 'Desktop', 'homebot-movie-projects');
}

/** A missing or unreadable JSON file reads as empty; callers validate what they use. */
function readProjectMeta(file: string): Record<string, any> {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {}; } catch { return {}; }
}

/**
 * Save which provider makes this storyboard's frame images. Called by the
 * Storyboard picker (where each option's cost and watermark are shown) and the
 * Auto-Director. Only listed options are accepted, and saving a paid choice
 * grants nothing: it still needs the owner's confirmation in the Storyboard.
 */
export async function setStoryboardFrameProvider(args: { projectId?: unknown; frameProvider?: unknown }): Promise<ToolResult> {
  const projectId = String(args?.projectId ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId)) return { success: false, error: 'Choose a valid storyboard project.' };
  if (!isStoryboardFrameProviderId(args?.frameProvider)) return { success: false, error: 'Choose one of the listed ways to make frame images.' };
  if (args.frameProvider === 'gemini' || String(args.frameProvider).startsWith('gemini:')) {
    const available = await resolveAvailableStoryboardFrameProvider(args.frameProvider as StoryboardFrameProviderId);
    if (!available) return { success: false, error: 'That Gemini image model is no longer listed for the saved Google key. Check the account again.' };
  }
  const metaPath = path.join(getStoryboardsRootDir(), projectId, 'project.json');
  if (!fs.existsSync(metaPath)) return { success: false, error: `Storyboard project not found: ${projectId}` };
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const staged = `${metaPath}.saving`;
    fs.writeFileSync(staged, JSON.stringify({ ...meta, frameProvider: args.frameProvider, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
    fs.renameSync(staged, metaPath);
    return { success: true, result: { frameProvider: args.frameProvider } };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/** Save the live-listed video model PROV-4 will use for generated shot clips. */
export async function setStoryboardVideoModel(args: { projectId?: unknown; videoModelRef?: unknown }): Promise<ToolResult> {
  const projectId = String(args?.projectId ?? '').trim();
  const videoModelRef = String(args?.videoModelRef ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId)) return { success: false, error: 'Choose a valid storyboard project.' };
  const registry = await getMediaCapabilityRegistry();
  const model = registry.videoModels.find(candidate => candidate.ref === videoModelRef && candidate.usableIn.includes('shot-video'));
  if (!model) return { success: false, error: 'That video model is not listed for a connected account. Check the account again.' };
  const metaPath = path.join(getStoryboardsRootDir(), projectId, 'project.json');
  if (!fs.existsSync(metaPath)) return { success: false, error: `Storyboard project not found: ${projectId}` };
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const staged = `${metaPath}.saving`;
    fs.writeFileSync(staged, JSON.stringify({ ...meta, videoModelRef, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
    fs.renameSync(staged, metaPath);
    return { success: true, result: { videoModelRef } };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export interface StoryboardShotInput {
  shotId?: string;
  title?: string;
  prompt: string;
  framing?: 'wide' | 'medium' | 'close' | 'extreme_close' | string;
  lens?: string;
  movement?: string;
  durationSec?: number;
  narration?: string;
  transition?: string | null;
  transitionSec?: number | null;
  textCard?: unknown;
  characters?: string[];
  generationMethod?: 'still' | 'image_to_animation' | 'generative_video';
}

// --- 1. media_create_storyboard ---------------------------------------------

export const mediaCreateStoryboardDef: ToolDefinition = {
  name: 'media_create_storyboard',
  description:
    'Create a structured visual storyboard with planned shots, camera angles, duration, ' +
    'and narration script lines. Stores the storyboard project on disk so it can be viewed ' +
    'in Media Studio Storyboard Deck, animated via the Movie Router, or edited in the CapCut Timeline.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Unique slug for the storyboard project (e.g. "pyramid-builders-01", "mars-rover-discovery").',
      },
      title: {
        type: 'string',
        description: 'Human-readable title of the film, sequence, or video project.',
      },
      notes: {
        type: 'string',
        description: 'Creative notes, era, aesthetic mood, or logline.',
      },
      shots: {
        type: 'array',
        description:
          'List of planned shots in chronological sequence. Each shot object contains prompt, optional framing (wide/medium/close), lens, movement, durationSec, narration.',
        items: {
          type: 'object',
        },
      },
      freeOnly: {
        type: 'boolean',
        description: 'Hard gate ensuring all generations cost $0.00 (defaults to true).',
      },
      burnSubtitles: { type: 'boolean', description: 'Burn captions into the movie. New projects default to off.' },
      outputSpec: { type: 'object', description: 'Saved output settings, independent of shot durations: schemaVersion 1, durationIntent short or long, variants containing one format or explicitly both landscape and portrait, each {id: landscape/portrait/square, aspectRatio: 16:9/9:16/1:1, width, height, fps: 30, framing: {mode: fit/crop, x: 0.5, y: 0.5}}. Use matching 720p or 1080p dimensions. Defaults to landscape 1080p crop, so camera movement shows in every shot; fit keeps the whole image still.' },
    },
    required: ['projectId', 'title'],
  },
};

export const mediaCreateStoryboardHandler: ToolHandler = async (
  args: Record<string, any>,
): Promise<ToolResult> => {
  const projectId = String(args.projectId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!projectId) {
    return { success: false, error: 'projectId is required and must be alphanumeric.' };
  }

  const title = String(args.title || projectId).trim();
  const rootDir = getStoryboardsRootDir();
  const projectDir = path.join(rootDir, projectId);

  try {
    const projectMeta: MovieProject = {
      projectId,
      name: title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      freeOnly: args.freeOnly !== false,
      burnSubtitles: resolveBurnSubtitles(args.burnSubtitles, false),
      outputSpec: args.outputSpec === undefined ? createStoryboardOutputSpec() : resolveStudioOutputSpec(args.outputSpec),
      defaultResolution: [1024, 576],
      defaultDurationSec: 5,
      notes: args.notes || '',
    };

    MovieProjectRunner.createProject(projectDir, projectMeta, []);

    const rawShots: StoryboardShotInput[] = Array.isArray(args.shots) ? args.shots : [];
    const shotEntries: ShotBibleEntry[] = rawShots.map((s, idx) => {
      const shotNumber = String(idx + 1).padStart(3, '0');
      const shotId = s.shotId || `shot_${shotNumber}`;
      return {
        shotId,
        scene: 'scene_01',
        characters: Array.isArray(s.characters) ? s.characters : [],
        action: s.prompt,
        camera: {
          framing: s.framing || (idx === 0 ? 'wide' : idx === 1 ? 'medium' : 'close'),
          lens: s.lens || (idx === 0 ? '24mm' : '35mm'),
          movement: s.movement || 'static',
        },
        lighting: 'cinematic studio natural',
        durationSec: Number(s.durationSec) || 5,
        visualReferences: [],
        generationMethod: s.generationMethod || 'still',
        status: ShotStatus.PLANNED,
      };
    });

    const sceneManifest: SceneManifest = {
      sceneId: 'scene_01',
      title: title,
      description: args.notes || 'Main scene sequence',
      order: 1,
      shots: shotEntries.map((s) => s.shotId),
    };

    MovieProjectRunner.addScene(projectDir, sceneManifest, shotEntries);

    // Write narration / script lines and camera parameters alongside each shot if provided
    rawShots.forEach((s, idx) => {
      const shotId = shotEntries[idx]?.shotId;
      if (shotId) {
        const shotDir = path.join(projectDir, 'scenes', 'scene_01', shotId);
        if (s.narration) {
          const scriptFile = path.join(shotDir, 'script.txt');
          try {
            fs.writeFileSync(scriptFile, s.narration, 'utf-8');
          } catch {
            /* non-fatal */
          }
        }
        const promptFile = path.join(shotDir, 'prompt.json');
        if (fs.existsSync(promptFile)) {
          try {
            const pData = JSON.parse(fs.readFileSync(promptFile, 'utf-8'));
            pData.framing = shotEntries[idx]?.camera?.framing || s.framing || 'wide';
            pData.lens = shotEntries[idx]?.camera?.lens || s.lens || '35mm';
            pData.movement = shotEntries[idx]?.camera?.movement || s.movement || 'static';
            fs.writeFileSync(promptFile, JSON.stringify(pData, null, 2), 'utf-8');
          } catch {
            /* non-fatal */
          }
        }
      }
    });

    return {
      success: true,
      result: {
        projectId,
        title,
        projectDir,
        shotCount: shotEntries.length,
        totalDurationSec: shotEntries.reduce((acc, s) => acc + s.durationSec, 0),
        message: `Created storyboard "${title}" with ${shotEntries.length} shot(s). Open in Media Studio Storyboard Deck to review framing and generate frames.`,
        handoff: {
          mode: 'media',
          payload: { workspace: 'storyboard', projectId },
        },
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to create storyboard: ${err?.message || String(err)}`,
    };
  }
};

// --- 2. media_list_storyboards -----------------------------------------------

export const mediaListStoryboardsDef: ToolDefinition = {
  name: 'media_list_storyboards',
  description:
    'List all existing storyboard and movie projects on this machine, including their shot counts, ' +
    'creation date, and generated frame status.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const mediaListStoryboardsHandler: ToolHandler = async (): Promise<ToolResult> => {
  try {
    const rootDir = getStoryboardsRootDir();
    if (!fs.existsSync(rootDir)) {
      return { success: true, result: { storyboards: [] } };
    }

    const entries = fs.readdirSync(rootDir).filter((f) => {
      const p = path.join(rootDir, f);
      return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'project.json'));
    });

    const storyboards = entries.map((d) => {
      const projectDir = path.join(rootDir, d);
      let meta: any = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
      } catch {
        /* ignore */
      }

      // Count the saved sequence, not retained asset folders for removed shots.
      const shots = assembleStoryboardScenes(projectDir).flatMap(scene => scene.shots);
      const totalShots = shots.length;
      const renderedFrames = shots.filter(shot => !!shot.frameImagePath).length;
      const totalDurationSec = shots.reduce((sum, shot) => sum + (Number.isFinite(shot.durationSec) ? shot.durationSec : 0), 0);

      return {
        projectId: d,
        title: meta.name || d,
        createdAt: meta.createdAt || '',
        notes: meta.notes || '',
        totalShots,
        renderedFrames,
        totalDurationSec,
        projectDir,
      };
    });

    return {
      success: true,
      result: {
        count: storyboards.length,
        storyboards,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to list storyboards: ${err?.message || String(err)}`,
    };
  }
};

// --- 3. media_get_storyboard -------------------------------------------------

export const mediaGetStoryboardDef: ToolDefinition = {
  name: 'media_get_storyboard',
  description:
    'Retrieve the full shot breakdown, prompts, framing, durations, script narration, ' +
    'and rendered frame paths for a specific storyboard project.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'ID of the storyboard project (e.g. "pyramid-builders-01").',
      },
    },
    required: ['projectId'],
  },
};

export const mediaGetStoryboardHandler: ToolHandler = async (
  args: Record<string, any>,
): Promise<ToolResult> => {
  const projectId = String(args.projectId || '').trim();
  if (!projectId) {
    return { success: false, error: 'projectId is required.' };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId)) {
    return { success: false, error: 'Choose a valid storyboard project.' };
  }

  const rootDir = getStoryboardsRootDir();
  const projectDir = path.join(rootDir, projectId);
  if (!fs.existsSync(projectDir)) {
    return { success: false, error: `Storyboard project not found: ${projectId}` };
  }

  try {
    let projectMeta: any = {};
    const metaPath = path.join(projectDir, 'project.json');
    if (fs.existsSync(metaPath)) {
      projectMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }

    const scenes = assembleStoryboardScenes(projectDir);

    // A saved file is available for review, not a new publication approval.
    const savedOutput = projectMeta.latestSuccessfulOutput;
    const filename = savedOutput === undefined ? `${projectId}-1080p.mp4` : savedOutput?.filename;
    const renderedMoviePath = resolveStoryboardExportPath(projectDir, filename);
    const exportState = await readStoryboardExportState(projectDir, projectMeta, scenes);

    return {
      success: true,
      result: {
        project: projectMeta,
        scenes,
        projectDir,
        renderedMoviePath,
        exportState,
        ...(renderedMoviePath && savedOutput ? { renderedOutput: savedOutput } : {}),
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to load storyboard: ${err?.message || String(err)}`,
    };
  }
};

// --- 4. media_generate_storyboard_frame --------------------------------------

export const mediaGenerateStoryboardFrameDef: ToolDefinition = {
  name: 'media_generate_storyboard_frame',
  description:
    'Generate a visual storyboard sketch/frame for a planned shot with the frame provider the ' +
    'owner chose for this project ("Online" · free third-party service, or "This PC" · ComfyUI). ' +
    'Frames are never auto-routed, so a paid or watermarking service cannot be reached silently.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'ID of the storyboard project.',
      },
      sceneId: {
        type: 'string',
        description: 'Scene ID (defaults to "scene_01").',
      },
      shotId: {
        type: 'string',
        description: 'Shot ID (e.g. "shot_001").',
      },
      prompt: {
        type: 'string',
        description: 'Optional override prompt for image generation.',
      },
    },
    required: ['projectId', 'shotId'],
  },
};

export const mediaGenerateStoryboardFrameHandler: ToolHandler = async (
  args: Record<string, any>,
): Promise<ToolResult> => {
  const projectId = String(args.projectId || '').trim();
  const sceneId = String(args.sceneId || 'scene_01').trim();
  const shotId = String(args.shotId || '').trim();

  if (!projectId || !shotId) {
    return { success: false, error: 'projectId and shotId are required.' };
  }

  const rootDir = getStoryboardsRootDir();
  const shotDir = path.join(rootDir, projectId, 'scenes', sceneId, shotId);
  if (!fs.existsSync(shotDir)) {
    return { success: false, error: `Shot directory not found: ${shotDir}` };
  }

  try {
    let prompt = String(args.prompt || '').trim();
    if (!prompt) {
      const promptFile = path.join(shotDir, 'prompt.json');
      if (fs.existsSync(promptFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(promptFile, 'utf-8'));
          prompt = data.prompt;
        } catch {
          /* ignore */
        }
      }
    }

    if (!prompt) {
      return { success: false, error: 'No prompt available for shot frame generation.' };
    }

    // Frames are made only by the provider the owner chose for this project —
    // never by automatic routing, which could reach a paid or watermarking service.
    const projectMetaPath = path.join(rootDir, projectId, 'project.json');
    const chosen = readProjectMeta(projectMetaPath).frameProvider;
    if (!isStoryboardFrameProviderId(chosen)) {
      return { success: false, error: 'Choose how this storyboard makes frame images before generating one.' };
    }
    const available = await resolveAvailableStoryboardFrameProvider(chosen);
    if (!available) return { success: false, error: 'That frame model is no longer available to this connected account. Choose another one.' };
    const option = storyboardFrameProvider(available.id);
    if (!available.ready) return { success: false, error: available.reason || 'This frame model is not ready.' };

    const policy = storyboardFrameRequestPolicy(option);
    // Draw the frame in the shape this project exports. A 16:9 frame in a 9:16
    // export loses the middle 32% of every shot to the crop.
    const shape = storyboardFrameShape(readProjectMeta(projectMetaPath).outputSpec);
    const req: GenerationRequest = {
      kind: 'image', prompt, modelId: option.modelId, width: shape.width, height: shape.height, shotId, shotDir, ...policy,
    };

    const { decision, result: res } = await routerForStoryboardFrame(option.id).generate(req, { freeOnly: policy.freeOnly });
    if (res.status === 'failed') {
      const rejected = decision.rejected[0]?.reason;
      return { success: false, error: rejected ? `${option.label}: ${rejected}` : (res.error || `Frame generation failed: ${decision.summary}`) };
    }

    const imgPath = res.status === 'done' && res.files && res.files.length > 0 ? res.files[0]! : '';

    // Update status.json
    const statusFile = path.join(shotDir, 'status.json');
    const previousAttempts = Number(readProjectMeta(statusFile).attempts);
    const statusData: any = {
      shotId,
      status: ShotStatus.IMAGE_GENERATED,
      attempts: Number.isFinite(previousAttempts) && previousAttempts > 0 ? previousAttempts + 1 : 1,
      updatedAt: new Date().toISOString(),
      frameProvider: option.id,
      provider: res.provider || decision.chosen?.providerId || 'free-router',
      // The exact prompt this frame was generated from — lets assembleScene
      // flag the frame as stale if the shot's prompt changes afterward.
      generatedPrompt: prompt,
    };
    fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2), 'utf-8');

    return {
      success: true,
      result: {
        projectId,
        sceneId,
        shotId,
        provider: res.provider || decision.chosen?.providerId || 'free-router',
        frameImagePath: imgPath,
        frameSize: { width: shape.width, height: shape.height, aspectRatio: shape.aspectRatio },
        message: `Storyboard frame for ${shotId} generated successfully via ${res.provider || decision.chosen?.providerId || 'free-router'}.`
          + ` Drawn ${shape.width}x${shape.height} for ${shape.aspectRatio}.`
          + (shape.croppedAspects.length
            ? ` This project also exports ${shape.croppedAspects.join(' and ')}, which crops from this frame.`
            : ''),
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Frame generation exception: ${err?.message || String(err)}`,
    };
  }
};

// --- 5. media_render_storyboard ----------------------------------------------

// --- 5b. media_save_storyboard ------------------------------------------------
//
// Extracted from what used to be inline logic in the `homebot:media:storyboard:save`
// IPC handler — every OTHER storyboard IPC channel delegates to a tool handler
// here, which is what let this exact bug (render reading a file save never wrote)
// go uncaught: save's real file-writing logic lived only inside an IPC callback,
// unreachable by a test without mocking the whole IPC/electron surface. Now it's
// a plain function, callable directly the same way renderStoryboardMovie already is.

export const mediaSaveStoryboardDef: ToolDefinition = {
  name: 'media_save_storyboard',
  description:
    'Persists edits to a storyboard scene — shot order, framing/lens/movement, duration and narration text — ' +
    'to the real shot files the renderer reads from.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'ID of the storyboard project.' },
      sceneId: { type: 'string', description: 'Optional scene ID (defaults to scene_01).' },
      burnSubtitles: { type: 'boolean', description: 'Save the project caption burn-in choice. Omit to keep the saved choice.' },
      captionStyle: { type: 'object', description: 'How burned-in captions look: {size: small|medium|large, position: bottom|middle|top, font: Arial|Segoe UI|Verdana|Georgia|Impact|Trebuchet MS, color: #rrggbb, background: outline|box}. Omitted fields keep the default (medium, bottom, Arial, #ffffff, outline).' },
      outputSpec: { type: 'object', description: 'Save the versioned output settings described by media_create_storyboard. Omit to retain the saved settings, including legacy geometry.' },
      musicEnabled: { type: 'boolean', description: 'Save whether storyboard exports include a local background-music bed.' },
      musicVolume: { type: 'number', description: 'Save background-music gain from 0 to 1.' },
      shots: {
        type: 'array',
        description: 'Ordered array of shot edits to persist.',
        items: { type: 'object' },
      },
    },
    required: ['projectId', 'shots'],
  },
};

export const mediaSaveStoryboardHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const projectId = String(args.projectId || '').trim();
  if (!projectId) {
    return { success: false, error: 'projectId is required.' };
  }
  const sceneId = String(args.sceneId || 'scene_01');
  if (![projectId, sceneId].every(id => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))) {
    return { success: false, error: 'Choose a valid storyboard project and scene.' };
  }
  if (!Array.isArray(args.shots)) return { success: false, error: 'Save Board needs an ordered list of shots.' };
  if (args.burnSubtitles !== undefined && typeof args.burnSubtitles !== 'boolean') {
    return { success: false, error: 'Choose whether captions are on or off.' };
  }
  if (args.musicEnabled !== undefined && typeof args.musicEnabled !== 'boolean') {
    return { success: false, error: 'Choose whether background music is on or off.' };
  }
  if (args.musicVolume !== undefined && (typeof args.musicVolume !== 'number' || !Number.isFinite(args.musicVolume) || args.musicVolume < 0 || args.musicVolume > 1)) {
    return { success: false, error: 'Background music volume must be a number from 0 to 1.' };
  }
  let captionStyle: CaptionStyle | undefined;
  try {
    captionStyle = args.captionStyle === undefined ? undefined : resolveCaptionStyle(args.captionStyle);
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
  const shots = args.shots;
  const shotIds = shots.map((shot: any) => shot?.shotId);
  if (shotIds.some((id: unknown) => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) || new Set(shotIds).size !== shotIds.length) {
    return { success: false, error: 'Every shot needs a unique valid ID.' };
  }
  if (shots.some((shot: any) => shot.durationSec !== undefined &&
      (typeof shot.durationSec !== 'number' || !Number.isFinite(shot.durationSec) || shot.durationSec <= 0))) {
    return { success: false, error: 'Every shot needs a positive duration. Fix its timing before saving.' };
  }

  try {
    // Validate the complete output contract before mutating any shot or project file.
    const outputSpec = args.outputSpec === undefined ? undefined : resolveStudioOutputSpec(args.outputSpec);
    const rootDir = getStoryboardsRootDir();
    const projectDir = path.join(rootDir, projectId);
    const sceneDir = path.join(projectDir, 'scenes', sceneId);

    if (!fs.existsSync(sceneDir)) {
      return { success: false, error: `Scene directory not found: ${sceneDir}` };
    }

    const sceneJsonPath = path.join(sceneDir, 'scene.json');
    const metaPath = path.join(projectDir, 'project.json');
    // Parse before touching shot files; preserve unrelated project metadata.
    const projectMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
    const sceneMeta = fs.existsSync(sceneJsonPath)
      ? JSON.parse(fs.readFileSync(sceneJsonPath, 'utf-8')) : { sceneId };

    for (const shot of shots) {
      const shotDir = path.join(sceneDir, shot.shotId);
      if (!fs.existsSync(shotDir)) {
        fs.mkdirSync(shotDir, { recursive: true });
        fs.mkdirSync(path.join(shotDir, 'image'), { recursive: true });
        fs.mkdirSync(path.join(shotDir, 'video'), { recursive: true });
      }

      const promptPath = path.join(shotDir, 'prompt.json');
      let promptData: any = {};
      if (fs.existsSync(promptPath)) {
        try { promptData = JSON.parse(fs.readFileSync(promptPath, 'utf-8')); } catch { /* ignore */ }
      }
      promptData.prompt = shot.prompt ?? promptData.prompt ?? '';
      promptData.framing = shot.framing ?? promptData.framing ?? 'wide';
      promptData.lens = shot.lens ?? promptData.lens ?? '35mm';
      promptData.movement = shot.movement ?? promptData.movement ?? 'static';
      promptData.durationSec = shot.durationSec === undefined ? (promptData.durationSec ?? 5) : shot.durationSec;
      // MS-2: how this shot moves into the next one. 'cut' is the absence of a transition.
      if (shot.transition !== undefined) {
        if (isShotTransition(shot.transition) && shot.transition !== 'cut') {
          promptData.transition = shot.transition;
          const seconds = typeof shot.transitionSec === 'number' ? shot.transitionSec : undefined;
          if (seconds !== undefined) promptData.transitionSec = Math.min(MAX_TRANSITION_SEC, Math.max(MIN_TRANSITION_SEC, seconds));
        } else {
          delete promptData.transition;
          delete promptData.transitionSec;
        }
      }
      // MS-5: an explicit null clears the card; leaving it out keeps what is saved.
      if (shot.textCard !== undefined) {
        const card = sanitizeTextCard(shot.textCard);
        if (card) promptData.textCard = card; else delete promptData.textCard;
      }
      fs.writeFileSync(promptPath, JSON.stringify(promptData, null, 2), 'utf-8');

      if (shot.narration !== undefined) {
        fs.writeFileSync(path.join(shotDir, 'script.txt'), String(shot.narration), 'utf-8');
      }
    }

    sceneMeta.shots = shotIds;
    fs.writeFileSync(sceneJsonPath, JSON.stringify(sceneMeta, null, 2), 'utf-8');
    if (projectMeta) {
      const stagedMeta = `${metaPath}.saving`;
      fs.writeFileSync(stagedMeta, JSON.stringify({
        ...projectMeta,
        ...(args.burnSubtitles !== undefined ? { burnSubtitles: args.burnSubtitles } : {}),
        ...(captionStyle !== undefined ? { captionStyle } : {}),
        ...(outputSpec !== undefined ? { outputSpec } : {}),
        ...(args.musicEnabled !== undefined ? { musicEnabled: args.musicEnabled } : {}),
        ...(args.musicVolume !== undefined ? { musicVolume: args.musicVolume } : {}),
        updatedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');
      fs.renameSync(stagedMeta, metaPath);
    }
    return { success: true, result: { message: 'Storyboard updated successfully.' } };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
};

export const mediaRenderStoryboardDef: ToolDefinition = {
  name: 'media_render_storyboard',
  description:
    'Renders a complete visual storyboard into an MP4 using local FFmpeg and saved output settings. ' +
    'Includes voiceover narration and optional captions; crop framing supports Ken Burns motion, while fit retains the whole image. ' +
    'Does not approve, upload or publish the movie.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'ID of the storyboard project to render into a movie.',
      },
      sceneId: {
        type: 'string',
        description: 'Optional scene ID for a separate scene export. Omit to render all scenes in saved order.',
      },
      motion: {
        type: 'boolean',
        description: 'Whether to render dynamic Ken Burns camera motion per shot (default: true).',
      },
      burnSubtitles: {
        type: 'boolean',
        description: 'Optional override for the saved project caption choice. New projects default to off; legacy projects retain captions until changed.',
      },
      outputSpec: { type: 'object', description: 'Optional output override using the versioned settings described by media_create_storyboard. Omit to use the saved project settings.' },
      variantId: { type: 'string', enum: ['landscape', 'portrait', 'square'], description: 'Retry only this saved format. Omit to render every explicitly selected format.' },
      narrationEngine: { type: 'string', enum: ['edge', 'kokoro'], description: "Voice for this export: 'kokoro' speaks on this PC with no internet, 'edge' is the online voice. Omit to use the saved setting." },
      musicEnabled: { type: 'boolean', description: 'Override whether this export includes a local background-music bed.' },
      musicTrack: { type: 'string', description: 'Optional local music path or filename from the configured music folder.' },
      musicVolume: { type: 'number', description: 'Background-music gain from 0 to 1. Omit to use the saved level.' },
      encoder: { type: 'string', enum: ['auto', 'nvenc', 'cpu'], description: 'Prefer automatic NVIDIA detection, NVIDIA NVENC, or CPU software encoding. NVENC falls back to CPU when unavailable.' },
    },
    required: ['projectId'],
  },
};

export const mediaRenderStoryboardHandler: ToolHandler = async (args, _context) => {
  const projectId = (args.projectId as string)?.trim();
  if (!projectId) {
    return { success: false, error: 'projectId is required to render a storyboard.' };
  }

  const { renderStoryboardMovie } = await import('../movie/storyboard-renderer');
  const res = await renderStoryboardMovie({
    projectId,
    sceneId: (args.sceneId as string)?.trim(),
    motion: args.motion !== false,
    burnSubtitles: args.burnSubtitles,
    variantId: args.variantId,
    ...(args.outputSpec !== undefined ? { outputSpec: args.outputSpec } : {}),
    ...(args.narrationEngine === 'edge' || args.narrationEngine === 'kokoro' ? { narrationEngine: args.narrationEngine } : {}),
    ...(typeof args.colorGrade === 'string' ? { colorGrade: args.colorGrade } : {}),
    ...(typeof args.musicTrack === 'string' && args.musicTrack.trim()
      ? { music: args.musicTrack.trim() }
      : typeof args.musicEnabled === 'boolean' ? { music: args.musicEnabled } : {}),
    ...(typeof args.musicVolume === 'number' ? { musicVolume: args.musicVolume } : {}),
    ...(args.encoder === 'auto' || args.encoder === 'nvenc' || args.encoder === 'cpu' ? { encoder: args.encoder } : {}),
  });

  if (!res.ok && !res.variants) {
    return {
      success: false,
      error: res.error || 'Failed to render storyboard movie.',
    };
  }

  const variants = [];
  for (const result of res.variants ?? [res]) {
    const reviewed = result.ok ? await registerStoryboardReview(projectId, (args.sceneId as string)?.trim(), result) : result;
    variants.push({ ...result, ...reviewed });
  }
  const selected = variants.find(result => result.ok);
  return {
    success: res.ok,
    ...(res.ok ? {} : { error: res.error || 'One or more formats did not finish. Successful movies are kept.' }),
    result: { projectId, ...selected,
      ...(res.variants ? { variants } : {}),
      message: res.variants ? `${variants.filter(result => result.ok).length} of ${variants.length} selected formats exported. Review each saved movie separately.`
        : `Rendered movie (${res.durationSec}s, ${res.totalShots} shots) successfully! Saved to: ${res.moviePath}`,
      handoff: { mode: 'media', payload: { workspace: 'storyboard', projectId, renderedMoviePath: selected?.moviePath } },
    },
  };
};

async function registerStoryboardReview(projectId: string, sceneId: string | undefined, res: import('../movie/storyboard-renderer').StoryboardRenderResult) {
  // Bridge rendered storyboard movie into primary MediaJob approval queue
  // Separate namespaces and a length-prefixed project ID avoid collisions
  // between complete movies and independently exported scenes.
  let jobId: string | undefined = res.renderedOutput ? `sbexport_${res.renderedOutput.exportId}`
    : sceneId ? `sbscene_${projectId.length}_${projectId}_${sceneId}` : `sb_${projectId}`;
  const exportSpec = res.outputSpec ?? res.renderedOutput?.outputSpec;
  const variant = exportSpec?.variants[0];
  const outputLabel = variant ? `${variant.width} × ${variant.height} ${variant.aspectRatio}` : '1080p';
  let warning: string | undefined;
  try {
    const { readJobs, writeJobs } = await import('./media');
    const rootDir = getStoryboardsRootDir();
    const projectDir = path.join(rootDir, projectId);
    let projectMeta: any = {};
    const metaPath = path.join(projectDir, 'project.json');
    if (fs.existsSync(metaPath)) {
      try { projectMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* ignore */ }
    }

    const jobs = readJobs();
    const existing = jobs.find(j => j.id === jobId);
    const title = projectMeta.title || projectMeta.name || projectId;
    const job: any = res.renderedOutput ? createStudioExportReview({ source: { type: 'storyboard', id: projectId },
      title, moviePath: res.moviePath!, output: res.renderedOutput,
      brief: projectMeta.description || `Rendered from Storyboard Deck (${res.totalShots} shots)` }, existing) : {
      id: jobId,
      title: `[Storyboard] ${title}`,
      format: exportSpec?.durationIntent ?? ((res.durationSec && res.durationSec > 60) ? 'long' : 'short'),
      state: 'awaiting_approval',
      burnSubtitles: res.burnSubtitles,
      ...(exportSpec ? { outputSpec: exportSpec } : {}), renderedOutput: res.renderedOutput,
      renderPath: res.moviePath,
      durationSeconds: res.durationSec,
      brief: projectMeta.description || `Rendered from Storyboard Deck (${res.totalShots} shots)`,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [
        ...(existing?.history || []),
        {
          at: new Date().toISOString(),
          from: existing?.state || 'media_production',
          to: 'awaiting_approval',
          by: 'storyboard_render',
          note: res.moviePath ? `Rendered ${outputLabel} movie: ${path.basename(res.moviePath)}` : `Rendered ${outputLabel} movie`,
        },
      ],
    };
    const existingIdx = jobs.findIndex(j => j.id === jobId);
    if (existingIdx >= 0) {
      jobs[existingIdx] = job;
    } else {
      jobs.push(job);
    }
    writeJobs(jobs);
  } catch (e) {
    jobId = undefined;
    warning = 'The movie was saved, but it could not be added to the review queue. You can still open the saved video; render again to retry the queue entry.';
    console.warn('[Storyboard] Failed to register MediaJob in approval queue:', e);
  }

  return { ...res, jobId, ...(warning ? { warning } : {}) };
}

// --- 6. media_breakdown_script ----------------------------------------------

export const mediaBreakdownScriptDef: ToolDefinition = {
  name: 'media_breakdown_script',
  description:
    'Auto-direct a script, scene prompt, or story synopsis into a multi-shot visual storyboard. ' +
    'Intelligently calibrates camera shot sizes (wide/medium/close), focal lengths (24mm/35mm/50mm/85mm), ' +
    'camera movements (push in, tracking, pan, tilt), composition-engineered prompts, and spoken dialogue lines. ' +
    'Saves the storyboard project to disk ready for preview, frame generation, animatics, and 1080p movie rendering.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'The narrative text, scene description, dialogue, or story logline to direct.',
      },
      genre: {
        type: 'string',
        description:
          'Optional cinematic genre: "historical_epic", "cyberpunk_scifi", "noir_thriller", "documentary_nature", "fantasy_myth", "action_cinematic", or "auto" (default: auto-detected).',
      },
      shotCount: {
        type: 'number',
        description: 'Desired number of shots to direct (default: 4, range: 3 to 8).',
      },
      title: {
        type: 'string',
        description: 'Optional human-readable title for the movie project.',
      },
      projectId: {
        type: 'string',
        description: 'Optional custom alphanumeric slug for the project folder.',
      },
      autoGenerateFrames: {
        type: 'boolean',
        description: 'Whether to immediately make frame images for all directed shots (default: false). Needs frameProvider.',
      },
      frameProvider: {
        type: 'string',
        enum: STORYBOARD_FRAME_PROVIDERS.map(option => option.id),
        description: 'How this storyboard makes frame images: "online" (free third-party service, may add a watermark), "this-pc" (local ComfyUI), "gemini" (Google, paid per image; makes nothing until the owner confirms paid use in the Storyboard) or "chatgpt-plan" (the owner\'s ChatGPT plan through the signed-in Codex CLI; no per-image charge, uses plan limits). Omit to let the owner choose in the Storyboard.',
      },
    },
    required: ['script'],
  },
};

export const mediaBreakdownScriptHandler: ToolHandler = async (args, _context) => {
  const script = String(args.script || '').trim();
  if (!script) {
    return { success: false, error: 'script text is required to direct a storyboard.' };
  }

  const { directScriptToStoryboard } = await import('../movie/script-director');
  const res = await directScriptToStoryboard({
    script,
    genre: args.genre as any,
    shotCount: typeof args.shotCount === 'number' ? args.shotCount : undefined,
    title: args.title as string,
    projectId: args.projectId as string,
    autoGenerateFrames: args.autoGenerateFrames === true,
    frameProvider: typeof args.frameProvider === 'string' ? args.frameProvider : undefined,
  });

  if (!res.ok) {
    return {
      success: false,
      error: res.error || 'Failed to direct script into storyboard.',
    };
  }

  return {
    success: true,
    result: {
      projectId: res.projectId,
      title: res.title,
      genre: res.genre,
      totalShots: res.shots?.length || 0,
      totalDurationSec: res.totalDurationSec,
      projectDir: res.projectDir,
      // Preserve the director's complete shot contract for the legacy Studio IPC facade.
      shots: res.shots,
      ...(res.framesGenerated !== undefined ? { framesGenerated: res.framesGenerated } : {}),
      ...(res.framesSkipped ? { framesSkipped: res.framesSkipped } : {}),
      message: `Directed script into storyboard "${res.title}" (${res.genre}) with ${res.shots?.length || 0} shots! Total duration: ${res.totalDurationSec}s.` +
        (res.framesSkipped ? ` Frames were not made: ${res.framesSkipped}` : res.framesGenerated ? ` Made ${res.framesGenerated} frame(s).` : ''),
      handoff: {
        mode: 'media',
        payload: {
          workspace: 'storyboard',
          projectId: res.projectId,
        },
      },
    },
  };
};

// --- 8. setStoryboardShotImage ------------------------------------------------

export async function setStoryboardShotImage(args: {
  projectId: string;
  sceneId?: string;
  shotId: string;
  imagePath: string;
}): Promise<ToolResult> {
  const projectId = String(args.projectId || '').trim();
  const sceneId = String(args.sceneId || 'scene_01').trim();
  const shotId = String(args.shotId || '').trim();
  const imagePath = String(args.imagePath || '').trim();

  if (!projectId || !shotId || !imagePath) {
    return { success: false, error: 'projectId, shotId, and imagePath are required.' };
  }
  if (!fs.existsSync(imagePath)) {
    return { success: false, error: `Image file does not exist: ${imagePath}` };
  }

  const rootDir = getStoryboardsRootDir();
  const shotDir = path.join(rootDir, projectId, 'scenes', sceneId, shotId);
  if (!fs.existsSync(shotDir)) {
    return { success: false, error: `Shot directory not found: ${shotDir}` };
  }

  try {
    const imgDir = path.join(shotDir, 'image');
    if (!fs.existsSync(imgDir)) {
      fs.mkdirSync(imgDir, { recursive: true });
    }
    const ext = path.extname(imagePath).toLowerCase() || '.png';
    const destFile = path.join(imgDir, `frame${ext}`);
    fs.copyFileSync(imagePath, destFile);

    const statusFile = path.join(shotDir, 'status.json');
    const prevStatus = readProjectMeta(statusFile);
    const statusData = {
      ...prevStatus,
      shotId,
      status: ShotStatus.IMAGE_GENERATED,
      updatedAt: new Date().toISOString(),
      provider: 'custom_import',
      frameImagePath: destFile,
    };
    fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2), 'utf-8');

    return {
      success: true,
      result: {
        projectId,
        sceneId,
        shotId,
        frameImagePath: destFile,
        provider: 'custom_import',
        message: `Image for ${shotId} imported successfully from ${path.basename(imagePath)}.`,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export const mediaSetStoryboardImageDef: ToolDefinition = {
  name: 'media_set_storyboard_image',
  description: 'Imports an existing local image file as the rendered keyframe for a storyboard shot.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'ID of the storyboard project.' },
      sceneId: { type: 'string', description: 'Scene ID (defaults to scene_01).' },
      shotId: { type: 'string', description: 'Shot ID to assign the image to.' },
      imagePath: { type: 'string', description: 'Absolute path to the local image file.' },
    },
    required: ['projectId', 'shotId', 'imagePath'],
  },
};

// --- Exports -----------------------------------------------------------------

export const storyboardToolDefs: ToolDefinition[] = [
  mediaCreateStoryboardDef,
  mediaListStoryboardsDef,
  mediaGetStoryboardDef,
  mediaGenerateStoryboardFrameDef,
  mediaSaveStoryboardDef,
  mediaRenderStoryboardDef,
  mediaBreakdownScriptDef,
  mediaSetStoryboardImageDef,
];

export const storyboardToolHandlers: Record<string, ToolHandler> = {
  media_create_storyboard: mediaCreateStoryboardHandler,
  media_list_storyboards: mediaListStoryboardsHandler,
  media_get_storyboard: mediaGetStoryboardHandler,
  media_generate_storyboard_frame: mediaGenerateStoryboardFrameHandler,
  media_save_storyboard: mediaSaveStoryboardHandler,
  media_render_storyboard: mediaRenderStoryboardHandler,
  media_breakdown_script: mediaBreakdownScriptHandler,
  media_set_storyboard_image: (args) => setStoryboardShotImage(args as any),
};



