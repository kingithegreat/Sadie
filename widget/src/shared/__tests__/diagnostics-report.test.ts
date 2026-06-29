/**
 * diagnostics-report.test.ts — pure logic tests for src/shared/diagnostics-report.ts
 * No DOM/Electron; runs in plain node.
 */
import { buildDiagnosticsReport, redactUserPath } from '../diagnostics-report';
import type { PerfStatSummary } from '../types';

const FIXED = Date.parse('2026-06-29T12:00:00.000Z');

const stat = (p95_ms: number, count = 5): PerfStatSummary => ({
  count,
  avg_ms: p95_ms,
  p50_ms: Math.round(p95_ms * 0.8),
  p95_ms,
  min_ms: p95_ms,
  max_ms: p95_ms,
  last_ms: p95_ms,
});
const noData = (): PerfStatSummary => stat(0, 0);

describe('redactUserPath', () => {
  test('redacts Windows user folder', () => {
    expect(redactUserPath('C:\\Users\\Aden\\AppData\\Roaming\\HomeBot')).toBe(
      '~\\AppData\\Roaming\\HomeBot',
    );
  });
  test('redacts macOS home', () => {
    expect(redactUserPath('/Users/aden/Library/Application Support/HomeBot')).toBe(
      '~/Library/Application Support/HomeBot',
    );
  });
  test('redacts Linux home', () => {
    expect(redactUserPath('/home/aden/.config/HomeBot')).toBe('~/.config/HomeBot');
  });
  test('leaves non-home paths and empty input alone', () => {
    expect(redactUserPath('/opt/homebot')).toBe('/opt/homebot');
    expect(redactUserPath(undefined)).toBe('');
    expect(redactUserPath('')).toBe('');
  });
});

describe('buildDiagnosticsReport — empty / fresh install', () => {
  const report = buildDiagnosticsReport({ generatedAt: FIXED });

  test('always has a header and ISO timestamp', () => {
    expect(report.startsWith('# HomeBot diagnostics report')).toBe(true);
    expect(report).toContain('Generated: 2026-06-29T12:00:00.000Z');
  });
  test('renders em-dashes for missing fields and "No data yet" perf', () => {
    expect(report).toContain('- Version: —');
    expect(report).toContain('Overall health: No data yet');
    expect(report).toContain('First token: No data yet');
    expect(report).toContain('n=0');
  });
  test('no hints section when there is nothing actionable', () => {
    expect(report).not.toContain('### Hints');
  });
  test('does not throw on completely empty input', () => {
    expect(() => buildDiagnosticsReport({})).not.toThrow();
  });
});

describe('buildDiagnosticsReport — populated', () => {
  const report = buildDiagnosticsReport({
    generatedAt: FIXED,
    appVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    electronVersion: '28.0.0',
    nodeVersion: '20.19.0',
    env: { isPackagedBuild: true, isReleaseBuild: true, userDataPath: 'C:\\Users\\Aden\\AppData\\Roaming\\HomeBot' },
    perf: { startup: stat(2000), firstToken: stat(900) },
  });

  test('includes app + runtime details', () => {
    expect(report).toContain('- Version: 1.1.0');
    expect(report).toContain('- Platform: win32 (x64)');
    expect(report).toContain('- Electron: 28.0.0');
    expect(report).toContain('- Build: packaged, release');
  });
  test('redacts the data folder path', () => {
    expect(report).toContain('Data folder: ~\\AppData\\Roaming\\HomeBot');
    expect(report).not.toContain('Aden');
  });
  test('good metrics → Good health and no hints', () => {
    expect(report).toContain('Overall health: Good');
    expect(report).toContain('Startup: Good — p95 2000 ms (p50 1600 ms, n=5)');
    expect(report).not.toContain('### Hints');
  });

  test('slow metrics surface hints', () => {
    const slow = buildDiagnosticsReport({
      generatedAt: FIXED,
      perf: { startup: stat(12000), firstToken: stat(8000) },
    });
    expect(slow).toContain('Overall health: Slow');
    expect(slow).toContain('### Hints');
    expect(slow).toContain('Startup is slow');
    expect(slow).toContain('First response is slow');
  });

  test('deterministic for identical input', () => {
    const a = buildDiagnosticsReport({ generatedAt: FIXED, appVersion: '1.1.0', perf: { startup: stat(2000), firstToken: noData() } });
    const b = buildDiagnosticsReport({ generatedAt: FIXED, appVersion: '1.1.0', perf: { startup: stat(2000), firstToken: noData() } });
    expect(a).toBe(b);
  });
});
