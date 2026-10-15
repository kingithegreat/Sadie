import { runMcpLiveFixtureCleanupControl } from './mcp-live-fixture-cleanup.controls';

test('native MCP fixture preserves exact primary error and records secondary cleanup refusal', async () => {
  const result = await runMcpLiveFixtureCleanupControl('primary', expect);
  expect(result.error).toBe(result.primary); expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({ primaryFailurePreserved: true, ownedMcpCleanupFailure: [String(result.secondary)] });
  expect(result.removed).toBe(false); expect(result.unrelatedClosed).toBe(true);
});
test('cleanup-only refusal still fails the actual fixture and retains its files', async () => {
  const result = await runMcpLiveFixtureCleanupControl('cleanup-only', expect);
  expect(result.error).toBe(result.secondary); expect(result.closeCalls).toBe(2);
  expect(result.diagnostics[0].primaryFailurePreserved).toBe(false);
  expect(result.removed).toBe(false); expect(result.unrelatedClosed).toBe(true);
});
test('successful assertions and both held cleanups allow fixture file removal', async () => {
  const result = await runMcpLiveFixtureCleanupControl('success', expect);
  expect(result.error).toBeUndefined(); expect(result.diagnostics).toHaveLength(0);
  expect(result.closeCalls).toBe(2); expect(result.removed).toBe(true); expect(result.unrelatedClosed).toBe(true);
});
