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

// ============================================
// Console Logger (environment-aware)
// ============================================

const isDev = process.env.NODE_ENV !== 'production';
const isE2E = process.env.SADIE_E2E === '1' || process.env.SADIE_E2E === 'true';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL = process.env.SADIE_LOG_LEVEL || (isDev ? 'debug' : 'info');

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[LOG_LEVEL as LogLevel];
}

/**
 * Create a namespaced logger for a specific module
 */
export function createLogger(prefix: string) {
  return {
    /** Debug-level logging (dev only by default) */
    debug: (...args: any[]) => {
      if (shouldLog('debug')) {
        console.log(`[${prefix}]`, ...args);
      }
    },
    /** Info-level logging (always shown) */
    info: (...args: any[]) => {
      if (shouldLog('info')) {
        console.log(`[${prefix}]`, ...args);
      }
    },
    /** Warning-level logging */
    warn: (...args: any[]) => {
      if (shouldLog('warn')) {
        console.warn(`[${prefix}]`, ...args);
      }
    },
    /** Error-level logging (always shown) */
    error: (...args: any[]) => {
      if (shouldLog('error')) {
        console.error(`[${prefix}]`, ...args);
      }
    },
    /** E2E test tracing (only in E2E mode) */
    e2e: (...args: any[]) => {
      if (isE2E) {
        console.log(`[E2E-TRACE] [${prefix}]`, ...args);
      }
    },
  };
}

// Pre-configured loggers for common modules
export const log = createLogger('SADIE');
export const routerLog = createLogger('Router');
export const toolsLog = createLogger('Tools');
export const providerLog = createLogger('Provider');
export const streamLog = createLogger('Stream');
export const memoryLog = createLogger('Memory');

export default { initLogging, logStartup, logError, createLogger, log };
