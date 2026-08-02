/**
 * Batch transparency tests — real registry with test-registered tools;
 * electron/mcp-client/config-manager mocked per the permissions-smoke pattern
 * (no electron binary in the sandbox; assertPermission made deterministic —
 * it is the only config-manager export tools/index.ts uses).
 */

jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn(), removeHandler: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: jest.fn(() => false) },
}));

const assertPermission = jest.fn();
jest.mock('../config-manager', () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

import {
  clearBatchSummariesForTests,
  executeToolBatch,
  getRecentBatchSummaries,
  previewBatch,
  registerTool,
  setBatchSummaryForwarder,
} from '../tools/index';

const okHandler = jest.fn(async () => ({ success: true, result: 'done' }));
const failHandler = jest.fn(async () => {
  throw new Error('boom');
});

registerTool(
  'trusttest_ok',
  { name: 'trusttest_ok', description: 'test', parameters: { type: 'object', properties: {} } } as any,
  okHandler as any
);
registerTool(
  'trusttest_fail',
  { name: 'trusttest_fail', description: 'test', parameters: { type: 'object', properties: {} } } as any,
  failHandler as any
);

const ctx = {} as any;

describe('batch transparency', () => {
  beforeEach(() => {
    clearBatchSummariesForTests();
    setBatchSummaryForwarder(null);
    assertPermission.mockReset();
    assertPermission.mockReturnValue(true);
    okHandler.mockClear();
    failHandler.mockClear();
  });

  test('executed batch records a summary with per-call outcomes and calls the forwarder', async () => {
    const forwarded: unknown[] = [];
    setBatchSummaryForwarder((s) => forwarded.push(s));

    const results = await executeToolBatch(
      [
        { name: 'trusttest_ok', arguments: {} },
        { name: 'trusttest_fail', arguments: {} },
      ],
      ctx
    );

    expect(results).toHaveLength(2);
    const summaries = getRecentBatchSummaries();
    expect(summaries).toHaveLength(1);
    const s = summaries[0];
    expect(s.kind).toBe('executed');
    expect(s.total).toBe(2);
    expect(s.succeeded).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.calls.map((c) => c.name)).toEqual(['trusttest_ok', 'trusttest_fail']);
    expect(s.calls.every((c) => c.durationMs >= 0)).toBe(true);
    const failCall = s.calls.find((c) => c.name === 'trusttest_fail');
    expect(failCall?.ok).toBe(false);
    expect(failCall?.error).toContain('boom');
    expect(forwarded).toEqual([s]);
  });

  test('a throwing forwarder never breaks execution', async () => {
    setBatchSummaryForwarder(() => {
      throw new Error('renderer gone');
    });
    const results = await executeToolBatch([{ name: 'trusttest_ok', arguments: {} }], ctx);
    expect(results[0].success).toBe(true);
    expect(getRecentBatchSummaries()).toHaveLength(1);
  });

  test('dry-run returns a preview, executes nothing, and records no summary', async () => {
    const results = await executeToolBatch(
      [
        { name: 'trusttest_ok', arguments: { path: '/tmp/x' } },
        { name: 'trusttest_fail', arguments: {} },
      ],
      ctx,
      { dryRun: true }
    );

    expect(results).toHaveLength(1);
    const r = results[0] as any;
    expect(r.success).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.preview.kind).toBe('preview');
    expect(r.preview.total).toBe(2);
    expect(r.preview.wouldExecute).toBe(true);
    expect(r.preview.calls[0].argsSummary).toBe('path: /tmp/x');
    expect(okHandler).not.toHaveBeenCalled();
    expect(failHandler).not.toHaveBeenCalled();
    expect(getRecentBatchSummaries()).toHaveLength(0);
  });

  test('permission-blocked batch keeps the needs_confirmation contract and records a blocked summary', async () => {
    assertPermission.mockReturnValue(false);
    const results = await executeToolBatch([{ name: 'trusttest_ok', arguments: {} }], ctx);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect((results[0] as any).status).toBe('needs_confirmation');
    expect(okHandler).not.toHaveBeenCalled();

    const summaries = getRecentBatchSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].kind).toBe('blocked');
    expect(summaries[0].missingPermissions).toContain('trusttest_ok');
  });

  test('previewBatch flags unknown tools and denied permissions without executing', async () => {
    assertPermission.mockImplementation((name: unknown) => name !== 'trusttest_fail');
    const p = previewBatch([
      { name: 'trusttest_ok', arguments: {} },
      { name: 'trusttest_fail', arguments: {} },
      { name: 'no_such_tool', arguments: {} },
    ]);
    expect(p.wouldExecute).toBe(false);
    expect(p.unknownTools).toEqual(['no_such_tool']);
    expect(p.missingPermissions).toContain('trusttest_fail');
    expect(p.calls[0].permission).toBe('granted');
    expect(okHandler).not.toHaveBeenCalled();
  });

  test('the summary buffer is capped at 20, newest first', async () => {
    for (let i = 0; i < 25; i++) {
      await executeToolBatch([{ name: 'trusttest_ok', arguments: { i } }], ctx);
    }
    const summaries = getRecentBatchSummaries();
    expect(summaries).toHaveLength(20);
    expect(summaries.every((s) => s.kind === 'executed')).toBe(true);
  });
});
