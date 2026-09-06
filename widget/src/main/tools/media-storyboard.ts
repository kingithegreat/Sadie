/**
 * media-storyboard.ts — Storyboard planning, shot cards & frame generation tools.
 *
 * Connects HomeBot chat and Media Studio to the file-based movie project pipeline,
 * allowing the user or assistant to plan multi-shot scenes, assign framing/dialogue,
 * generate frame thumbnails via free providers, and hand off between Chat and Studio.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import {
  MovieProjectRunner,
  createStandardRouter,
  type MovieProject,
  type SceneManifest,
} from '../movie/project-runner';
import {
  ShotStatus,
  type ShotBibleEntry,
  type GenerationRequest,
} from '../movie/types';

export function getStoryboardsRootDir(): string {
  const custom = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  if (custom && fs.existsSync(custom)) return custom;
  return path.join(os.homedir(), 'Desktop', 'homebot-movie-projects');
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

      // Count shots and generated frames
      let totalShots = 0;
      let renderedFrames = 0;
      let totalDurationSec = 0;
      const scenesDir = path.join(projectDir, 'scenes');
      if (fs.existsSync(scenesDir)) {
        const scenes = fs.readdirSync(scenesDir);
        for (const sc of scenes) {
          const scPath = path.join(scenesDir, sc);
          if (fs.statSync(scPath).isDirectory()) {
            const shots = fs.readdirSync(scPath).filter((s) => s.startsWith('shot_'));
            totalShots += shots.length;
            for (const shot of shots) {
              const imgDir = path.join(scPath, shot, 'image');
              if (fs.existsSync(imgDir) && fs.readdirSync(imgDir).some((f) => f.endsWith('.png') || f.endsWith('.jpg'))) {
                renderedFrames++;
              }
              const promptFile = path.join(scPath, shot, 'prompt.json');
              if (fs.existsSync(promptFile)) {
                try {
                  const req = JSON.parse(fs.readFileSync(promptFile, 'utf-8'));
                  totalDurationSec += Number(req.durationSec) || 5;
                } catch {
                  totalDurationSec += 5;
                }
              }
            }
          }
        }
      }

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

    const scenesDir = path.join(projectDir, 'scenes');
    const scenes: any[] = [];
    if (fs.existsSync(scenesDir)) {
      const sceneNames = fs.readdirSync(scenesDir).filter((s) => fs.statSync(path.join(scenesDir, s)).isDirectory());
      for (const sc of sceneNames) {
        const scPath = path.join(scenesDir, sc);
        let sceneMeta: any = { sceneId: sc };
        const scJson = path.join(scPath, 'scene.json');
        if (fs.existsSync(scJson)) {
          try {
            sceneMeta = JSON.parse(fs.readFileSync(scJson, 'utf-8'));
          } catch {
            /* ignore */
          }
        }

        const shotDirs = fs.readdirSync(scPath).filter((s) => s.startsWith('shot_') && fs.statSync(path.join(scPath, s)).isDirectory());
        const shots = shotDirs.map((shotId, idx) => {
          const shotPath = path.join(scPath, shotId);
          let promptData: any = {};
          let statusData: any = {};
          let narration = '';

          const pFile = path.join(shotPath, 'prompt.json');
          if (fs.existsSync(pFile)) {
            try { promptData = JSON.parse(fs.readFileSync(pFile, 'utf-8')); } catch { /* ignore */ }
          }
          const sFile = path.join(shotPath, 'status.json');
          if (fs.existsSync(sFile)) {
            try { statusData = JSON.parse(fs.readFileSync(sFile, 'utf-8')); } catch { /* ignore */ }
          }
          const scriptFile = path.join(shotPath, 'script.txt');
          if (fs.existsSync(scriptFile)) {
            try { narration = fs.readFileSync(scriptFile, 'utf-8'); } catch { /* ignore */ }
          }

          // Check for generated still frame image
          let frameImagePath: string | null = null;
          const imgDir = path.join(shotPath, 'image');
          if (fs.existsSync(imgDir)) {
            const imgs = fs.readdirSync(imgDir).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'));
            if (imgs.length > 0) {
              frameImagePath = path.join(imgDir, imgs[0]!);
            }
          }

          return {
            shotId,
            order: idx + 1,
            prompt: promptData.prompt || '',
            framing: promptData.framing || (idx === 0 ? 'wide' : 'medium'),
            lens: promptData.lens || '35mm',
            movement: promptData.movement || 'static',
            durationSec: Number(promptData.durationSec) || 5,
            narration,
            status: statusData.status || ShotStatus.PLANNED,
            frameImagePath,
          };
        });

        scenes.push({
          ...sceneMeta,
          shots,
        });
      }
    }

    return {
      success: true,
      result: {
        project: projectMeta,
        scenes,
        projectDir,
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
    'Generate a visual storyboard sketch/frame for a planned shot using HomeBot’s free-first ' +
    '5-provider GenerationRouter (Pollinations / Imagen 3 / Local SD 1.5).',
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

    const router = createStandardRouter();
    const req: GenerationRequest = {
      kind: 'image',
      prompt,
      width: 1024,
      height: 576,
      shotId,
      shotDir,
      freeOnly: true,
      allowWatermark: false,
      allowDeferred: false,
    };

    const { decision, result: res } = await router.generate(req);
    if (res.status === 'failed') {
      return { success: false, error: res.error || `Frame generation failed: ${decision.summary}` };
    }

    const imgPath = res.status === 'done' && res.files && res.files.length > 0 ? res.files[0]! : '';

    // Update status.json
    const statusFile = path.join(shotDir, 'status.json');
    const statusData: any = {
      shotId,
      status: ShotStatus.IMAGE_GENERATED,
      attempts: 1,
      updatedAt: new Date().toISOString(),
      provider: res.provider || decision.chosen?.providerId || 'free-router',
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
        message: `Storyboard frame for ${shotId} generated successfully via ${res.provider || decision.chosen?.providerId || 'free-router'}.`,
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

export const mediaRenderStoryboardDef: ToolDefinition = {
  name: 'media_render_storyboard',
  description:
    'Renders a complete visual storyboard sequence into a broadcast-quality 1080p MP4 movie using local FFmpeg, ' +
    'per-shot Ken Burns motion (slow push in, pan, tilt), voiceover narration (Edge or Kokoro TTS), and burned subtitles. ' +
    'Strictly $0.00 spend invariant.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'ID of the storyboard project to render into a movie.',
      },
      sceneId: {
        type: 'string',
        description: 'Optional scene ID (defaults to scene_01).',
      },
      motion: {
        type: 'boolean',
        description: 'Whether to render dynamic Ken Burns camera motion per shot (default: true).',
      },
      burnSubtitles: {
        type: 'boolean',
        description: 'Whether to burn aligned dialogue/action subtitles into the video (default: true).',
      },
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
    burnSubtitles: args.burnSubtitles !== false,
  });

  if (!res.ok) {
    return {
      success: false,
      error: res.error || 'Failed to render storyboard movie.',
    };
  }

  return {
    success: true,
    result: {
      projectId,
      moviePath: res.moviePath,
      durationSec: res.durationSec,
      totalShots: res.totalShots,
      message: `Rendered 1080p movie (${res.durationSec}s, ${res.totalShots} shots) successfully! Saved to: ${res.moviePath}`,
      handoff: {
        mode: 'media',
        payload: {
          workspace: 'storyboard',
          projectId,
          renderedMoviePath: res.moviePath,
        },
      },
    },
  };
};

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
        description: 'Whether to immediately trigger AI frame generation for all directed shots (default: false).',
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
      shots: res.shots?.map(s => ({
        shotId: s.shotId,
        framing: s.framing,
        lens: s.lens,
        movement: s.movement,
        durationSec: s.durationSec,
        prompt: s.prompt,
        narration: s.narration,
      })),
      message: `Directed script into storyboard "${res.title}" (${res.genre}) with ${res.shots?.length || 0} shots! Total duration: ${res.totalDurationSec}s.`,
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

// --- Exports -----------------------------------------------------------------

export const storyboardToolDefs: ToolDefinition[] = [
  mediaCreateStoryboardDef,
  mediaListStoryboardsDef,
  mediaGetStoryboardDef,
  mediaGenerateStoryboardFrameDef,
  mediaRenderStoryboardDef,
  mediaBreakdownScriptDef,
];

export const storyboardToolHandlers: Record<string, ToolHandler> = {
  media_create_storyboard: mediaCreateStoryboardHandler,
  media_list_storyboards: mediaListStoryboardsHandler,
  media_get_storyboard: mediaGetStoryboardHandler,
  media_generate_storyboard_frame: mediaGenerateStoryboardFrameHandler,
  media_render_storyboard: mediaRenderStoryboardHandler,
  media_breakdown_script: mediaBreakdownScriptHandler,
};


