/**
 * colab-adapter.ts — Google Colab T4 GPU worker adapter for character-consistent stills.
 *
 * Why this adapter exists:
 *
 * 1. THE HARDWARE REALITY. The RTX 2050 has 4 GB VRAM and cannot run SDXL or
 *    IP-Adapter. Free cloud APIs (Pollinations, Imagen 3) report referenceImages: 'none'
 *    and cannot take character references. The only 16 GB GPU available at $0.00 is
 *    Google Colab T4.
 *
 * 2. THE DEFERRED TICKET MODEL. Colab cannot be triggered unattended via background
 *    API on free/Pro tiers because `drive.mount()` requires interactive OAuth consent
 *    in the browser. Therefore, this adapter reports `deferred: true` and
 *    `availability: 'needs_human'`.
 *
 * 3. THE CONTRACT. When routed, `generate()` writes an immutable `ticket.json` and sets
 *    `status.json` to `AWAITING_WORKER`. Running the Colab notebook
 *    (`notebooks/colab_sdxl_ipadapter.ipynb`) processes the ticket with IP-Adapter
 *    and writes the character-consistent still to `image/{shotId}.png`.
 */

import * as path from 'path';
import type {
  GenerationCapability,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
} from './types';
import { ShotStatus } from './types';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';
import { stageColabJob } from './colab-queue';

export const COLAB_WORKER_ID = 'colab-worker';

export interface ColabWorkerTicket {
  ticketId: string;
  createdAt: string;
  shotId: string;
  shotDir: string;
  prompt: string;
  width: number;
  height: number;
  characterRefs?: string[];
  status: ShotStatus.AWAITING_WORKER;
  outputPattern: string;
}

// ---------------------------------------------------------------------------
// Probe — what Colab T4 can do
// ---------------------------------------------------------------------------

export async function probeColabWorker(
  _req: GenerationRequest,
): Promise<GenerationCapability> {
  assertProviderOnlineAccess('Colab');
  return {
    canGenerate: true,
    costMicroUsd: 0, // genuinely free on Colab T4
    maxDurationSec: 0,
    maxWidth: 2048,
    maxHeight: 2048,
    imageToVideo: false,
    referenceImages: 'multi', // SDXL + IP-Adapter on T4 (16 GB) natively supports multi-reference conditioning
    watermark: 'none',
    availability: 'needs_human', // Colab requires manual run / browser session
    deferred: true,
    throughputPerMin: 4, // ~15s per SDXL image on T4
    etaSec: 60,
  };
}

// ---------------------------------------------------------------------------
// Generate — create deferred ticket and transition to AWAITING_WORKER
// ---------------------------------------------------------------------------

export async function generateColabShot(req: GenerationRequest): Promise<GenerationResult> {
  if (!req.allowDeferred) {
    return {
      status: 'failed',
      provider: COLAB_WORKER_ID,
      error: 'returns deferred results and this request needs one now',
    };
  }

  try {
    // A deferred remote job is still an online choice, even before its ticket
    // is handed to the operator or picked up by a synced-folder worker.
    assertProviderOnlineAccess('Colab');

    const manifest = stageColabJob(req);

    return {
      status: 'deferred',
      provider: COLAB_WORKER_ID,
      ticket: manifest.ticketId,
      where: req.shotDir
        ? `Ticket written to ${path.join(req.shotDir, 'ticket.json')} (run notebooks/colab_sdxl_ipadapter.ipynb)`
        : 'Colab worker queue (run notebooks/colab_sdxl_ipadapter.ipynb)',
      etaSec: 60,
    };
  } catch (err) {
    return {
      status: 'failed',
      provider: COLAB_WORKER_ID,
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Adapter registration — GenerationProvider
// ---------------------------------------------------------------------------

export const colabProvider: GenerationProvider = {
  id: COLAB_WORKER_ID,
  kind: 'image' as const,
  probe: probeColabWorker,
  generate: generateColabShot,
};
