/**
 * diagnostics.ts
 *
 * Runs a comprehensive set of first-run (and on-demand) checks in parallel:
 *  - Disk space: is there enough free space to pull models?
 *  - Service reachability: Ollama, n8n, Qdrant
 *  - Write permissions: can we write to the userData directory?
 *  - Hardware: GPU VRAM + recommended hardware profile
 *
 * Used by the `homebot:run-diagnostics` IPC channel (ipc-handlers.ts) and
 * by the FirstRunModal to warn before starting a model pull.
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { detectGpuVram } from './moa';
import { checkKnownWebhooks } from './n8n-webhook-check';

// Minimum free disk GB before showing a warning
export const DISK_WARN_GB = 10;
// Minimum free disk GB before blocking a model pull
export const DISK_BLOCK_GB = 4;

export interface DiskInfo {
  /** Available space in GB on the drive containing userData, or null if detection failed. */
  freeGB: number | null;
  /** True if there is enough disk space to safely pull models. */
  ok: boolean;
  /** Human-readable warning, or null when all is fine. */
  warning: string | null;
}

export interface ServiceStatus {
  reachable: boolean;
  url: string;
  /** HTTP status code if the service responded, or null on network error. */
  statusCode: number | null;
  latencyMs: number | null;
}

export interface PermissionsInfo {
  /** True if the app can write to its userData directory. */
  canWrite: boolean;
  /** The path that was tested. */
  path: string;
}

export interface HardwareInfo {
  vramGB: number | null;
  gpuName: string | null;
  /** '4gb' | '8gb' | '16gb+' | null (if detection failed) */
  profile: '4gb' | '8gb' | '16gb+' | null;
}

export interface DiagnosticsResult {
  disk: DiskInfo;
  ollama: ServiceStatus;
  n8n: ServiceStatus;
  qdrant: ServiceStatus;
  permissions: PermissionsInfo;
  hardware: HardwareInfo;
  /** Wall-clock time for the full diagnostics run in ms. */
  durationMs: number;
  /** ISO timestamp when diagnostics were run. */
  timestamp: string;
  /**
   * n8n workflows HomeBot depends on, and whether each is actually deployed.
   *
   * An undeployed workflow answers 404 and the calling feature falls back
   * silently — indistinguishable from a broken feature, and invisible unless
   * someone reads a console that packaged builds silence. Listed here so
   * "not set up yet" is a state you can see rather than infer.
   */
  n8nWebhooks: Array<{
    path: string;
    powers: string;
    status: 'available' | 'not_deployed' | 'n8n_unreachable' | 'error';
    detail?: string;
  }>;
}

// ── Disk ──────────────────────────────────────────────────────────────────────

/**
 * Returns free disk space in GB for the volume containing `dir`.
 * Uses fs.statfs (available in Node >= 18.15 / Electron >= 28) with a
 * graceful fallback so it never throws.
 */
function getFreeDiskGB(dir: string): number | null {
  try {
    // fs.statfsSync was added in Node 18.15.0 (Electron 28 ships 18.18.2)
    const stats = (fs as any).statfsSync(dir) as {
      bsize: number;
      bfree: number;
      bavail: number;
    };
    if (stats && typeof stats.bsize === 'number' && typeof stats.bavail === 'number') {
      return (stats.bavail * stats.bsize) / 1e9;
    }
  } catch {
    // Non-fatal — detection unavailable on this platform/version
  }
  return null;
}

export function buildDiskInfo(freeGB: number | null): DiskInfo {
  if (freeGB === null) {
    return { freeGB: null, ok: true, warning: null };
  }
  if (freeGB < DISK_BLOCK_GB) {
    return {
      freeGB,
      ok: false,
      warning: `Only ${freeGB.toFixed(1)} GB free. AI models need at least ${DISK_BLOCK_GB} GB — free up space before continuing.`,
    };
  }
  if (freeGB < DISK_WARN_GB) {
    return {
      freeGB,
      ok: true,
      warning: `${freeGB.toFixed(1)} GB free. Models use 5–10 GB — consider freeing space before pulling large models.`,
    };
  }
  return { freeGB, ok: true, warning: null };
}

// ── Service reachability ──────────────────────────────────────────────────────

const REACH_TIMEOUT_MS = 4000;

export async function checkService(url: string): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const res = await axios.get(url, { timeout: REACH_TIMEOUT_MS, validateStatus: () => true });
    return {
      reachable: res.status < 500,
      url,
      statusCode: res.status,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { reachable: false, url, statusCode: null, latencyMs: null };
  }
}

// ── Permissions ───────────────────────────────────────────────────────────────

export function checkWritePermissions(userDataPath: string): PermissionsInfo {
  const testDir = path.join(userDataPath, 'config');
  const testFile = path.join(testDir, `.diag-write-test-${Date.now()}`);
  try {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return { canWrite: true, path: userDataPath };
  } catch {
    return { canWrite: false, path: userDataPath };
  }
}

// ── Hardware ──────────────────────────────────────────────────────────────────

export function vramToProfile(vramGB: number | null): '4gb' | '8gb' | '16gb+' | null {
  if (vramGB === null) return null;
  if (vramGB >= 12) return '16gb+';
  if (vramGB >= 6) return '8gb';
  return '4gb';
}

// ── Main entry point ─────────────────────────────────────────────────────────

export interface DiagnosticsInput {
  ollamaUrl: string;
  n8nUrl: string;
  /** Qdrant defaults to localhost:6333 */
  qdrantUrl?: string;
}

export async function runDiagnostics(
  input: DiagnosticsInput,
  userDataPath: string
): Promise<DiagnosticsResult> {
  // performance.now(), not Date.now(): this is a DURATION, and Date.now() has
  // whole-millisecond resolution. When every probe short-circuits — nothing
  // listening on any port — the whole run finishes inside a single millisecond
  // and durationMs comes back as 0, which reads as "did not run" rather than
  // "ran and was instant". That is exactly what happened the first time this
  // suite ran on a CI machine faster than a dev laptop.
  const start = performance.now();
  const timestamp = new Date().toISOString();

  const ollamaBase = (input.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const n8nBase = (input.n8nUrl || 'http://localhost:5678').replace(/\/$/, '');
  const qdrantBase = (input.qdrantUrl || 'http://localhost:6333').replace(/\/$/, '');

  // Run service checks and GPU detection in parallel
  const [ollamaStatus, n8nStatus, qdrantStatus, gpuResult] = await Promise.all([
    checkService(`${ollamaBase}/api/tags`),
    checkService(`${n8nBase}/healthz`),
    checkService(`${qdrantBase}/healthz`),
    detectGpuVram().catch(() => ({ vramGB: null as number | null, gpuName: null as string | null, method: 'error' as const })),
  ]);

  // Probed after the service checks: if n8n is down they all report
  // n8n_unreachable, which is the honest answer — a workflow's own state
  // cannot be known when the server hosting it is not answering.
  const n8nWebhooks = await checkKnownWebhooks().catch(() => []);

  const freeGB = getFreeDiskGB(userDataPath);
  const disk = buildDiskInfo(freeGB);
  const permissions = checkWritePermissions(userDataPath);
  const vramGB = gpuResult.vramGB ?? null;

  return {
    disk,
    ollama: ollamaStatus,
    n8n: n8nStatus,
    qdrant: qdrantStatus,
    permissions,
    hardware: {
      vramGB,
      gpuName: gpuResult.gpuName ?? null,
      profile: vramToProfile(vramGB),
    },
    durationMs: Math.round((performance.now() - start) * 100) / 100,
    timestamp,
    n8nWebhooks,
  };
}
