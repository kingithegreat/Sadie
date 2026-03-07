import os from 'os';
import { join } from 'path';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import {
  logTelemetryEvent,
  initLogging,
  logStartup,
  logError,
  logTelemetryConsent,
} from '../../main/utils/logger';

const tmp = join(os.tmpdir(), 'sadie-logger-test-' + Date.now());

beforeAll(() => {
  process.env.TEST_USERDATA = tmp;
  if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
});

function readLog(filename: string): string {
  const p = join(tmp, 'logs', filename);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf-8');
}

// ─── logTelemetryEvent ────────────────────────────────────────────────────────

describe('logger telemetry events', () => {
  test('logTelemetryEvent writes telemetry-events.log', () => {
    logTelemetryEvent('stream_failure', { streamId: 's1', reason: 'probe' });
    const p = join(tmp, 'logs', 'telemetry-events.log');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf-8').trim();
    expect(content.length).toBeGreaterThan(0);
    const lines = content.split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.event).toBe('stream_failure');
    expect(last.details.streamId).toBe('s1');
  });

  test('logTelemetryEvent includes timestamp field', () => {
    logTelemetryEvent('test_event', {});
    const content = readLog('telemetry-events.log');
    const lines = content.trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  test('logTelemetryEvent defaults details to empty object', () => {
    logTelemetryEvent('bare_event');
    const content = readLog('telemetry-events.log');
    const lines = content.trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(typeof entry.details).toBe('object');
  });

  test('logTelemetryEvent appends multiple entries', () => {
    logTelemetryEvent('evt_a', { x: 1 });
    logTelemetryEvent('evt_b', { x: 2 });
    const content = readLog('telemetry-events.log');
    const lines = content.trim().split('\n').filter(Boolean);
    const events = lines.map((l: string) => JSON.parse(l).event);
    expect(events).toContain('evt_a');
    expect(events).toContain('evt_b');
  });
});

// ─── initLogging ─────────────────────────────────────────────────────────────

describe('initLogging', () => {
  test('creates startup.log in the log dir', () => {
    initLogging();
    expect(existsSync(join(tmp, 'logs', 'startup.log'))).toBe(true);
  });

  test('startup.log contains SADIE Startup header', () => {
    initLogging();
    const content = readLog('startup.log');
    expect(content).toContain('SADIE Startup');
  });
});

// ─── logStartup ───────────────────────────────────────────────────────────────

describe('logStartup', () => {
  test('appends message to startup.log', () => {
    logStartup('test message alpha');
    const content = readLog('startup.log');
    expect(content).toContain('test message alpha');
  });

  test('prefixes entry with ISO timestamp', () => {
    logStartup('timestamped message');
    const content = readLog('startup.log');
    const lines = content.split('\n').filter((l: string) => l.includes('timestamped message'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[lines.length - 1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('multiple calls produce multiple entries', () => {
    logStartup('multi-a');
    logStartup('multi-b');
    const content = readLog('startup.log');
    expect(content).toContain('multi-a');
    expect(content).toContain('multi-b');
  });
});

// ─── logError ─────────────────────────────────────────────────────────────────

describe('logError', () => {
  test('logs error string to startup.log', () => {
    logError('simple error string');
    const content = readLog('startup.log');
    expect(content).toContain('ERROR: simple error string');
  });

  test('logs Error object with stack', () => {
    const err = new Error('stack error');
    logError(err);
    const content = readLog('startup.log');
    expect(content).toContain('ERROR:');
    expect(content).toContain('stack error');
  });

  test('handles null/undefined gracefully without throwing', () => {
    expect(() => logError(null)).not.toThrow();
    expect(() => logError(undefined)).not.toThrow();
  });
});

// ─── logTelemetryConsent ──────────────────────────────────────────────────────

describe('logTelemetryConsent', () => {
  test('writes consent_given to telemetry-consent.log', () => {
    logTelemetryConsent('consent_given', { source: 'test' });
    const p = join(tmp, 'logs', 'telemetry-consent.log');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf-8');
    expect(content).toContain('consent_given');
  });

  test('writes consent_revoked to telemetry-consent.log', () => {
    logTelemetryConsent('consent_revoked', { source: 'settings' });
    const content = readLog('telemetry-consent.log');
    expect(content).toContain('consent_revoked');
  });

  test('entry is valid JSON with timestamp and details', () => {
    logTelemetryConsent('consent_given', { detail: 42 });
    const content = readLog('telemetry-consent.log');
    const lines = content.trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(last.action).toBe('consent_given');
    expect(last.details.detail).toBe(42);
  });
});