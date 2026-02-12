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
    const header = `\n--- SADIE Startup ${new Date().toISOString()} ---\n`;
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

export default { initLogging, logStartup, logError, logTelemetryEvent };
