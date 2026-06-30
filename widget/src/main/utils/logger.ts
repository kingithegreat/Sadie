import { app } from 'electron';
import os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function getLogDir(): string {
  try {
    const userPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.env.TEST_USERDATA || os.tmpdir();
    return path.join(userPath, 'logs');
  } catch {
    return path.join(process.env.TEST_USERDATA || os.tmpdir(), 'logs');
  }
}

function ensureLogDir() {
  try {
    const LOG_DIR = getLogDir();
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    // ignore
  }
}

export function initLogging() {
  ensureLogDir();
  try {
    const LOG_DIR = getLogDir();
    const STARTUP_LOG = path.join(LOG_DIR, 'startup.log');
    const header = `\n--- HomeBot Startup ${new Date().toISOString()} ---\n`;
    fs.appendFileSync(STARTUP_LOG, header);
  } catch (err) {
    console.error('Failed to initialize startup log:', err);
  }
}

export function logStartup(message: string) {
  try {
    ensureLogDir();
    const LOG_DIR = getLogDir();
    const STARTUP_LOG = path.join(LOG_DIR, 'startup.log');
    const line = `${new Date().toISOString()} - ${message}\n`;
    fs.appendFileSync(STARTUP_LOG, line);
  } catch (err) {
    console.error('Failed to write startup log:', err);
  }
}

export function logError(err: any) {
  try {
    ensureLogDir();
    const LOG_DIR = getLogDir();
    const STARTUP_LOG = path.join(LOG_DIR, 'startup.log');
    const line = `${new Date().toISOString()} - ERROR: ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(STARTUP_LOG, line);
  } catch (e) {
    console.error('Failed to write error to startup log:', e);
  }
}

export function logTelemetryConsent(action: 'consent_given' | 'consent_revoked', details: Record<string, any>) {
  try {
    ensureLogDir();
    const LOG_DIR = getLogDir();
    const CON_SENT_LOG = path.join(LOG_DIR, 'telemetry-consent.log');
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      details
    };
    fs.appendFileSync(CON_SENT_LOG, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to write telemetry consent log:', err);
  }
}

// Write a lightweight telemetry event (JSONL) to `telemetry-events.log` for
// local metrics and offline analysis. Events are only recorded to disk; they
// do not leave the user's machine unless the user or CI collects the log.
export function logTelemetryEvent(event: string, details: Record<string, any> = {}) {
  try {
    ensureLogDir();
    const LOG_DIR = getLogDir();
    const EVENT_LOG = path.join(LOG_DIR, 'telemetry-events.log');
    const entry = { timestamp: new Date().toISOString(), event, details };
    fs.appendFileSync(EVENT_LOG, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to write telemetry event:', err);
  }
}

/**
 * Read and aggregate tool_call telemetry events. Returns per-tool counts,
 * error-type breakdown, and p50/p95 latencies — enough for an ops dashboard.
 * Keeps no PII: only tool names, outcomes, durations, error categories.
 */
export function readToolCallAggregates(): {
  totalCalls: number;
  successRate: number;
  perTool: Record<string, {
    count: number;
    success: number;
    errors: number;
    cancelled: number;
    p50_ms: number;
    p95_ms: number;
    errorTypes: Record<string, number>;
  }>;
} {
  const empty = { totalCalls: 0, successRate: 0, perTool: {} as any };
  try {
    const LOG_DIR = getLogDir();
    const EVENT_LOG = path.join(LOG_DIR, 'telemetry-events.log');
    if (!fs.existsSync(EVENT_LOG)) return empty;
    const lines = fs.readFileSync(EVENT_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    const perTool: Record<string, any> = {};
    let totalCalls = 0;
    let totalSuccess = 0;
    for (const line of lines) {
      let evt: any;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt?.event !== 'tool_call') continue;
      const d = evt.details || {};
      const tool = d.tool || 'unknown';
      const outcome = d.outcome || 'unknown';
      const dur = typeof d.duration_ms === 'number' ? d.duration_ms : 0;
      if (!perTool[tool]) {
        perTool[tool] = { count: 0, success: 0, errors: 0, cancelled: 0, durations: [], errorTypes: {} };
      }
      const t = perTool[tool];
      t.count++;
      totalCalls++;
      if (outcome === 'success') { t.success++; totalSuccess++; }
      else if (outcome === 'cancelled') t.cancelled++;
      else { t.errors++; const et = d.error_type || 'other'; t.errorTypes[et] = (t.errorTypes[et] || 0) + 1; }
      if (dur > 0) t.durations.push(dur);
    }
    // Finalize with percentiles
    for (const tool of Object.keys(perTool)) {
      const t = perTool[tool];
      const sorted = t.durations.sort((a: number, b: number) => a - b);
      const p = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
      perTool[tool] = {
        count: t.count,
        success: t.success,
        errors: t.errors,
        cancelled: t.cancelled,
        p50_ms: p(0.5),
        p95_ms: p(0.95),
        errorTypes: t.errorTypes,
      };
    }
    const successRate = totalCalls > 0 ? totalSuccess / totalCalls : 0;
    return { totalCalls, successRate, perTool };
  } catch {
    return empty;
  }
}

export default { initLogging, logStartup, logError, logTelemetryEvent, readToolCallAggregates };
