import os from 'os';
import { join } from 'path';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import {
  logTelemetryEvent,
  initLogging,
  logStartup,
  logError,
  logTelemetryConsent,
  readToolCallAggregates,
} from '../../main/utils/logger';

const tmp = join(os.tmpdir(), 'homebot-logger-test-' + Date.now());

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

  test('startup.log contains HomeBot Startup header', () => {
    initLogging();
    const content = readLog('startup.log');
    expect(content).toContain('HomeBot Startup');
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

// ─── readToolCallAggregates ──────────────────────────────────────────────────

describe('readToolCallAggregates', () => {
  // Each test uses its own isolated log dir so prior events don't leak in.
  const localTmp = join(os.tmpdir(), 'homebot-aggregates-test-' + Date.now());

  beforeEach(() => {
    process.env.TEST_USERDATA = localTmp;
    // Fresh log dir per test to keep aggregates independent
    try { rmSync(localTmp, { recursive: true, force: true }); } catch {}
    mkdirSync(join(localTmp, 'logs'), { recursive: true });
  });

  afterAll(() => {
    try { rmSync(localTmp, { recursive: true, force: true }); } catch {}
    process.env.TEST_USERDATA = tmp; // restore the outer suite's env
  });

  test('returns zeroed summary when no log file exists', () => {
    const r = readToolCallAggregates();
    expect(r.totalCalls).toBe(0);
    expect(r.successRate).toBe(0);
    expect(r.perTool).toEqual({});
  });

  test('counts successes per tool', () => {
    logTelemetryEvent('tool_call', { tool: 'read_file', outcome: 'success', duration_ms: 10 });
    logTelemetryEvent('tool_call', { tool: 'read_file', outcome: 'success', duration_ms: 20 });
    logTelemetryEvent('tool_call', { tool: 'read_file', outcome: 'success', duration_ms: 30 });
    const r = readToolCallAggregates();
    expect(r.totalCalls).toBe(3);
    expect(r.successRate).toBe(1);
    expect(r.perTool.read_file.count).toBe(3);
    expect(r.perTool.read_file.success).toBe(3);
  });

  test('breaks down error types per tool', () => {
    logTelemetryEvent('tool_call', { tool: 'web_search', outcome: 'handler_error', duration_ms: 500, error_type: 'network' });
    logTelemetryEvent('tool_call', { tool: 'web_search', outcome: 'handler_error', duration_ms: 700, error_type: 'network' });
    logTelemetryEvent('tool_call', { tool: 'web_search', outcome: 'handler_error', duration_ms: 200, error_type: 'timeout' });
    const r = readToolCallAggregates();
    expect(r.perTool.web_search.errors).toBe(3);
    expect(r.perTool.web_search.errorTypes.network).toBe(2);
    expect(r.perTool.web_search.errorTypes.timeout).toBe(1);
  });

  test('computes p50 and p95 latencies', () => {
    // Use 20 distinct durations so p50 / p95 land cleanly
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    for (const ms of durations) {
      logTelemetryEvent('tool_call', { tool: 'slow_tool', outcome: 'success', duration_ms: ms });
    }
    const r = readToolCallAggregates();
    expect(r.perTool.slow_tool.p50_ms).toBeGreaterThan(0);
    expect(r.perTool.slow_tool.p95_ms).toBeGreaterThanOrEqual(r.perTool.slow_tool.p50_ms);
    expect(r.perTool.slow_tool.p95_ms).toBeGreaterThanOrEqual(180);
  });

  test('counts cancelled separately', () => {
    logTelemetryEvent('tool_call', { tool: 'write_file', outcome: 'success', duration_ms: 5 });
    logTelemetryEvent('tool_call', { tool: 'write_file', outcome: 'cancelled', duration_ms: 0 });
    const r = readToolCallAggregates();
    expect(r.perTool.write_file.success).toBe(1);
    expect(r.perTool.write_file.cancelled).toBe(1);
    expect(r.perTool.write_file.errors).toBe(0);
  });

  test('ignores non-tool_call events', () => {
    logTelemetryEvent('stream_failure', { reason: 'x' });
    logTelemetryEvent('tool_call', { tool: 'read_file', outcome: 'success', duration_ms: 1 });
    logTelemetryEvent('model_switch', { from: 'a', to: 'b' });
    const r = readToolCallAggregates();
    expect(r.totalCalls).toBe(1);
    expect(r.perTool.read_file.count).toBe(1);
  });

  test('skips malformed JSON lines without throwing', () => {
    // Valid event so the log exists
    logTelemetryEvent('tool_call', { tool: 'read_file', outcome: 'success', duration_ms: 1 });
    // Manually append garbage
    const p = join(localTmp, 'logs', 'telemetry-events.log');
    require('fs').appendFileSync(p, 'not-json\n{"partial":\n');
    // Another valid event after
    logTelemetryEvent('tool_call', { tool: 'read_file', outcome: 'success', duration_ms: 2 });
    expect(() => readToolCallAggregates()).not.toThrow();
    const r = readToolCallAggregates();
    expect(r.perTool.read_file.count).toBe(2);
  });

  test('computes overall success rate across tools', () => {
    logTelemetryEvent('tool_call', { tool: 'a', outcome: 'success', duration_ms: 1 });
    logTelemetryEvent('tool_call', { tool: 'a', outcome: 'success', duration_ms: 1 });
    logTelemetryEvent('tool_call', { tool: 'b', outcome: 'handler_error', duration_ms: 1, error_type: 'other' });
    logTelemetryEvent('tool_call', { tool: 'b', outcome: 'handler_error', duration_ms: 1, error_type: 'other' });
    const r = readToolCallAggregates();
    expect(r.totalCalls).toBe(4);
    expect(r.successRate).toBeCloseTo(0.5, 2);
  });
});