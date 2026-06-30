import { buildSupportReport, SupportReportInput } from '../support-report';

const stat = (over: Partial<any> = {}) => ({
  count: 5, avg_ms: 1000, p50_ms: 900, p95_ms: 1500, min_ms: 800, max_ms: 1600, last_ms: 1200, ...over,
});

const fullSystemCheck = {
  disk: { freeGB: 42.5, ok: true, warning: null },
  ollama: { reachable: true, latencyMs: 12 },
  n8n: { reachable: false, latencyMs: null },
  qdrant: { reachable: true, latencyMs: 8 },
  permissions: { canWrite: true },
  hardware: { vramGB: 8, gpuName: 'NVIDIA RTX 4060', profile: '8gb' },
  timestamp: '2026-06-30T00:00:00.000Z',
};

describe('buildSupportReport', () => {
  test('includes header, perf p95, and system-check details', () => {
    const input: SupportReportInput = {
      generatedAt: '2026-06-30T01:00:00.000Z',
      appVersion: '1.1.0',
      platform: 'Test/1.0',
      perf: { startup: stat(), firstToken: stat({ p95_ms: 450, p50_ms: 300, count: 3 }) },
      systemCheck: fullSystemCheck,
    };
    const out = buildSupportReport(input);

    expect(out).toContain('# HomeBot — Support Report');
    expect(out).toContain('App version: 1.1.0');
    expect(out).toContain('Platform: Test/1.0');
    // perf
    expect(out).toContain('Startup: p50 900 ms · p95 1500 ms');
    expect(out).toContain('First token (TTFT): p50 300 ms · p95 450 ms');
    // system check
    expect(out).toContain('Disk: 42.5 GB free');
    expect(out).toContain('Ollama: online (12 ms)');
    expect(out).toContain('n8n: offline');
    expect(out).toContain('Write permissions: OK');
    expect(out).toContain('GPU: NVIDIA RTX 4060 · 8 GB · 8gb');
  });

  test('handles missing perf and system check gracefully', () => {
    const out = buildSupportReport({ generatedAt: 'now' });
    expect(out).toContain('No performance samples recorded yet.');
    expect(out).toContain('Not run. Use "Run system check"');
    expect(out).toContain('App version: unknown');
    expect(out).toContain('Platform: unknown');
  });

  test('treats zero-sample perf as no data', () => {
    const empty = stat({ count: 0 });
    const out = buildSupportReport({ perf: { startup: empty, firstToken: empty } });
    expect(out).toContain('No performance samples recorded yet.');
  });

  test('flags low disk and missing write permission', () => {
    const out = buildSupportReport({
      systemCheck: {
        ...fullSystemCheck,
        disk: { freeGB: 2.1, ok: false, warning: 'Low disk space' },
        permissions: { canWrite: false },
        hardware: { vramGB: null, gpuName: null, profile: null },
      },
    });
    expect(out).toContain('Disk: 2.1 GB free (LOW) — Low disk space');
    expect(out).toContain('Write permissions: CANNOT WRITE');
    expect(out).toContain('GPU: not detected');
  });
});
