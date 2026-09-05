/**
 * ancient-pathways-adapter.ts — Local 2D Parallax / Showrunner Adapter
 *
 * Bridges HomeBot's GenerationRouter to Ancient Pathways' local 2D animation engine.
 *
 * Why this provider wins:
 * 1. 100% FREE ($0.00): Offline CPU rendering (PIL compositing + FFmpeg).
 * 2. CHARACTER CONSISTENCY: Natively supports multiple character references mapped
 *    to the 12 canonical character libraries (Imhotep, Socrates, Vitruvius, Masamune,
 *    Pakal, Leila, Flappy, Leif, Dhara, Meng Tian, Nebuchadnezzar) and articulated rigs.
 * 3. DUAL KIND: Generates both 1080p/1440p stills and animated MP4 video clips.
 * 4. IMMEDIATE AVAILABILITY: Unlike deferred cloud workers (Colab T4), runs locally
 *    without human intervention when workspace/render.lock is clear.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  GenerationCapability,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
} from './types';
import {
  checkRenderLock,
  resolveAncientPathwaysDir,
  runShowrunner,
} from '../ancient-pathways';

export const ANCIENT_PATHWAYS_PROVIDER_ID = 'ancient-pathways';

// Supported historical characters in Ancient Pathways
const KNOWN_CHARACTERS = new Set([
  'imhotep',
  'socrates',
  'vitruvius',
  'masamune',
  'pakal',
  'leila',
  'flappy',
  'leif',
  'dhara',
  'mengtian',
  'nebuchadnezzar',
]);

/**
 * Infer comma-separated characters from request (characterRefs or prompt).
 */
export function extractCharactersFromRequest(req: GenerationRequest): string {
  const found = new Set<string>();

  // Check characterRefs paths
  if (req.characterRefs) {
    for (const ref of req.characterRefs) {
      const lower = ref.toLowerCase();
      for (const char of KNOWN_CHARACTERS) {
        if (lower.includes(char)) {
          found.add(char);
        }
      }
    }
  }

  // Check prompt
  const lowerPrompt = req.prompt.toLowerCase();
  for (const char of KNOWN_CHARACTERS) {
    if (lowerPrompt.includes(char)) {
      found.add(char);
    }
  }

  if (found.size > 0) {
    return [...found].join(',');
  }

  // Default to standard host pair if none identified
  return 'leila,flappy';
}

// ---------------------------------------------------------------------------
// Probe — what Ancient Pathways can do right now
// ---------------------------------------------------------------------------

export async function probeAncientPathways(
  _req: GenerationRequest,
): Promise<GenerationCapability> {
  const dir = resolveAncientPathwaysDir();
  if (!dir || !fs.existsSync(dir)) {
    return {
      canGenerate: false,
      reason: 'Ancient Pathways repo not found at Desktop/Ancient Pathways',
      costMicroUsd: 0,
      maxDurationSec: 0,
      maxWidth: 0,
      maxHeight: 0,
      imageToVideo: false,
      referenceImages: 'none',
      watermark: 'none',
      availability: 'offline',
      deferred: false,
    };
  }

  const lock = checkRenderLock(dir);
  const isLocked = lock.locked;

  return {
    canGenerate: true,
    costMicroUsd: 0, // genuinely free local CPU engine
    maxDurationSec: 300,
    maxWidth: 2560,
    maxHeight: 1440,
    imageToVideo: true,
    referenceImages: 'multi', // 12 canonical character model-sheet libraries
    watermark: 'none',
    availability: isLocked ? 'queued' : 'ready',
    deferred: false,
    throughputPerMin: 2,
    etaSec: isLocked ? 120 : 15,
  };
}

// ---------------------------------------------------------------------------
// Generate — produce still or animated shot via Ancient Pathways
// ---------------------------------------------------------------------------

export async function generateAncientPathwaysShot(
  req: GenerationRequest,
): Promise<GenerationResult> {
  const dir = resolveAncientPathwaysDir();
  if (!dir || !fs.existsSync(dir)) {
    return {
      status: 'failed',
      provider: ANCIENT_PATHWAYS_PROVIDER_ID,
      error: 'Ancient Pathways repo not found at Desktop/Ancient Pathways',
    };
  }

  const lock = checkRenderLock(dir);
  if (lock.locked) {
    return {
      status: 'failed',
      provider: ANCIENT_PATHWAYS_PROVIDER_ID,
      error: `Render lock active: ${lock.message}`,
    };
  }

  const characters = extractCharactersFromRequest(req);
  const duration = req.durationSec ?? (req.kind === 'video' ? 8 : 4);
  const name = `shot_${req.shotId}`;

  try {
    const result = await runShowrunner({
      prompt: req.prompt,
      duration,
      characters,
      name,
      dir,
    });

    if (!result.ok || !result.outputPath) {
      return {
        status: 'failed',
        provider: ANCIENT_PATHWAYS_PROVIDER_ID,
        error: result.error || 'Showrunner failed to produce output',
      };
    }

    // Ensure output is copied or conformed into req.shotDir if requested
    let targetFile = result.outputPath;
    if (req.shotDir) {
      fs.mkdirSync(req.shotDir, { recursive: true });
      const destDir = path.join(req.shotDir, req.kind === 'video' ? 'video' : 'image');
      fs.mkdirSync(destDir, { recursive: true });
      const ext = path.extname(result.outputPath);
      const destPath = path.join(destDir, `${req.shotId}${ext}`);
      try {
        fs.copyFileSync(result.outputPath, destPath);
        targetFile = destPath;
      } catch {
        // If copy fails, keep original output path
      }
    }

    return {
      status: 'done',
      provider: ANCIENT_PATHWAYS_PROVIDER_ID,
      files: [targetFile],
      costMicroUsd: 0,
    };
  } catch (err) {
    return {
      status: 'failed',
      provider: ANCIENT_PATHWAYS_PROVIDER_ID,
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Adapter registration — GenerationProvider
// ---------------------------------------------------------------------------

export const ancientPathwaysProvider: GenerationProvider = {
  id: ANCIENT_PATHWAYS_PROVIDER_ID,
  kind: 'both',
  probe: probeAncientPathways,
  generate: generateAncientPathwaysShot,
};
