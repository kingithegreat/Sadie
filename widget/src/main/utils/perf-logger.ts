import { app } from 'electron';
import os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * perf-logger — baseline performance metrics for HomeBot / SADIE.
 *
 * Persists two metrics as JSONL to `<userData>/logs/perf.log`:
 *   1. `startup`     — ms from process spawn to the main window being ready.
 *   2. `first-token` — ms from a chat request arriving to its first streamed
 *                      chunk (time-to-first-token, TTFT).
 *
 * Design notes:
 *   - Never throws. Perf logging must never break the app, so every public
 *     function is fully guarded. Failures degrade to a console warning.
 *   - Pure timing math (`computeLatency`) and the request-tracking map are
 *     unit-testable without Electron; tests point `TEST_USERDATA` at a temp dir.
 *   - `markFirstToken` is idempotent per streamId: the request start entry is
 *     consumed on the first call, so duplicate calls from overlapping send
 *     sites are harmless no-ops.
 */

const STARTUP = 'startup';
const FIRST_TOKEN = 'first-token';

// Bound the in-flight request map so a stream that never emits a token (and is
// never explicitly cleared) cannot leak memory over a long session.
const MAX_TRACKED_REQUESTS = 500;

// streamId -> request-received epoch ms
const requestStarts = new Map<string, number>();

function getLogDir(): string {
  try {
    const userPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : (process.env.TEST_USERDATA || os.tmpdir());
    return path.join(userPath, 'logs');
  } catch {
    return path.join(process.env.TEST_USERDATA || os.tmpdir(), 'logs');
  }
}

function getPerfLogPath(): string {
  return path.join(getLogDir(), 'perf.log');
}

function ensureLogDir(): void {
  try {
    const dir = getLogDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore — append will simply no-op */
  }
}

/** Pure, testable latency helper. Returns a non-negative integer ms, or null. */
export function computeLatency(startMs: number | undefined, endMs: number): number | null {
  if (typeof startMs !== 'number' || !Number.isFinite(startMs)) return null;
  if (typeof endMs !== 'number' || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round(endMs - startMs));
}

function appendEntry(entry: Record<string, any>): void {
  try {
    ensureLogDir();
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(getPerfLogPath(), line);
  } catch (err) {
    console.warn('[PERF] Failed to write perf.log entry:', (err as any)?.message || err);
  }
}

/**
 * Record total startup time (ms from process spawn to UI ready).
 * Call once per launch, typically on the main window's `did-finish-load`.
 */
export function logStartupTime(ms: number, details: Record<string, any> = {}): void {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
  appendEntry({ type: STARTUP, ms: Math.round(ms), ...details });
}

/**
 * Mark the moment a chat request arrives. `atMs` lets the caller pass an
 * already-captured timestamp so the recorded latency lines up with other
 * measurements taken at the handler entry.
 */
export function markRequestStart(streamId: string | undefined, atMs: number = Date.now()): void {
  if (!streamId) return;
  try {
    // Evict the oldest entry if we are at capacity (insertion-ordered Map).
    if (requestStarts.size >= MAX_TRACKED_REQUESTS) {
      const oldest = requestStarts.keys().next().value;
      if (oldest !== undefined) requestStarts.delete(oldest);
    }
    requestStarts.set(streamId, atMs);
  } catch {
    /* ignore */
  }
}

/**
 * Record first-token latency for a stream. Idempotent: consumes the stored
 * start time so only the first chunk of a given stream is logged. Returns the
 * latency in ms when logged, or null if there was nothing to log.
 */
export function markFirstToken(streamId: string | undefined, atMs: number = Date.now()): number | null {
  if (!streamId) return null;
  let start: number | undefined;
  try {
    start = requestStarts.get(streamId);
    if (start === undefined) return null;
    requestStarts.delete(streamId); // consume -> idempotent
  } catch {
    return null;
  }
  const ms = computeLatency(start, atMs);
  if (ms === null) return null;
  appendEntry({ type: FIRST_TOKEN, streamId, ms });
  return ms;
}

/** Drop a tracked request without logging (e.g. stream errored before any token). */
export function clearRequest(streamId: string | undefined): void {
  if (!streamId) return;
  try { requestStarts.delete(streamId); } catch { /* ignore */ }
}

/** Test-only: reset in-memory tracking between cases. */
export function __resetForTests(): void {
  requestStarts.clear();
}

export interface PerfStat {
  count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
  last_ms: number | null;
}

function summarize(values: number[]): PerfStat {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (q: number) => (n ? sorted[Math.min(n - 1, Math.floor(q * n))]! : 0);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: n,
    avg_ms: n ? Math.round(sum / n) : 0,
    p50_ms: pct(0.5),
    p95_ms: pct(0.95),
    min_ms: n ? sorted[0]! : 0,
    max_ms: n ? sorted[n - 1]! : 0,
    last_ms: n ? values[values.length - 1]! : null,
  };
}

/**
 * Read and aggregate perf.log. Returns startup + first-token summaries
 * (count, avg, p50, p95, min, max, last) for a lightweight perf dashboard.
 */
export function readPerfAggregates(): { startup: PerfStat; firstToken: PerfStat } {
  const startupVals: number[] = [];
  const firstTokenVals: number[] = [];
  try {
    const file = getPerfLogPath();
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        let evt: any;
        try { evt = JSON.parse(line); } catch { continue; }
        if (typeof evt?.ms !== 'number') continue;
        if (evt.type === STARTUP) startupVals.push(evt.ms);
        else if (evt.type === FIRST_TOKEN) firstTokenVals.push(evt.ms);
      }
    }
  } catch {
    /* fall through to empty summaries */
  }
  return { startup: summarize(startupVals), firstToken: summarize(firstTokenVals) };
}

export default {
  computeLatency,
  logStartupTime,
  markRequestStart,
  markFirstToken,
  clearRequest,
  readPerfAggregates,
};
