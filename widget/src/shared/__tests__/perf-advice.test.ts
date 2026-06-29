/**
 * perf-advice.test.ts — pure logic tests for src/shared/perf-advice.ts
 * No DOM/Electron; runs in plain node.
 */
import {
  buildPerfAdvice,
  STARTUP_THRESHOLDS,
  FIRST_TOKEN_THRESHOLDS,
} from '../perf-advice';
import type { PerfStatSummary } from '../types';

const stat = (p95_ms: number, count = 5): PerfStatSummary => ({
  count,
  avg_ms: p95_ms,
  p50_ms: p95_ms,
  p95_ms,
  min_ms: p95_ms,
  max_ms: p95_ms,
  last_ms: p95_ms,
});
const noData = (): PerfStatSummary => stat(0, 0);

describe('buildPerfAdvice — empty / unknown', () => {
  test('null stats → all unknown, no hints', () => {
    const a = buildPerfAdvice(null);
    expect(a.overall).toBe('unknown');
    expect(a.startup.rating).toBe('unknown');
    expect(a.firstToken.rating).toBe('unknown');
    expect(a.hints).toEqual([]);
  });

  test('zero-count stats → unknown with no hints', () => {
    const a = buildPerfAdvice({ startup: noData(), firstToken: noData() });
    expect(a.overall).toBe('unknown');
    expect(a.startup.p95_ms).toBe(0);
    expect(a.hints).toEqual([]);
  });
});

describe('buildPerfAdvice — ratings', () => {
  test('both within good thresholds → good, no hints', () => {
    const a = buildPerfAdvice({
      startup: stat(STARTUP_THRESHOLDS.good - 1),
      firstToken: stat(FIRST_TOKEN_THRESHOLDS.good - 1),
    });
    expect(a.overall).toBe('good');
    expect(a.startup.rating).toBe('good');
    expect(a.firstToken.rating).toBe('good');
    expect(a.hints).toEqual([]);
  });

  test('boundary value is inclusive of good', () => {
    expect(buildPerfAdvice({ startup: stat(STARTUP_THRESHOLDS.good) }).startup.rating).toBe('good');
    expect(buildPerfAdvice({ firstToken: stat(FIRST_TOKEN_THRESHOLDS.fair) }).firstToken.rating).toBe('fair');
  });

  test('fair startup produces exactly one hint', () => {
    const a = buildPerfAdvice({
      startup: stat(STARTUP_THRESHOLDS.fair),
      firstToken: stat(FIRST_TOKEN_THRESHOLDS.good),
    });
    expect(a.startup.rating).toBe('fair');
    expect(a.overall).toBe('fair');
    expect(a.hints).toHaveLength(1);
    expect(a.hints[0]).toMatch(/Startup/);
  });

  test('slow first-token produces a model hint', () => {
    const a = buildPerfAdvice({
      startup: stat(STARTUP_THRESHOLDS.good),
      firstToken: stat(FIRST_TOKEN_THRESHOLDS.fair + 1),
    });
    expect(a.firstToken.rating).toBe('slow');
    expect(a.hints.some((h) => /smaller local model/i.test(h))).toBe(true);
  });

  test('overall = worst known metric', () => {
    const a = buildPerfAdvice({
      startup: stat(STARTUP_THRESHOLDS.good),       // good
      firstToken: stat(FIRST_TOKEN_THRESHOLDS.fair + 1), // slow
    });
    expect(a.overall).toBe('slow');
  });

  test('overall ignores unknown when one metric has data', () => {
    const a = buildPerfAdvice({ startup: stat(STARTUP_THRESHOLDS.good), firstToken: noData() });
    expect(a.firstToken.rating).toBe('unknown');
    expect(a.overall).toBe('good');
  });
});
