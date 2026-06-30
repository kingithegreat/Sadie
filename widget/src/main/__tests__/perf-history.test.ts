/**
 * perf-history.test.ts — tests for readPerfHistory() in utils/perf-logger.ts
 * Isolated temp userData dir; electron app mocked away.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-history-test-'));
process.env.TEST_USERDATA = TMP;

jest.mock('electron', () => ({ app: undefined }), { virtual: true });

import {
  logStartupTime,
  markRequestStart,
  markFirstToken,
  readPerfHistory,
  __resetForTests,
} from '../utils/perf-logger';

const perfLogPath = () => path.join(TMP, 'logs', 'perf.log');

beforeEach(() => {
  __resetForTests();
  try { fs.rmSync(perfLogPath(), { force: true }); } catch { /* ignore */ }
});

describe('readPerfHistory', () => {
  test('returns empty arrays when no log exists', () => {
    const h = readPerfHistory();
    expect(h).toEqual({ startup: [], firstToken: [] });
  });

  test('collects startup and first-token samples in chronological order', () => {
    logStartupTime(1000);
    logStartupTime(1100);
    logStartupTime(1200);
    // first-token samples via mark start→token
    markRequestStart('a', 0);
    markFirstToken('a', 300);
    markRequestStart('b', 0);
    markFirstToken('b', 450);

    const h = readPerfHistory();
    expect(h.startup).toEqual([1000, 1100, 1200]);
    expect(h.firstToken).toEqual([300, 450]);
  });

  test('limit keeps only the most recent N of each, newest last', () => {
    for (let i = 1; i <= 30; i++) logStartupTime(i * 10);
    const h = readPerfHistory(5);
    expect(h.startup).toHaveLength(5);
    expect(h.startup).toEqual([260, 270, 280, 290, 300]);
  });

  test('invalid limit falls back to default of 20', () => {
    for (let i = 1; i <= 25; i++) logStartupTime(i);
    const h = readPerfHistory(0);
    expect(h.startup).toHaveLength(20);
    expect(h.startup[h.startup.length - 1]).toBe(25);
  });

  test('ignores malformed log lines without throwing', () => {
    const dir = path.join(TMP, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      perfLogPath(),
      [
        JSON.stringify({ type: 'startup', ms: 800 }),
        'not json at all',
        JSON.stringify({ type: 'first-token', ms: 'oops' }),
        JSON.stringify({ type: 'first-token', ms: 250 }),
      ].join('\n') + '\n',
    );
    const h = readPerfHistory();
    expect(h.startup).toEqual([800]);
    expect(h.firstToken).toEqual([250]);
  });
});
