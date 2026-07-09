import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Permission decision audit log.
 *
 * Records every permission decision the user makes (or that times out) so they
 * can later review, from Settings, exactly what HomeBot asked to do and what
 * they granted. This is the transparency counterpart to the PermissionModal
 * (issue #6): the modal captures consent in the moment, this log makes that
 * history reviewable after the fact.
 *
 * Entries are appended as JSON Lines to userData/logs/permission-audit.log,
 * mirroring the existing telemetry-events.log convention. The file is bounded
 * to the most recent MAX_ENTRIES decisions so it can never grow without limit.
 *
 * Audit logging must NEVER break the permission flow — every function here
 * swallows its own errors and degrades to a no-op / empty result.
 */

export type PermissionDecision = 'allow_once' | 'always_allow' | 'cancel' | 'expired';

export interface PermissionAuditEntry {
  /** Stable unique id for React keys and de-duplication. */
  id: string;
  /** ISO-8601 timestamp of when the decision was resolved. */
  timestamp: string;
  /** The permission names that were requested. */
  permissions: string[];
  /** Human-readable reason the tool/batch gave for needing them. */
  reason: string;
  /** What the user decided (or 'expired' if the prompt timed out). */
  decision: PermissionDecision;
  /** Optional originating stream id, for correlation with a conversation. */
  streamId?: string;
}

/** Keep at most this many decisions on disk (newest wins). */
export const MAX_ENTRIES = 500;

/**
 * Resolve the on-disk log path. A dedicated env override is honoured first so
 * unit tests get a deterministic, isolated temp dir without needing electron's
 * app to be initialised; otherwise the real userData dir is used (which the E2E
 * harness already redirects via app.setPath('userData', ...)).
 */
export function permissionAuditLogPath(): string {
  let base: string;
  const override = process.env.HOMEBOT_PERMISSION_AUDIT_DIR;
  if (override) {
    base = override;
  } else {
    try {
      base = app.getPath('userData');
    } catch {
      base = os.tmpdir();
    }
  }
  return path.join(base, 'logs', 'permission-audit.log');
}

/**
 * Append a single permission decision to the audit log. Missing id/timestamp
 * are filled in. Never throws.
 */
export function recordPermissionDecision(
  entry: Omit<PermissionAuditEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): void {
  try {
    const full: PermissionAuditEntry = {
      id: entry.id || `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      permissions: Array.isArray(entry.permissions) ? entry.permissions : [],
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      decision: entry.decision,
      ...(entry.streamId ? { streamId: entry.streamId } : {}),
    };
    const logPath = permissionAuditLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(full) + '\n', 'utf-8');
    trimIfNeeded(logPath);
  } catch (e) {
    // Never let audit logging break the permission flow.
    console.error('[HomeBot] Failed to record permission decision:', e);
  }
}

/** Truncate the log to the newest MAX_ENTRIES lines when it grows past the cap. */
function trimIfNeeded(logPath: string): void {
  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    const tail = lines.slice(lines.length - MAX_ENTRIES);
    fs.writeFileSync(logPath, tail.join('\n') + '\n', 'utf-8');
  } catch {
    /* ignore — a failed trim just means the file stays a little longer */
  }
}

/**
 * Read all recorded decisions, oldest-first. Malformed lines are skipped rather
 * than failing the whole read. Returns [] on any error or when no log exists.
 */
export function readPermissionAudit(): PermissionAuditEntry[] {
  try {
    const logPath = permissionAuditLogPath();
    if (!fs.existsSync(logPath)) return [];
    const raw = fs.readFileSync(logPath, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as PermissionAuditEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is PermissionAuditEntry => !!x);
  } catch (e) {
    console.error('[HomeBot] Failed to read permission audit log:', e);
    return [];
  }
}

/** Delete the audit log entirely (user-initiated "Clear all"). Never throws. */
export function clearPermissionAudit(): void {
  try {
    const logPath = permissionAuditLogPath();
    if (fs.existsSync(logPath)) fs.rmSync(logPath, { force: true });
  } catch (e) {
    console.error('[HomeBot] Failed to clear permission audit log:', e);
  }
}

/**
 * Export the audit log as a single JSON file under the log directory, mirroring
 * the telemetry-consent export. Returns the written path on success.
 */
export function exportPermissionAudit(): { success: boolean; path?: string; error?: string } {
  try {
    const logPath = permissionAuditLogPath();
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    const entries = readPermissionAudit();
    const payload = { exportedAt: new Date().toISOString(), count: entries.length, entries };
    const fullPath = path.join(dir, `permission-audit-export-${Date.now()}.json`);
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf-8');
    return { success: true, path: fullPath };
  } catch (e: any) {
    console.error('[HomeBot] Failed to export permission audit log:', e);
    return { success: false, error: String(e?.message || e) };
  }
}
