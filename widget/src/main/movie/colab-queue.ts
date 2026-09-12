/**
 * colab-queue.ts — Google Colab worker queue and portable job orchestration.
 *
 * Implements Media Studio Task 4 (Colab round trip):
 * 1. Portable unique jobs with deterministic IDs independent of OS absolute paths.
 * 2. Drive discovery across Windows mounts (G:\My Drive, %USERPROFILE%\Google Drive)
 *    and local staging fallback (~/.homebot/colab_queue).
 * 3. Asset upload/staging for character references into queue inputs/.
 * 4. Worker result import with full image integrity validation (validateMovieImageFiles).
 * 5. Robust retry, resume, and cancel operations surviving runtime restarts and partial results.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomUUID } from 'crypto';
import type { GenerationRequest } from './types';
import { ShotStatus } from './types';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';
import { validateMovieImageFiles } from './image-output';

export const COLAB_QUEUE_VERSION = '1.0';

export interface ColabJobManifest {
  version: typeof COLAB_QUEUE_VERSION;
  jobId: string;
  ticketId: string;
  createdAt: string;
  shotId: string;
  shotDir: string;
  projectId?: string;
  sceneId?: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  /** Original character reference paths passed in request */
  characterRefs?: string[];
  /** Queue-relative paths for character references, e.g. "inputs/<jobId>/ref_0.png" */
  stagedCharacterRefs: string[];
  /** Queue-relative output path, e.g. "outputs/<jobId>/<shotId>.png" */
  relativeOutputPath: string;
  outputPattern?: string;
  status: ShotStatus.AWAITING_WORKER | ShotStatus.IMAGE_GENERATED | ShotStatus.FAILED | 'CANCELLED';
  attempts: number;
  completedAt?: string;
  outputFile?: string;
  error?: string;
}

export interface DriveQueueInfo {
  available: boolean;
  rootDir: string;
  ticketsDir: string;
  inputsDir: string;
  outputsDir: string;
  source: 'env' | 'google-drive-mount' | 'local-staging';
}

export type ColabImportResult =
  | { status: 'imported'; imagePath: string; ticketId: string }
  | { status: 'pending'; ticketId: string }
  | { status: 'failed'; error: string; ticketId: string }
  | { status: 'cancelled'; ticketId: string };

/**
 * Discover the Google Drive or local staging queue location.
 */
export function discoverDriveQueue(customRoot?: string): DriveQueueInfo {
  let rootDir = customRoot;
  let source: DriveQueueInfo['source'] = 'local-staging';

  if (rootDir && fs.existsSync(rootDir)) {
    source = 'local-staging';
  } else if (process.env.HOMEBOT_COLAB_QUEUE && fs.existsSync(process.env.HOMEBOT_COLAB_QUEUE)) {
    rootDir = process.env.HOMEBOT_COLAB_QUEUE;
    source = 'env';
  } else if (process.env.HOMEBOT_DRIVE_ROOT && fs.existsSync(process.env.HOMEBOT_DRIVE_ROOT)) {
    rootDir = path.join(process.env.HOMEBOT_DRIVE_ROOT, 'HomeBot', 'movie_queue');
    source = 'env';
  } else if (process.env.GOOGLE_DRIVE_PATH && fs.existsSync(process.env.GOOGLE_DRIVE_PATH)) {
    rootDir = path.join(process.env.GOOGLE_DRIVE_PATH, 'HomeBot', 'movie_queue');
    source = 'env';
  } else {
    // Probe Windows mount paths for Google Drive
    const candidateMounts = [
      path.join('G:', 'My Drive'),
      'G:\\',
      path.join(os.homedir(), 'Google Drive', 'My Drive'),
      path.join(os.homedir(), 'Google Drive'),
      path.join(os.homedir(), 'My Drive'),
    ];

    for (const mount of candidateMounts) {
      if (fs.existsSync(mount)) {
        const hbQueue = path.join(mount, 'HomeBot', 'movie_queue');
        const apQueue = path.join(mount, 'Ancient_Pathways', 'movie_queue');
        rootDir = fs.existsSync(apQueue) ? apQueue : hbQueue;
        source = 'google-drive-mount';
        break;
      }
    }
  }

  // Fallback to local user data staging if Google Drive is not mounted
  if (!rootDir) {
    rootDir = path.join(os.homedir(), '.homebot', 'colab_queue');
    source = 'local-staging';
  }

  const ticketsDir = path.join(rootDir, 'tickets');
  const inputsDir = path.join(rootDir, 'inputs');
  const outputsDir = path.join(rootDir, 'outputs');

  try {
    fs.mkdirSync(ticketsDir, { recursive: true });
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.mkdirSync(outputsDir, { recursive: true });
  } catch {
    // Ignore permissions errors during read-only discovery
  }

  return {
    available: fs.existsSync(rootDir),
    rootDir,
    ticketsDir,
    inputsDir,
    outputsDir,
    source,
  };
}

/**
 * Compute deterministic unique job ID based on shot inputs.
 */
export function computeColabJobId(req: GenerationRequest): string {
  const hash = createHash('sha256');
  hash.update(req.shotId || 'shot');
  hash.update(req.prompt || '');
  hash.update(String(req.width || 1024));
  hash.update(String(req.height || 576));
  if (Array.isArray(req.characterRefs)) {
    hash.update(req.characterRefs.join(';'));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Stage a shot request into the Colab Drive queue:
 * - Creates portable manifest with relative paths
 * - Copies character reference images into queue inputs/
 * - Writes ticketsDir/ticket.json and shotDir/ticket.json
 * - Updates shotDir/status.json to AWAITING_WORKER
 */
export function stageColabJob(
  req: GenerationRequest,
  customQueue?: DriveQueueInfo,
): ColabJobManifest {
  assertProviderOnlineAccess('Colab');

  const queue = customQueue ?? discoverDriveQueue();
  const jobId = computeColabJobId(req);
  const ticketId = `colab_ticket_${req.shotId}_${jobId.slice(0, 8)}`;

  // Stage character reference images into queue inputs/<jobId>/
  const stagedCharacterRefs: string[] = [];
  if (Array.isArray(req.characterRefs) && req.characterRefs.length > 0) {
    const jobInputsDir = path.join(queue.inputsDir, jobId);
    fs.mkdirSync(jobInputsDir, { recursive: true });

    req.characterRefs.forEach((refPath, index) => {
      if (fs.existsSync(refPath)) {
        const ext = path.extname(refPath) || '.png';
        const targetFilename = `ref_${index}${ext}`;
        const targetAbs = path.join(jobInputsDir, targetFilename);
        fs.copyFileSync(refPath, targetAbs);
        // Store queue-relative path using forward slashes for Linux/Colab compatibility
        stagedCharacterRefs.push(`inputs/${jobId}/${targetFilename}`);
      }
    });
  }

  const relativeOutputPath = `outputs/${jobId}/${req.shotId}.png`;

  const manifest: ColabJobManifest = {
    version: COLAB_QUEUE_VERSION,
    jobId,
    ticketId,
    createdAt: new Date().toISOString(),
    shotId: req.shotId,
    shotDir: req.shotDir,
    prompt: req.prompt,
    width: req.width,
    height: req.height,
    characterRefs: req.characterRefs,
    stagedCharacterRefs,
    relativeOutputPath,
    outputPattern: req.shotDir ? path.join(req.shotDir, 'image', `${req.shotId}.png`) : undefined,
    status: ShotStatus.AWAITING_WORKER,
    attempts: 1,
  };

  // Write to queue tickets folder
  fs.mkdirSync(queue.ticketsDir, { recursive: true });
  fs.writeFileSync(
    path.join(queue.ticketsDir, `${ticketId}.json`),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  // Also write indexed by jobId for idempotent lookup
  fs.writeFileSync(
    path.join(queue.ticketsDir, `${jobId}.json`),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // Update shotDir local files if shotDir is present
  if (req.shotDir) {
    fs.mkdirSync(req.shotDir, { recursive: true });

    // Write prompt.json
    fs.writeFileSync(
      path.join(req.shotDir, 'prompt.json'),
      JSON.stringify(req, null, 2),
      'utf-8',
    );

    // Write ticket.json
    fs.writeFileSync(
      path.join(req.shotDir, 'ticket.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    // Update status.json
    const statusPath = path.join(req.shotDir, 'status.json');
    let state: any = {};
    if (fs.existsSync(statusPath)) {
      try {
        state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      } catch {
        // ignore
      }
    }

    state.shotId = req.shotId;
    state.status = ShotStatus.AWAITING_WORKER;
    state.deferredTicket = ticketId;
    state.deferredProvider = 'colab-worker';
    state.characterRevisions = state.characterRevisions || {};
    state.attempts = (state.attempts ?? 0) + 1;
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
  }

  return manifest;
}

/**
 * Check if the Colab worker has completed generation for a ticket,
 * validate the output image, and atomically ingest it into the shot directory.
 */
export function checkAndIngestColabResult(
  shotDir: string,
  ticketIdOrJobId: string,
  customQueue?: DriveQueueInfo,
): ColabImportResult {
  const queue = customQueue ?? discoverDriveQueue();

  // Find ticket manifest either in queue or in local shotDir
  let manifest: ColabJobManifest | null = null;
  const queueTicketPath = path.join(queue.ticketsDir, `${ticketIdOrJobId}.json`);
  const localTicketPath = path.join(shotDir, 'ticket.json');

  if (fs.existsSync(queueTicketPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(queueTicketPath, 'utf-8')) as ColabJobManifest;
    } catch {
      // ignore
    }
  }

  if (!manifest && fs.existsSync(localTicketPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(localTicketPath, 'utf-8')) as ColabJobManifest;
    } catch {
      // ignore
    }
  }

  if (!manifest) {
    return { status: 'pending', ticketId: ticketIdOrJobId };
  }

  const ticketId = manifest.ticketId || ticketIdOrJobId;

  // If worker or user cancelled
  if (manifest.status === 'CANCELLED') {
    return { status: 'cancelled', ticketId };
  }

  // If worker failed
  if (manifest.status === ShotStatus.FAILED || (manifest.status as string) === 'FAILED') {
    const error = manifest.error || 'Worker failed during image generation';
    const statusPath = path.join(shotDir, 'status.json');
    if (fs.existsSync(statusPath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        state.status = ShotStatus.FAILED;
        state.lastError = error;
        state.updatedAt = new Date().toISOString();
        fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
      } catch {
        // ignore
      }
    }
    return { status: 'failed', error, ticketId };
  }

  // Probe output file candidates:
  // 1. Queue relative path: queue.rootDir / manifest.relativeOutputPath
  // 2. manifest.outputFile (if populated by worker)
  // 3. Local shotDir/image/<shotId>.png
  const queueOutPath = manifest.relativeOutputPath
    ? path.join(queue.rootDir, manifest.relativeOutputPath.replace(/\//g, path.sep))
    : undefined;

  let candidateFile: string | undefined;
  if (queueOutPath && fs.existsSync(queueOutPath)) {
    candidateFile = queueOutPath;
  } else if (manifest.outputFile && fs.existsSync(manifest.outputFile)) {
    candidateFile = manifest.outputFile;
  } else {
    const localImg = path.join(shotDir, 'image', `${manifest.shotId}.png`);
    if (fs.existsSync(localImg)) {
      candidateFile = localImg;
    }
  }

  if (!candidateFile) {
    if (manifest.status === ShotStatus.IMAGE_GENERATED) {
      return {
        status: 'failed',
        error: 'Worker marked ticket complete but output image was missing',
        ticketId,
      };
    }
    return { status: 'pending', ticketId };
  }

  // Ensure output file is a readable non-empty file
  try {
    const stat = fs.statSync(candidateFile);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('Image output is not a usable file.');
    }
  } catch {
    const errorMsg = 'The worker image is unreadable. Replace it with a complete image and run the shot again.';
    markShotFailed(shotDir, errorMsg);
    return { status: 'failed', error: errorMsg, ticketId };
  }

  // Atomically copy to shotDir/image/<shotId>.png if not already there
  const imageDir = path.join(shotDir, 'image');
  fs.mkdirSync(imageDir, { recursive: true });
  const finalDest = path.join(imageDir, `${manifest.shotId}.png`);

  if (path.resolve(candidateFile) !== path.resolve(finalDest)) {
    const tempDest = path.join(imageDir, `.${randomUUID()}.tmp`);
    try {
      fs.copyFileSync(candidateFile, tempDest);
      fs.renameSync(tempDest, finalDest);
    } catch {
      if (fs.existsSync(tempDest)) {
        try { fs.unlinkSync(tempDest); } catch { /* ignore */ }
      }
      const errorMsg = 'Failed to copy worker image to shot directory.';
      markShotFailed(shotDir, errorMsg);
      return { status: 'failed', error: errorMsg, ticketId };
    }
  }

  // Validate image integrity in the shot folder
  try {
    validateMovieImageFiles(shotDir, [finalDest]);
  } catch {
    // If validation fails, remove corrupt file and fail shot
    try { fs.unlinkSync(finalDest); } catch { /* ignore */ }
    const errorMsg = 'The worker image is unreadable. Replace it with a complete image and run the shot again.';
    markShotFailed(shotDir, errorMsg);
    return { status: 'failed', error: errorMsg, ticketId };
  }

  // Update shotDir/status.json
  const statusPath = path.join(shotDir, 'status.json');
  let state: any = {};
  if (fs.existsSync(statusPath)) {
    try {
      state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  state.shotId = manifest.shotId;
  state.status = ShotStatus.IMAGE_GENERATED;
  state.outputFiles = [path.relative(shotDir, finalDest)];
  state.deferredTicket = undefined;
  state.lastError = undefined;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');

  // Update manifest status in queue
  manifest.status = ShotStatus.IMAGE_GENERATED;
  manifest.completedAt = new Date().toISOString();
  manifest.outputFile = finalDest;

  if (fs.existsSync(queueTicketPath)) {
    try {
      fs.writeFileSync(queueTicketPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(localTicketPath)) {
    try {
      fs.writeFileSync(localTicketPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  return {
    status: 'imported',
    imagePath: finalDest,
    ticketId,
  };
}

/**
 * Cancel a pending Colab ticket in queue and shot directory.
 */
export function cancelColabJob(
  shotDir: string,
  ticketIdOrJobId: string,
  customQueue?: DriveQueueInfo,
): void {
  const queue = customQueue ?? discoverDriveQueue();
  const queueTicketPath = path.join(queue.ticketsDir, `${ticketIdOrJobId}.json`);
  const localTicketPath = path.join(shotDir, 'ticket.json');

  const updateManifest = (filePath: string) => {
    if (fs.existsSync(filePath)) {
      try {
        const m = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ColabJobManifest;
        m.status = 'CANCELLED';
        fs.writeFileSync(filePath, JSON.stringify(m, null, 2), 'utf-8');
      } catch {
        // ignore
      }
    }
  };

  updateManifest(queueTicketPath);
  updateManifest(localTicketPath);

  const statusPath = path.join(shotDir, 'status.json');
  if (fs.existsSync(statusPath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      state.status = ShotStatus.PLANNED;
      state.deferredTicket = undefined;
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }
}

/**
 * Retry a failed or cancelled Colab ticket.
 */
export function retryColabJob(
  shotDir: string,
  ticketIdOrJobId: string,
  customQueue?: DriveQueueInfo,
): ColabJobManifest | null {
  const queue = customQueue ?? discoverDriveQueue();
  const queueTicketPath = path.join(queue.ticketsDir, `${ticketIdOrJobId}.json`);
  const localTicketPath = path.join(shotDir, 'ticket.json');

  let manifest: ColabJobManifest | null = null;
  if (fs.existsSync(queueTicketPath)) {
    try { manifest = JSON.parse(fs.readFileSync(queueTicketPath, 'utf-8')); } catch { /* ignore */ }
  }
  if (!manifest && fs.existsSync(localTicketPath)) {
    try { manifest = JSON.parse(fs.readFileSync(localTicketPath, 'utf-8')); } catch { /* ignore */ }
  }

  if (!manifest) return null;

  // Clean up any partial output
  if (manifest.relativeOutputPath) {
    const outPath = path.join(queue.rootDir, manifest.relativeOutputPath.replace(/\//g, path.sep));
    if (fs.existsSync(outPath)) {
      try { fs.unlinkSync(outPath); } catch { /* ignore */ }
    }
  }

  manifest.status = ShotStatus.AWAITING_WORKER;
  manifest.attempts = (manifest.attempts || 0) + 1;
  manifest.error = undefined;
  manifest.completedAt = undefined;

  fs.mkdirSync(queue.ticketsDir, { recursive: true });
  fs.writeFileSync(queueTicketPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(localTicketPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const statusPath = path.join(shotDir, 'status.json');
  if (fs.existsSync(statusPath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      state.status = ShotStatus.AWAITING_WORKER;
      state.deferredTicket = manifest.ticketId;
      state.lastError = undefined;
      state.attempts = manifest.attempts;
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  return manifest;
}

function markShotFailed(shotDir: string, error: string): void {
  const statusPath = path.join(shotDir, 'status.json');
  if (fs.existsSync(statusPath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      state.status = ShotStatus.FAILED;
      state.lastError = error;
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }
}
