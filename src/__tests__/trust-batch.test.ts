import {
  BatchCallFacts,
  batchSummaryLine,
  buildBatchPreview,
  buildBatchSummary,
  buildBlockedSummary,
  summarizeArgs,
} from '../trust/batch';

function facts(overrides: Partial<BatchCallFacts>): BatchCallFacts {
  return {
    name: 'write_file',
    args: { path: '/tmp/x.txt' },
    known: true,
    requiresConfirmation: false,
    requiredPermissions: [],
    permissionGranted: true,
    ...overrides,
  };
}

describe('trust/batch — preview', () => {
  test('summarizeArgs caps at three keys, truncates values, and names the empty case', () => {
    expect(summarizeArgs({})).toBe('no arguments');
    expect(summarizeArgs({ path: '/tmp/x.txt', append: true })).toBe('path: /tmp/x.txt, append: true');
    const long = summarizeArgs({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    expect(long).toMatch(/\(\+2 more\)$/);
    expect(summarizeArgs({ text: 'x'.repeat(200) })).toContain('…');
  });

  test('all-granted batch previews as executable', () => {
    const p = buildBatchPreview([facts({}), facts({ name: 'read_file' })]);
    expect(p.wouldExecute).toBe(true);
    expect(p.unknownTools).toEqual([]);
    expect(p.missingPermissions).toEqual([]);
    expect(p.calls.every((c) => c.permission === 'granted')).toBe(true);
  });

  test('unknown tools and missing permissions block execution and are rolled up deduped', () => {
    const p = buildBatchPreview([
      facts({ name: 'nope_tool', known: false }),
      facts({ name: 'nope_tool', known: false }),
      facts({ name: 'write_file', permissionGranted: false, requiredPermissions: ['fs_write'] }),
      facts({ name: 'delete_file', permissionGranted: false, requiredPermissions: [] }),
    ]);
    expect(p.wouldExecute).toBe(false);
    expect(p.unknownTools).toEqual(['nope_tool']);
    // declared permission preferred, tool name as fallback
    expect(p.missingPermissions.sort()).toEqual(['delete_file', 'fs_write']);
    expect(p.calls[0].permission).toBe('unknown_tool');
    expect(p.calls[2].permission).toBe('needs_confirmation');
  });
});

describe('trust/batch — summaries', () => {
  test('executed summary aggregates counts and durations', () => {
    const s = buildBatchSummary(
      [
        { name: 'read_file', ok: true, durationMs: 120 },
        { name: 'write_file', ok: false, error: 'EACCES', durationMs: 80 },
        { name: 'list_dir', ok: true, durationMs: -5 }, // negative clamps to 0 in the sum
      ],
      '2026-08-02T04:00:00.000Z'
    );
    expect(s.kind).toBe('executed');
    expect(s.total).toBe(3);
    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.totalDurationMs).toBe(200);
    expect(s.at).toBe('2026-08-02T04:00:00.000Z');
  });

  test('blocked summary marks every call failed with deduped missing permissions', () => {
    const s = buildBlockedSummary(['write_file', 'delete_file'], ['fs_write', 'fs_write']);
    expect(s.kind).toBe('blocked');
    expect(s.total).toBe(2);
    expect(s.failed).toBe(2);
    expect(s.missingPermissions).toEqual(['fs_write']);
    expect(s.calls.every((c) => c.ok === false && c.durationMs === 0)).toBe(true);
  });

  test('batchSummaryLine covers all-ok, partial failure, and blocked shapes', () => {
    const ok = buildBatchSummary([{ name: 'a', ok: true, durationMs: 1500 }]);
    expect(batchSummaryLine(ok)).toBe('1 tool ran, all ok in 1.5s');

    const partial = buildBatchSummary([
      { name: 'a', ok: true, durationMs: 100 },
      { name: 'b', ok: false, error: 'x', durationMs: 100 },
    ]);
    expect(batchSummaryLine(partial)).toBe('2 tools ran: 1 ok, 1 failed (b) in 200ms');

    const blocked = buildBlockedSummary(['a'], ['fs_write']);
    expect(batchSummaryLine(blocked)).toBe('Blocked — 1 tool needed: fs_write');
  });
});
