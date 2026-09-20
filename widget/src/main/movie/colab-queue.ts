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
import { isWithinHomeDir } from '../utils/home-boundary';
import { validateMovieImageFile, validateMovieImageFiles } from './image-output';

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
  /** Unique generation identity. Absent only on tickets staged by older builds. */
  attemptId?: string;
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

export interface ColabQueueJob {
  ticketId: string;
  jobId: string;
  sceneId: string;
  shotId: string;
  createdAt: string;
  attempts: number;
  status: ColabJobManifest['status'];
  error?: string;
  outputReady: boolean;
  canCancel: boolean;
  canRetry: boolean;
}

export interface ColabJobMutation {
  projectDir: string;
  ticketId: string;
  /** Reject a click made against an older queue snapshot. */
  expectedAttempts?: number;
}

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// Keep `<ticketId>.json` below the common 255-character filename limit. This
// is deliberately wider than a shot path segment because stageColabJob adds a
// prefix and hash to an otherwise-valid (up to 128 character) shot ID.
const MAX_TICKET_ID_LENGTH = 240;
const SAFE_TICKET_ID = /^colab_ticket_[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isSafePathSegment(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PATH_SEGMENT.test(value);
}

function isSafeTicketId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TICKET_ID_LENGTH && SAFE_TICKET_ID.test(value);
}

function createAttemptId(attempts: number): string {
  return `attempt_${attempts}_${randomUUID()}`;
}

function attemptOutputPath(jobId: string, attemptId: string, shotId: string): string {
  return `outputs/${jobId}/${attemptId}/${shotId}.png`;
}

/**
 * A same-directory rename prevents readers from observing a partially-written
 * manifest. Three separate files cannot be committed as one filesystem
 * transaction, so a crash may still leave aliases at different revisions;
 * project-scoped reads reconcile them and every individual alias stays valid.
 */
function writeManifestAtomically(filePath: string, json: string): void {
  const temporary = path.join(path.dirname(filePath), `.colab-manifest-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, json, { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* renamed or already absent */ }
  }
}

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
  if (!isSafePathSegment(req.shotId)) throw new Error('That shot ID is not safe for the Colab queue.');
  const jobId = computeColabJobId(req);
  const ticketId = `colab_ticket_${req.shotId}_${jobId.slice(0, 8)}`;
  if (!isSafeTicketId(ticketId)) throw new Error('That Colab ticket ID is too long for the queue filesystem.');
  const attempts = 1;
  const attemptId = createAttemptId(attempts);

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

  const relativeOutputPath = attemptOutputPath(jobId, attemptId, req.shotId);

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
    attempts,
    attemptId,
  };

  // Write to queue tickets folder
  fs.mkdirSync(queue.ticketsDir, { recursive: true });
  writeManifestAtomically(
    path.join(queue.ticketsDir, `${ticketId}.json`),
    JSON.stringify(manifest, null, 2),
  );
  // Also write indexed by jobId for idempotent lookup
  writeManifestAtomically(
    path.join(queue.ticketsDir, `${jobId}.json`),
    JSON.stringify(manifest, null, 2),
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
    writeManifestAtomically(
      path.join(req.shotDir, 'ticket.json'),
      JSON.stringify(manifest, null, 2),
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
  const localTicketPath = path.join(shotDir, 'ticket.json');
  const localManifest = readJsonFile<ColabJobManifest>(localTicketPath);
  const localIsAuthoritative = !!localManifest && manifestOwnsShot(localManifest, localManifest, shotDir);

  // A copied/tampered local ticket must not redirect ingestion to another
  // project's shot. Its presence is a reason to fail closed, not to fall back
  // to a global queue alias.
  if (localManifest && !localIsAuthoritative) {
    return { status: 'pending', ticketId: ticketIdOrJobId };
  }

  // The local ticket is HomeBot's attempt authority. A notebook can finish an
  // older attempt after cancel -> retry and overwrite either queue alias, but
  // it cannot replace this project-local identity.
  if (localManifest?.status === 'CANCELLED') {
    return { status: 'cancelled', ticketId: localManifest.ticketId || ticketIdOrJobId };
  }

  let manifest: ColabJobManifest | null = localManifest;
  if (localManifest && localIsAuthoritative) {
    const queueCandidates = [
      readJsonFile<ColabJobManifest>(path.join(queue.ticketsDir, `${localManifest.ticketId}.json`)),
      readJsonFile<ColabJobManifest>(path.join(queue.ticketsDir, `${localManifest.jobId}.json`)),
    ].filter((item): item is ColabJobManifest => manifestOwnsShot(item, localManifest, shotDir) && sameAttempt(item, localManifest));
    // Either alias may be the one the notebook processed. Prefer a terminal
    // state from the current attempt; otherwise the local pending copy wins.
    if (localManifest.status === ShotStatus.AWAITING_WORKER) {
      manifest = queueCandidates.find(item => item.status === ShotStatus.FAILED) ??
        queueCandidates.find(item => item.status === ShotStatus.IMAGE_GENERATED) ??
        queueCandidates.find(item => item.status === 'CANCELLED') ?? localManifest;
    }
  } else {
    // Compatibility for a legacy/local-missing call site. Normal project runs
    // always have ticket.json and therefore use the authority path above.
    if (!isSafeTicketId(ticketIdOrJobId) && !isSafePathSegment(ticketIdOrJobId)) {
      return { status: 'pending', ticketId: ticketIdOrJobId };
    }
    const legacy = readJsonFile<ColabJobManifest>(path.join(queue.ticketsDir, `${ticketIdOrJobId}.json`));
    manifest = legacy &&
      (legacy.ticketId === ticketIdOrJobId || legacy.jobId === ticketIdOrJobId) &&
      manifestOwnsShot(legacy, legacy, shotDir)
      ? legacy
      : null;
  }

  if (!manifest) {
    return { status: 'pending', ticketId: ticketIdOrJobId };
  }

  const authoritative = localManifest && localIsAuthoritative ? localManifest : manifest;
  const ticketId = authoritative.ticketId || ticketIdOrJobId;

  // If worker or user cancelled
  if (manifest.status === 'CANCELLED') {
    return { status: 'cancelled', ticketId };
  }

  // If worker failed
  if (manifest.status === ShotStatus.FAILED || (manifest.status as string) === 'FAILED') {
    const error = manifest.error || 'Worker failed during image generation';
    markCurrentAttemptFailed(authoritative, localTicketPath, queue, shotDir, error);
    return { status: 'failed', error, ticketId };
  }

  // Probe only the project-local current attempt's queue path. outputFile is
  // worker-controlled and an old local image may belong to an earlier attempt.
  const queueOutPath = safeOutputPath(authoritative, queue) ?? undefined;

  let candidateFile: string | undefined;
  if (queueOutPath && fs.existsSync(queueOutPath)) {
    candidateFile = queueOutPath;
  } else if (authoritative.status === ShotStatus.IMAGE_GENERATED) {
    // Idempotent re-check after HomeBot already imported this same attempt.
    const localImg = path.join(shotDir, 'image', `${authoritative.shotId}.png`);
    if (fs.existsSync(localImg)) {
      candidateFile = localImg;
    }
  }

  if (!candidateFile) {
    if (manifest.status === ShotStatus.IMAGE_GENERATED) {
      const error = 'Worker marked ticket complete but output image was missing';
      markCurrentAttemptFailed(authoritative, localTicketPath, queue, shotDir, error);
      return { status: 'failed', error, ticketId };
    }
    return { status: 'pending', ticketId };
  }

  // Validate before replacing a previous successful local artifact. A corrupt
  // current attempt must fail without deleting the last-good image.
  try {
    validateMovieImageFile(candidateFile);
  } catch {
    const errorMsg = 'The worker image is unreadable. Replace it with a complete image and run the shot again.';
    markCurrentAttemptFailed(authoritative, localTicketPath, queue, shotDir, errorMsg);
    return { status: 'failed', error: errorMsg, ticketId };
  }

  // Atomically copy to shotDir/image/<shotId>.png if not already there
  const imageDir = path.join(shotDir, 'image');
  fs.mkdirSync(imageDir, { recursive: true });
  const finalDest = path.join(imageDir, `${authoritative.shotId}.png`);

  if (path.resolve(candidateFile) !== path.resolve(finalDest)) {
    const tempDest = path.join(imageDir, `.${randomUUID()}.tmp`);
    try {
      fs.copyFileSync(candidateFile, tempDest);
      // Validate the bytes that will actually replace the canonical image.
      // The worker may still be writing/changing its source after the earlier
      // probe; a bad copied snapshot must never overwrite the last-good image.
      validateMovieImageFiles(shotDir, [tempDest]);
      fs.renameSync(tempDest, finalDest);
    } catch {
      if (fs.existsSync(tempDest)) {
        try { fs.unlinkSync(tempDest); } catch { /* ignore */ }
      }
      const errorMsg = 'The worker image changed or became unreadable while it was being imported. Retry the shot.';
      markCurrentAttemptFailed(authoritative, localTicketPath, queue, shotDir, errorMsg);
      return { status: 'failed', error: errorMsg, ticketId };
    }
  } else {
    // Idempotent re-check of an already-imported current attempt.
    try {
      validateMovieImageFiles(shotDir, [finalDest]);
    } catch {
      const errorMsg = 'The worker image is unreadable. Replace it with a complete image and run the shot again.';
      markCurrentAttemptFailed(authoritative, localTicketPath, queue, shotDir, errorMsg);
      return { status: 'failed', error: errorMsg, ticketId };
    }
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

  state.shotId = authoritative.shotId;
  state.status = ShotStatus.IMAGE_GENERATED;
  state.attempts = authoritative.attempts;
  state.outputFiles = [path.relative(shotDir, finalDest)];
  state.deferredTicket = undefined;
  state.deferredProvider = undefined;
  state.lastError = undefined;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');

  // Update manifest status in queue
  const completedManifest: ColabJobManifest = {
    ...authoritative,
    status: ShotStatus.IMAGE_GENERATED,
    completedAt: new Date().toISOString(),
    outputFile: finalDest,
    error: undefined,
  };

  const completedJson = JSON.stringify(completedManifest, null, 2);
  // Keep the two queue aliases coherent. The notebook scans both names, so a
  // stale AWAITING_WORKER alias is executable work even when its sibling says
  // this result was already imported.
  for (const manifestPath of [
    path.join(queue.ticketsDir, `${authoritative.ticketId}.json`),
    path.join(queue.ticketsDir, `${authoritative.jobId}.json`),
    localTicketPath,
  ]) {
    try { writeManifestAtomically(manifestPath, completedJson); } catch { /* best-effort mirror */ }
  }

  return {
    status: 'imported',
    imagePath: finalDest,
    ticketId,
  };
}

interface ProjectTicket {
  projectDir: string;
  sceneId: string;
  shotId: string;
  shotDir: string;
  localTicketPath: string;
  manifest: ColabJobManifest;
}

const COLAB_JOB_STATUSES = new Set<string>([
  ShotStatus.AWAITING_WORKER,
  ShotStatus.IMAGE_GENERATED,
  ShotStatus.FAILED,
  'CANCELLED',
]);

function hasValidQueueFields(item: ColabJobManifest | null): item is ColabJobManifest {
  return !!item && isSafePathSegment(item.jobId) && isSafeTicketId(item.ticketId) && isSafePathSegment(item.shotId) &&
    typeof item.createdAt === 'string' && Number.isSafeInteger(item.attempts) && item.attempts >= 0 &&
    (item.attemptId === undefined || isSafePathSegment(item.attemptId)) &&
    COLAB_JOB_STATUSES.has(item.status);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function manifestOwnsShot(
  item: ColabJobManifest | null,
  local: ColabJobManifest,
  shotDir: string,
): item is ColabJobManifest {
  if (!hasValidQueueFields(item) || item.ticketId !== local.ticketId || item.jobId !== local.jobId || item.shotId !== local.shotId) {
    return false;
  }
  try {
    return !!item.shotDir && path.relative(fs.realpathSync(path.resolve(item.shotDir)), fs.realpathSync(shotDir)) === '';
  } catch {
    return false;
  }
}

function sameAttempt(left: ColabJobManifest, right: ColabJobManifest): boolean {
  return left.attempts === right.attempts &&
    (left.attemptId ?? null) === (right.attemptId ?? null) &&
    left.relativeOutputPath === right.relativeOutputPath;
}

function markCurrentAttemptFailed(
  current: ColabJobManifest,
  localTicketPath: string,
  queue: DriveQueueInfo,
  shotDir: string,
  error: string,
): void {
  const failed: ColabJobManifest = {
    ...current,
    status: ShotStatus.FAILED,
    error,
    completedAt: undefined,
    outputFile: undefined,
  };
  const json = JSON.stringify(failed, null, 2);
  // Local first: it is the attempt authority and keeps a later stale worker
  // alias from reviving an ingestion failure.
  for (const file of [
    localTicketPath,
    path.join(queue.ticketsDir, `${failed.ticketId}.json`),
    path.join(queue.ticketsDir, `${failed.jobId}.json`),
  ]) {
    try { writeManifestAtomically(file, json); } catch { /* report the failure below even if one mirror is unavailable */ }
  }
  markShotFailed(shotDir, error);
}

function isWithinDirectory(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveOwnedProject(projectDir: string): string {
  if (typeof projectDir !== 'string' || !projectDir.trim()) {
    throw new Error('Choose a movie project first.');
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(projectDir));
  } catch {
    throw new Error('That movie project folder could not be found.');
  }
  const home = fs.realpathSync(os.homedir());
  if (!isWithinHomeDir(resolved, home)) {
    throw new Error('The project directory must be inside your user folder.');
  }
  const projectPath = path.join(resolved, 'project.json');
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isFile()) {
    throw new Error('That folder is not a movie project (project.json is missing).');
  }
  const realProjectPath = fs.realpathSync(projectPath);
  if (!isWithinDirectory(realProjectPath, resolved) || !readJsonFile<Record<string, unknown>>(realProjectPath)) {
    throw new Error('That movie project has an invalid project.json.');
  }
  return resolved;
}

function safeTicketId(ticketId: string): string {
  if (!isSafeTicketId(ticketId)) {
    throw new Error('That Colab ticket ID is invalid.');
  }
  return ticketId;
}

/**
 * Enumerate only shots declared by each scene.json. The ticket's serialized
 * shotDir is never authority: it is checked against, then replaced by, this
 * project-derived path before any write occurs.
 */
function projectTickets(projectDir: string, queue: DriveQueueInfo): ProjectTicket[] {
  const resolvedProject = resolveOwnedProject(projectDir);
  const scenesRoot = path.join(resolvedProject, 'scenes');
  if (!fs.existsSync(scenesRoot) || !fs.statSync(scenesRoot).isDirectory()) return [];

  const tickets: ProjectTicket[] = [];
  for (const sceneFolder of fs.readdirSync(scenesRoot)) {
    if (!isSafePathSegment(sceneFolder)) continue;
    const sceneDir = path.join(scenesRoot, sceneFolder);
    let realSceneDir: string;
    try {
      if (!fs.statSync(sceneDir).isDirectory()) continue;
      realSceneDir = fs.realpathSync(sceneDir);
    } catch { continue; }
    if (!isWithinDirectory(realSceneDir, resolvedProject)) continue;

    const scene = readJsonFile<{ sceneId?: unknown; shots?: unknown }>(path.join(realSceneDir, 'scene.json'));
    if (!scene || !Array.isArray(scene.shots)) continue;
    const sceneId = isSafePathSegment(scene.sceneId) ? scene.sceneId : sceneFolder;

    for (const value of scene.shots) {
      if (!isSafePathSegment(value)) continue;
      const declaredShotDir = path.join(realSceneDir, value);
      let shotDir: string;
      try {
        if (!fs.statSync(declaredShotDir).isDirectory()) continue;
        shotDir = fs.realpathSync(declaredShotDir);
      } catch { continue; }
      if (!isWithinDirectory(shotDir, realSceneDir)) continue;

      const localTicketPath = path.join(shotDir, 'ticket.json');
      const local = readJsonFile<ColabJobManifest>(localTicketPath);
      if (!hasValidQueueFields(local) || local.shotId !== value) continue;
      // A ticket copied from another project is not ownership proof.
      try {
        if (local.shotDir && path.relative(fs.realpathSync(path.resolve(local.shotDir)), shotDir) !== '') continue;
      } catch { continue; }

      const byTicket = readJsonFile<ColabJobManifest>(path.join(queue.ticketsDir, `${local.ticketId}.json`));
      const byJob = readJsonFile<ColabJobManifest>(path.join(queue.ticketsDir, `${local.jobId}.json`));
      const ticketOwned = !byTicket || manifestOwnsShot(byTicket, local, shotDir);
      const jobOwned = !byJob || manifestOwnsShot(byJob, local, shotDir);
      // An alias for another project/shot is a collision, not this project's
      // work. A correctly-owned but older attempt is merely stale and must not
      // hide the authoritative current local ticket.
      if (!ticketOwned || !jobOwned) continue;
      const currentAliases = [byTicket, byJob].filter((item): item is ColabJobManifest =>
        manifestOwnsShot(item, local, shotDir) && sameAttempt(item, local));
      const queuedManifest = currentAliases.find(item => item.status === ShotStatus.FAILED) ??
        currentAliases.find(item => item.status === ShotStatus.IMAGE_GENERATED) ??
        currentAliases.find(item => item.status === 'CANCELLED') ??
        currentAliases[0];
      // Once HomeBot records a terminal result locally, a worker alias cannot
      // move it backwards. Pending local tickets may adopt a current worker state.
      const manifest = local.status === ShotStatus.AWAITING_WORKER && queuedManifest ? queuedManifest : local;
      tickets.push({ projectDir: resolvedProject, sceneId, shotId: value, shotDir, localTicketPath, manifest });
    }
  }
  return tickets;
}

function safeOutputPath(manifest: ColabJobManifest, queue: DriveQueueInfo): string | null {
  if (!manifest.relativeOutputPath || path.isAbsolute(manifest.relativeOutputPath)) return null;
  const output = path.resolve(queue.rootDir, manifest.relativeOutputPath.replace(/\//g, path.sep));
  return isWithinDirectory(output, path.resolve(queue.outputsDir)) ? output : null;
}

function toQueueJob(ticket: ProjectTicket, queue: DriveQueueInfo): ColabQueueJob {
  const output = safeOutputPath(ticket.manifest, queue);
  const status = ticket.manifest.status;
  let outputReady = false;
  // A notebook may finish after cancellation. That file is intentionally
  // ignored, so do not present it as a usable ready output.
  if (status !== 'CANCELLED' && output && fs.existsSync(output)) {
    try { validateMovieImageFile(output); outputReady = true; } catch { /* remains false */ }
  }
  return {
    ticketId: ticket.manifest.ticketId,
    jobId: ticket.manifest.jobId,
    sceneId: ticket.sceneId,
    shotId: ticket.shotId,
    createdAt: ticket.manifest.createdAt,
    attempts: ticket.manifest.attempts || 0,
    status,
    error: typeof ticket.manifest.error === 'string' ? ticket.manifest.error : undefined,
    outputReady,
    canCancel: status === ShotStatus.AWAITING_WORKER,
    canRetry: status === ShotStatus.FAILED || status === 'CANCELLED',
  };
}

/** Safe, project-scoped queue listing for the Media Studio surface. */
export function listColabJobs(projectDir: string, customQueue?: DriveQueueInfo): ColabQueueJob[] {
  const queue = customQueue ?? discoverDriveQueue();
  return projectTickets(projectDir, queue)
    .map(ticket => toQueueJob(ticket, queue))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveProjectTicket(args: ColabJobMutation, queue: DriveQueueInfo): ProjectTicket {
  const ticketId = safeTicketId(args.ticketId);
  const ticket = projectTickets(args.projectDir, queue).find(item => item.manifest.ticketId === ticketId);
  if (!ticket) throw new Error('That Colab ticket does not belong to the selected project.');
  if (args.expectedAttempts !== undefined) {
    if (!Number.isSafeInteger(args.expectedAttempts) || args.expectedAttempts < 0) {
      throw new Error('The expected attempt number is invalid.');
    }
    if (ticket.manifest.attempts !== args.expectedAttempts) {
      throw new Error('That Colab ticket changed. Refresh the queue before trying again.');
    }
  }
  return ticket;
}

function writeAllManifestAliases(ticket: ProjectTicket, queue: DriveQueueInfo): void {
  fs.mkdirSync(queue.ticketsDir, { recursive: true });
  const json = JSON.stringify(ticket.manifest, null, 2);
  // Both names are consumed by the notebook. Leaving either one pending can
  // make a cancelled job execute, or make an old failed alias overwrite retry.
  // The three-file group cannot be atomic, but each replacement is: readers
  // see the complete old or complete new JSON, never a truncated tombstone.
  writeManifestAtomically(path.join(queue.ticketsDir, `${ticket.manifest.ticketId}.json`), json);
  writeManifestAtomically(path.join(queue.ticketsDir, `${ticket.manifest.jobId}.json`), json);
  writeManifestAtomically(ticket.localTicketPath, json);
}

/** Cancel a pending ticket; this does not stop a notebook that already began. */
export function cancelColabJob(
  args: ColabJobMutation,
  customQueue?: DriveQueueInfo,
): ColabQueueJob {
  const queue = customQueue ?? discoverDriveQueue();
  const ticket = resolveProjectTicket(args, queue);
  if (ticket.manifest.status !== ShotStatus.AWAITING_WORKER) {
    throw new Error('Only a pending Colab ticket can be cancelled.');
  }
  ticket.manifest.status = 'CANCELLED';
  ticket.manifest.error = undefined;
  writeAllManifestAliases(ticket, queue);

  const statusPath = path.join(ticket.shotDir, 'status.json');
  const state = readJsonFile<Record<string, any>>(statusPath) ?? {};
  state.shotId = ticket.shotId;
  state.status = ShotStatus.PLANNED;
  state.deferredTicket = undefined;
  state.deferredProvider = undefined;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
  return toQueueJob(ticket, queue);
}

/** Retry a failed/cancelled ticket. Online consent is rechecked at dispatch. */
export function retryColabJob(
  args: ColabJobMutation,
  customQueue?: DriveQueueInfo,
): ColabQueueJob {
  const queue = customQueue ?? discoverDriveQueue();
  const ticket = resolveProjectTicket(args, queue);
  if (ticket.manifest.status !== ShotStatus.FAILED && ticket.manifest.status !== 'CANCELLED') {
    throw new Error('Only a failed or cancelled Colab ticket can be retried.');
  }
  assertProviderOnlineAccess('Colab');

  ticket.manifest.status = ShotStatus.AWAITING_WORKER;
  ticket.manifest.attempts = (ticket.manifest.attempts || 0) + 1;
  ticket.manifest.attemptId = createAttemptId(ticket.manifest.attempts);
  ticket.manifest.relativeOutputPath = attemptOutputPath(
    ticket.manifest.jobId,
    ticket.manifest.attemptId,
    ticket.manifest.shotId,
  );
  ticket.manifest.error = undefined;
  ticket.manifest.completedAt = undefined;
  ticket.manifest.outputFile = undefined;
  writeAllManifestAliases(ticket, queue);

  const statusPath = path.join(ticket.shotDir, 'status.json');
  const state = readJsonFile<Record<string, any>>(statusPath) ?? {};
  state.shotId = ticket.shotId;
  state.status = ShotStatus.AWAITING_WORKER;
  state.deferredTicket = ticket.manifest.ticketId;
  state.deferredProvider = 'colab-worker';
  state.lastError = undefined;
  state.attempts = ticket.manifest.attempts;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(state, null, 2), 'utf-8');
  return toQueueJob(ticket, queue);
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
