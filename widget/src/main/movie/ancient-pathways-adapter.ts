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
 * 3. VIDEO ONLY: the Showrunner always renders an MP4 scene. It used to be
 *    registered for stills too, so a frame request rendered a video, failed the
 *    image check, and cost a render every time.
 * 4. IMMEDIATE AVAILABILITY: Unlike deferred cloud workers (Colab T4), runs locally
 *    without human intervention when workspace/render.lock is clear.
 */

import { createHash } from 'crypto';
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

/**
 * Production folder for one request. Ancient Pathways resumes any shot already
 * in that folder, whatever its length — so reusing `shot_<id>` after the shot's
 * prompt or duration changed served the old clip, and QA rejected it for
 * "duration drift" (a 0.8 s clip from an earlier run against a 2 s request).
 * A fingerprint of what is being made keeps identical re-runs resumable and
 * gives a changed request a fresh production.
 */
export function showrunnerProductionName(shotId: string, prompt: string, duration: number, characters: string): string {
  const safeId = String(shotId).replace(/[^\w-]+/g, '_').slice(0, 60) || 'shot';
  const fingerprint = createHash('sha256').update(JSON.stringify([prompt, duration, characters])).digest('hex').slice(0, 10);
  return `shot_${safeId}_${fingerprint}`;
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
// Generate — produce an animated shot via Ancient Pathways
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

  if (req.kind !== 'video') {
    return {
      status: 'failed',
      provider: ANCIENT_PATHWAYS_PROVIDER_ID,
      error: 'Ancient Pathways makes video clips, not still frames.',
    };
  }

  const characters = extractCharactersFromRequest(req);
  const duration = req.durationSec ?? 8;
  const name = showrunnerProductionName(req.shotId, req.prompt, duration, characters);

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
      const destDir = path.join(req.shotDir, 'video');
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
  kind: 'video',
  probe: probeAncientPathways,
  generate: generateAncientPathwaysShot,
};
