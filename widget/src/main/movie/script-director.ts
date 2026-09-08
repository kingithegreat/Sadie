/**
 * script-director.ts — Script-to-Storyboard Director Engine
 *
 * Automatically breaks down raw scripts, screenplay scenes, loglines, or story ideas
 * into calibrated, multi-shot visual storyboards with camera angles, focal lengths,
 * dynamic motion cues, composition-engineered prompts, and spoken narration scripts ($0.00 spend).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  MovieProjectRunner,
  createStandardRouter,
  type MovieProject,
  type SceneManifest,
} from './project-runner';
import {
  ShotStatus,
  type ShotBibleEntry,
  type GenerationRequest,
} from './types';
import { getStoryboardProjectDir } from './storyboard-renderer';

export type CinematicGenre =
  | 'historical_epic'
  | 'cyberpunk_scifi'
  | 'noir_thriller'
  | 'documentary_nature'
  | 'fantasy_myth'
  | 'action_cinematic'
  | 'auto';

export type CameraFraming = 'wide' | 'medium' | 'close' | 'extreme_close';
export type CameraLens = '24mm' | '35mm' | '50mm' | '85mm';
export type CameraMovement = 'slow push in' | 'pan right' | 'tilt up' | 'tracking' | 'static';

export interface DirectedShot {
  shotId: string;
  order: number;
  title: string;
  prompt: string;
  framing: CameraFraming;
  lens: CameraLens;
  movement: CameraMovement;
  durationSec: number;
  narration: string;
  characters: string[];
  beatType: 'establishing' | 'action' | 'investigation' | 'conflict' | 'climax' | 'resolution';
}

export interface ScriptBreakdownOptions {
  script: string;
  genre?: CinematicGenre | string;
  shotCount?: number;
  title?: string;
  projectId?: string;
  notes?: string;
  autoGenerateFrames?: boolean;
  freeOnly?: boolean;
}

export interface ScriptBreakdownResult {
  ok: boolean;
  projectId?: string;
  title?: string;
  genre?: string;
  shots?: DirectedShot[];
  totalDurationSec?: number;
  projectDir?: string;
  error?: string;
}

interface GenreCinematographyProfile {
  styleName: string;
  cameraRig: string;
  lightingCue: string;
  colorGrade: string;
  textureCue: string;
  keywords: string[];
}

const GENRE_PROFILES: Record<string, GenreCinematographyProfile> = {
  historical_epic: {
    styleName: 'Historical Epic Cinema',
    cameraRig: 'Panavision 35mm anamorphic prime lens, classical cinematic framing',
    lightingCue: 'warm golden hour directional sunlight, atmospheric dust motes, torchlit warm glow',
    colorGrade: 'Kodak 5219 film stock, rich amber highlights, deep earthen shadows, regal bronze tones',
    textureCue: 'ancient limestone weathered textures, authentic period materials, 8k photorealistic architectural detail',
    keywords: [
      'ancient', 'egypt', 'pharaoh', 'pyramid', 'temple', 'rome', 'gladiator', 'medieval',
      'castle', 'knight', 'dynasty', 'emperor', 'sparta', 'athens', 'scroll', 'hieroglyph', 'sand', 'desert'
    ],
  },
  cyberpunk_scifi: {
    styleName: 'Cyberpunk Sci-Fi Cinema',
    cameraRig: 'Arri Alexa Mini LF, Cooke Anamorphic lens, wide depth of field',
    lightingCue: 'volumetric teal and magenta neon lighting, reflective rain puddles, high-contrast rim light',
    colorGrade: 'Blade Runner 2049 aesthetic, electric cyan and vivid magenta chromatic contrast, deep onyx blacks',
    textureCue: 'metallic chrome, optical fiber glow, holographic HUD reflections, gritty urban rain, 8k resolution',
    keywords: [
      'cyber', 'neon', 'hacker', 'cyborg', 'android', 'ai', 'spaceship', 'orbit', 'galaxy',
      'mars', 'neural', 'hologram', 'matrix', 'dystopia', 'drone', 'robot', 'future', 'terminal'
    ],
  },
  noir_thriller: {
    styleName: 'Neo-Noir Thriller',
    cameraRig: '35mm vintage prime lens, low-angle Dutch tilt and low-key framing',
    lightingCue: 'harsh single-source tungsten streetlight through mist, venetian blind hard shadow patterns',
    colorGrade: 'desaturated cold monochrome silver with subtle amber tungsten warmth, deep shadows',
    textureCue: 'rain-slicked cobblestone pavement, heavy smoke and atmospheric fog, 35mm film grain',
    keywords: [
      'noir', 'detective', 'rain', 'fedora', 'smoke', 'murder', 'mystery', 'crime',
      'alley', 'shadow', 'trenchcoat', 'corrupt', 'whiskey', 'gun', 'midnight'
    ],
  },
  documentary_nature: {
    styleName: 'National Geographic Nature Documentary',
    cameraRig: 'RED V-Raptor 8K, ultra-telephoto prime lens, balanced rule-of-thirds composition',
    lightingCue: 'crisp dawn mountain light, golden rim light, soft diffused natural wilderness ambiance',
    colorGrade: 'hyper-realistic natural colors, lush organic greens, crisp sky blues, vibrant earthy tones',
    textureCue: 'lifelike fur and feather detail, crystal water droplets, grand landscape depth of field',
    keywords: [
      'animal', 'wildlife', 'nature', 'mountain', 'ocean', 'forest', 'leopard', 'tiger',
      'lion', 'bear', 'bird', 'river', 'tundra', 'glacier', 'jungle', 'predator', 'savannah'
    ],
  },
  fantasy_myth: {
    styleName: 'Mythic High Fantasy',
    cameraRig: 'Hasselblad medium format cinema lens, mystical wide perspective',
    lightingCue: 'ethereal bioluminescent particle glow, moonlight filtering through enchanted canopy, celestial god rays',
    colorGrade: 'dreamlike iridescent tones, mystical emerald and celestial amethyst palette, radiant highlights',
    textureCue: 'ancient carved runic stone, enchanted flora, shimmering magical auras, mythical fantasy painting style',
    keywords: [
      'dragon', 'magic', 'wizard', 'elf', 'enchanted', 'spell', 'sword', 'mystical',
      'potion', 'sorcerer', 'kingdom', 'fairy', 'goblin', 'portal', 'relic', 'myth'
    ],
  },
  action_cinematic: {
    styleName: 'High-Octane Action Blockbuster',
    cameraRig: 'IMAX 70mm dynamic handheld gimbal camera, kinetic low-angle framing',
    lightingCue: 'dramatic anamorphic lens flare, high-intensity strobe muzzle flash and explosion backlight, gritty twilight',
    colorGrade: 'bleach bypass film stock, high contrast, warm fiery oranges and cold metallic steels',
    textureCue: 'flying concrete debris, velocity streaks, heat distortion waves, hyper-sharp dynamic motion',
    keywords: [
      'action', 'chase', 'explosion', 'car', 'heist', 'gunfire', 'combat', 'fight',
      'agent', 'speed', 'bullet', 'strike', 'helicopter', 'crash'
    ],
  },
};

/**
 * Automatically detects the most appropriate cinematic genre from narrative keywords.
 */
export function detectGenre(scriptText: string, fallback?: string): string {
  if (fallback && fallback !== 'auto' && GENRE_PROFILES[fallback]) {
    return fallback;
  }

  const lower = scriptText.toLowerCase();
  let bestGenre = 'historical_epic';
  let maxMatches = -1;

  for (const [genreKey, profile] of Object.entries(GENRE_PROFILES)) {
    let matches = 0;
    for (const kw of profile.keywords) {
      if (lower.includes(kw)) {
        matches++;
      }
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestGenre = genreKey;
    }
  }

  return bestGenre;
}

/**
 * Extracts a concise title and logline from screenplay headers or story text.
 */
export function extractTitleAndLogline(scriptText: string, customTitle?: string): { title: string; logline: string } {
  if (customTitle && customTitle.trim()) {
    return {
      title: customTitle.trim(),
      logline: scriptText.slice(0, 160).replace(/\s+/g, ' ').trim(),
    };
  }

  const lines = scriptText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // Look for explicit title tags: "Title: ...", "SCENE: ..."
  for (const line of lines) {
    const m = /^(?:title|scene|project|film):\s*(.+)$/i.exec(line);
    if (m && m[1]) {
      return {
        title: m[1].replace(/["']/g, '').trim(),
        logline: lines.find(l => l !== line) || m[1],
      };
    }
  }

  // Look for screenplay slugline: e.g. "EXT. GIZA TEMPLE - DUSK"
  const slugline = lines.find(l => /^(?:EXT\.|INT\.)/i.test(l));
  if (slugline) {
    const clean = slugline.replace(/^(?:EXT\.|INT\.)\s*/i, '').replace(/-/g, '—').trim();
    return {
      title: clean.slice(0, 45),
      logline: lines.find(l => l !== slugline) || clean,
    };
  }

  // Fallback: use first sentence or line
  const firstLine = lines[0] || 'Cinematic Storyboard Sequence';
  const cleanFirst = firstLine.replace(/[^a-zA-Z0-9\s,'-]/g, '').trim();
  const words = cleanFirst.split(/\s+/).slice(0, 6).join(' ');
  const title = words.length > 3 ? words.charAt(0).toUpperCase() + words.slice(1) : 'Cinematic Storyboard';

  return {
    title,
    logline: cleanFirst,
  };
}

/**
 * Segments raw script text or prompt into N narrative dramatic beats.
 */
export function segmentNarrativeBeats(scriptText: string, targetCount = 4): string[] {
  const count = Math.max(3, Math.min(8, targetCount));
  const clean = scriptText.trim();

  // 1. Check for bullet points or numbered lists: "1. ... 2. ..."
  const listMatches = clean.split(/(?:^|\n)\s*(?:\d+[\.\)]|[-*•])\s+/).filter(s => s.trim().length > 3);
  if (listMatches.length >= count) {
    return listMatches.slice(0, count).map(s => s.trim().replace(/\n+/g, ' '));
  }

  // 2. Check for screenplay scene blocks or shot markers ("Shot 1:", "Shot 2:", "SCENE:")
  const shotMarkers = clean.split(/(?:^|\n)\s*(?:shot\s*\d+:|beat\s*\d+:)/i).filter(s => s.trim().length > 3);
  if (shotMarkers.length >= count) {
    return shotMarkers.slice(0, count).map(s => s.trim().replace(/\n+/g, ' '));
  }

  // 3. Sentence segmentation
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  if (sentences.length >= count) {
    // Distribute sentences across `count` beats
    const beats: string[] = [];
    const chunkSize = Math.ceil(sentences.length / count);
    for (let i = 0; i < count; i++) {
      const chunk = sentences.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length > 0) {
        beats.push(chunk.join(' '));
      }
    }
    if (beats.length === count) return beats;
  }

  // 4. If short synopsis or single sentence: generate dramatic progression
  const baseIdea = clean.replace(/\n+/g, ' ').slice(0, 180);
  const narrativeArc = [
    `Establishing the environment, scale, and atmosphere: ${baseIdea}`,
    `The protagonist approaches the central subject as action begins: ${baseIdea}`,
    `A critical turning point and dramatic tension unfolds: ${baseIdea}`,
    `The climactic discovery and emotional resolution: ${baseIdea}`,
    `The heroic aftermath and wide panoramic horizon: ${baseIdea}`,
    `Closing cinematic silence across the transformed world: ${baseIdea}`,
  ];

  return narrativeArc.slice(0, count);
}

/**
 * Builds composition-engineered visual prompt tailored to shot framing, lens, movement, and genre.
 */
export function buildDirectedPrompt(
  beatText: string,
  genre: string,
  framing: CameraFraming,
  lens: CameraLens,
  movement: CameraMovement,
): string {
  const profile = GENRE_PROFILES[genre] || GENRE_PROFILES.historical_epic;

  const framingMap: Record<CameraFraming, string> = {
    wide: 'cinematic wide establishing shot, grand environmental scope, deep spatial perspective',
    medium: '35mm anamorphic medium shot, balanced rule-of-thirds composition, subject in action',
    close: 'intense character close-up portrait, shallow depth of field, sharp catchlight focus',
    extreme_close: 'hyper-detailed macro insert shot, exquisite tactile texture, high contrast chiaroscuro',
  };

  const lensMap: Record<CameraLens, string> = {
    '24mm': '24mm ultra-sharp prime lens, sweeping atmospheric horizon',
    '35mm': 'classic 35mm cinema lens, realistic human perspective and spatial depth',
    '50mm': '50mm standard prime lens, natural geometry, soft background bokeh',
    '85mm': '85mm portrait telephoto lens, creamy background separation, compression',
  };

  const moveMap: Record<CameraMovement, string> = {
    'slow push in': 'forward push-in camera motion, rising dramatic intensity',
    'pan right': 'sweeping panoramic horizontal pan',
    'tilt up': 'low-angle upward tilt revealing monumental scale',
    'tracking': 'dynamic tracking gimbal shot, fluid cinematic movement',
    'static': 'locked-off master frame, formal balanced symmetry',
  };

  // Strip dialogue tags like "IMHOTEP: ..." from the image prompt
  const visualAction = beatText.replace(/^[A-Z0-9_ -]+:\s*["']?|["']$/g, '').trim();

  return [
    visualAction,
    profile.cameraRig,
    framingMap[framing],
    lensMap[lens],
    moveMap[movement],
    profile.lightingCue,
    profile.colorGrade,
    profile.textureCue,
  ].filter(Boolean).join(', ');
}

/**
 * Generates spoken narration / dialogue script line for each shot.
 */
export function buildDirectedNarration(beatText: string, idx: number, totalShots: number): string {
  // Check if dialogue is already quoted or formatted as CHARACTER: "..."
  const dialogueMatch = /(?:[A-Z0-9_ -]+:\s*)?["“]([^"”]+)["”]/i.exec(beatText);
  if (dialogueMatch && dialogueMatch[1]) {
    return dialogueMatch[1].trim();
  }

  // If character dialogue tag without quotes: "IMHOTEP: The stone will rise."
  const colonMatch = /^[A-Z0-9_ -]{2,20}:\s*(.+)$/.exec(beatText);
  if (colonMatch && colonMatch[1]) {
    return colonMatch[1].trim();
  }

  // Clean prose for voiceover
  let spoken = beatText
    .replace(/\([^)]*\)/g, '') // remove parentheticals
    .replace(/^(?:EXT\.|INT\.)[^-]+-\s*[A-Z]+\s*/i, '') // remove sluglines
    .replace(/^(?:Establishing the environment|The protagonist approaches|A critical turning point|The climactic discovery|The heroic aftermath):\s*/i, '')
    .trim();

  // If too long for a single shot, shorten to first complete thought
  if (spoken.length > 140) {
    const dot = spoken.indexOf('.');
    if (dot > 25 && dot < 140) {
      spoken = spoken.slice(0, dot + 1);
    }
  }

  if (!spoken || spoken.length < 5) {
    if (idx === 0) spoken = 'The journey begins in the shadows of the unknown.';
    else if (idx === totalShots - 1) spoken = 'And in the final light, the truth is laid bare.';
    else spoken = 'Every step forward deepens the mystery.';
  }

  return spoken;
}

/**
 * Breaks down raw script or synopsis into a full director sequence.
 */
export function directScript(options: ScriptBreakdownOptions): {
  title: string;
  genre: string;
  shots: DirectedShot[];
  totalDurationSec: number;
} {
  const genre = detectGenre(options.script, options.genre);
  const { title } = extractTitleAndLogline(options.script, options.title);
  const targetCount = Math.max(3, Math.min(8, options.shotCount || 4));
  const beats = segmentNarrativeBeats(options.script, targetCount);

  // Classic Director Shot Scale Progression
  const framingPresets: CameraFraming[] = ['wide', 'medium', 'close', 'wide', 'medium', 'extreme_close', 'wide', 'close'];
  const lensPresets: CameraLens[] = ['24mm', '35mm', '50mm', '85mm', '35mm', '85mm', '24mm', '50mm'];
  const movePresets: CameraMovement[] = ['slow push in', 'tracking', 'static', 'tilt up', 'pan right', 'slow push in', 'static', 'pan right'];
  const beatTypes: DirectedShot['beatType'][] = ['establishing', 'action', 'investigation', 'climax', 'conflict', 'resolution', 'resolution', 'resolution'];

  const shots: DirectedShot[] = beats.map((beat, idx) => {
    const shotNumber = String(idx + 1).padStart(3, '0');
    const shotId = `shot_${shotNumber}`;
    const framing = framingPresets[idx % framingPresets.length] || 'medium';
    const lens = lensPresets[idx % lensPresets.length] || '35mm';
    const movement = movePresets[idx % movePresets.length] || 'static';
    const beatType = beatTypes[idx % beatTypes.length] || 'action';

    const prompt = buildDirectedPrompt(beat, genre, framing, lens, movement);
    const narration = buildDirectedNarration(beat, idx, beats.length);

    // Calculate duration based on speech length (~2.4 words per second)
    const words = narration.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(4, Math.min(10, Math.ceil(words / 2.4) + 1));

    // Detect character names (ALL CAPS words preceding colons or in text)
    const characters: string[] = [];
    const charMatch = /([A-Z]{3,15})(?:\s*\(V\.O\.\))?:/g;
    let cm: RegExpExecArray | null;
    while ((cm = charMatch.exec(beat)) !== null) {
      if (cm[1] && !['EXT', 'INT', 'DUSK', 'DAWN', 'NIGHT', 'DAY', 'WIDE', 'CLOSE'].includes(cm[1])) {
        characters.push(cm[1]);
      }
    }

    return {
      shotId,
      order: idx + 1,
      title: `${framing.toUpperCase()} — ${beatType.toUpperCase()}`,
      prompt,
      framing,
      lens,
      movement,
      durationSec,
      narration,
      characters: Array.from(new Set(characters)),
      beatType,
    };
  });

  const totalDurationSec = shots.reduce((acc, s) => acc + s.durationSec, 0);

  return {
    title,
    genre,
    shots,
    totalDurationSec,
  };
}

/**
 * One-Click Script Breakdown: Directs the script, saves the movie project to disk,
 * and optionally invokes the 5-tier Router to auto-generate frames.
 */
export async function directScriptToStoryboard(options: ScriptBreakdownOptions): Promise<ScriptBreakdownResult> {
  if (!options.script || !options.script.trim()) {
    return { ok: false, error: 'A script, synopsis, or scene description is required.' };
  }

  const { title, genre, shots, totalDurationSec } = directScript(options);

  const baseSlug = options.projectId || title.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  const projectId = `${baseSlug.slice(0, 32)}-${Date.now().toString(36).slice(-4)}`;
  const projectDir = getStoryboardProjectDir(projectId);

  try {
    const projectMeta: MovieProject = {
      projectId,
      name: title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      freeOnly: options.freeOnly !== false,
      defaultResolution: [1024, 576],
      defaultDurationSec: 5,
      notes: `Genre: ${genre}. Auto-directed script breakdown: ${options.notes || options.script.slice(0, 120)}`,
    };

    MovieProjectRunner.createProject(projectDir, projectMeta, []);

    const shotEntries: ShotBibleEntry[] = shots.map((s) => ({
      shotId: s.shotId,
      scene: 'scene_01',
      characters: s.characters,
      action: s.prompt,
      camera: {
        framing: s.framing,
        lens: s.lens,
        movement: s.movement,
      },
      lighting: GENRE_PROFILES[genre]?.lightingCue || 'cinematic lighting',
      durationSec: s.durationSec,
      visualReferences: [],
      generationMethod: 'still',
      status: ShotStatus.PLANNED,
    }));

    const sceneManifest: SceneManifest = {
      sceneId: 'scene_01',
      title,
      description: options.notes || `Scene 01 (${genre})`,
      order: 1,
      shots: shotEntries.map(s => s.shotId),
    };

    MovieProjectRunner.addScene(projectDir, sceneManifest, shotEntries);
    fs.writeFileSync(
      path.join(projectDir, 'scenes', 'scene_01', 'manifest.json'),
      JSON.stringify(sceneManifest, null, 2),
      'utf-8',
    );

    // Write script lines and prompt specs to individual shot directories
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotDir = path.join(projectDir, 'scenes', 'scene_01', s.shotId);
      if (s.narration) {
        fs.writeFileSync(path.join(shotDir, 'script.txt'), s.narration, 'utf-8');
      }
      const promptFile = path.join(shotDir, 'prompt.json');
      if (fs.existsSync(promptFile)) {
        try {
          const pData = JSON.parse(fs.readFileSync(promptFile, 'utf-8'));
          pData.framing = s.framing;
          pData.lens = s.lens;
          pData.movement = s.movement;
          pData.genre = genre;
          pData.prompt = s.prompt;
          fs.writeFileSync(promptFile, JSON.stringify(pData, null, 2), 'utf-8');
        } catch {
          /* non-fatal */
        }
      }
    }

    // Optional: auto-generate keyframe stills via free router
    if (options.autoGenerateFrames) {
      try {
        const router = createStandardRouter();
        for (const shot of shotEntries) {
          const req: GenerationRequest = {
            kind: 'image',
            shotId: shot.shotId,
            shotDir: path.join(projectDir, 'scenes', 'scene_01', shot.shotId),
            prompt: shot.action,
            width: 1024,
            height: 576,
            durationSec: shot.durationSec,
            freeOnly: true,
            allowWatermark: true,
            allowDeferred: false,
          };
          await router.generate(req);
        }
      } catch (err) {
        console.warn(`[script-director] Auto-generation non-fatal warning for ${projectId}:`, err);
      }
    }

    return {
      ok: true,
      projectId,
      title,
      genre,
      shots,
      totalDurationSec,
      projectDir,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to create auto-directed storyboard: ${err?.message || String(err)}`,
    };
  }
}
