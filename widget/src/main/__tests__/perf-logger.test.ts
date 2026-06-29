import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Point the logger at an isolated temp dir BEFORE importing the module so the
// electron `app` fallback resolves to TEST_USERDATA.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-logger-test-'));
process.env.TEST_USERDATA = TMP;

// electron has no `app` in the jest/node env; mock it so getLogDir() falls back.
jest.mock('electron', () => ({ app: undefined }), { virtual: true });

import {
  computeLatency,
  logStartupTime,
  markRequestStart,
  markFirstToken,
  clearRequest,
  readPerfAggregates,
  __resetForTests,
} from '../utils/perf-logger';

const perfLogPath = () => path.join(TMP, 'logs', 'perf.log');
function readLines(): any[] {
  if (!fs.existsSync(perfLogPath())) return [];
  return fs.readFileSync(perfLogPath(), 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  __resetForTests();
  try { fs.rmSync(perfLogPath(), { force: true }); } catch { /* ignore */ }
});

describe('computeLatency', () => {
  it('returns rounded non-negative delta', () => {
    expect(computeLatency(100, 350)).toBe(250);
    expect(computeLatency(100.4, 350.5)).toBe(250);
  });
  it('clamps negative deltas to 0', () => {
    expect(computeLatency(500, 100)).toBe(0);
  });
  it('returns null for invalid inputs', () => {
    expect(computeLatency(undefined, 100)).toBeNull();
    expect(computeLatency(NaN, 100)).toBeNull();
    expect(computeLatency(100, Infinity)).toBeNull();
  });
});

describe('logStartupTime', () => {
  it('writes a startup entry with ms', () => {
    logStartupTime(1234, { event: 'did-finish-load' });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'startup', ms: 1234, event: 'did-finish-load' });
    expect(typeof lines[0].timestamp).toBe('string');
  });
  it('ignores invalid values', () => {
    logStartupTime(-5);
    logStartupTime(NaN as any);
    expect(readLines()).toHaveLength(0);
  });
});

describe('first-token tracking', () => {
  it('logs first-token latency once and is idempotent', () => {
    markRequestStart('s1', 1000);
    expect(markFirstToken('s1', 1450)).toBe(450);
    // second call for same stream is a no-op
    expect(markFirstToken('s1', 1600)).toBeNull();
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'first-token', streamId: 's1', ms: 450 });
  });

  it('returns null when no request start was recorded', () => {
    expect(markFirstToken('unknown', 1000)).toBeNull();
    expect(readLines()).toHaveLength(0);
  });

  it('clearRequest prevents a later token from logging', () => {
    markRequestStart('s2', 1000);
    clearRequest('s2');
    expect(markFirstToken('s2', 1200)).toBeNull();
    expect(readLines()).toHaveLength(0);
  });

  it('ignores empty streamIds', () => {
    markRequestStart(undefined, 1000);
    expect(markFirstToken(undefined, 1200)).toBeNull();
    expect(markFirstToken('', 1200)).toBeNull();
    expect(readLines()).toHaveLength(0);
  });
});

describe('readPerfAggregates', () => {
  it('summarizes startup and first-token metrics', () => {
    [100, 200, 300, 400].forEach((ms) => logStartupTime(ms));
    [10, 20, 30].forEach((ms, i) => { markRequestStart(`r${i}`, 0); markFirstToken(`r${i}`, ms); });

    const agg = readPerfAggregates();
    expect(agg.startup.count).toBe(4);
    expect(agg.startup.min_ms).toBe(100);
    expect(agg.startup.max_ms).toBe(400);
    expect(agg.startup.avg_ms).toBe(250);
    expect(agg.startup.last_ms).toBe(400);
    expect(agg.firstToken.count).toBe(3);
    expect(agg.firstToken.avg_ms).toBe(20);
    expect(agg.firstToken.p50_ms).toBeGreaterThan(0);
  });

  it('returns empty summaries when no log exists', () => {
    const agg = readPerfAggregates();
    expect(agg.startup.count).toBe(0);
    expect(agg.firstToken.count).toBe(0);
    expect(agg.startup.last_ms).toBeNull();
  });

  it('skips malformed lines without throwing', () => {
    fs.mkdirSync(path.join(TMP, 'logs'), { recursive: true });
    fs.writeFileSync(perfLogPath(), 'not json\n{"type":"startup","ms":500}\n{bad}\n');
    const agg = readPerfAggregates();
    expect(agg.startup.count).toBe(1);
    expect(agg.startup.last_ms).toBe(500);
  });
});
