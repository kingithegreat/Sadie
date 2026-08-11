/**
 * A tool that requires confirmation must not run when nothing can ask for it.
 *
 * executeTool gated the prompt on `requiresConfirmation && requestConfirmation`,
 * so a caller that supplied no callback skipped the block entirely and the tool
 * executed unconfirmed. Fail-open — three lines below a permission check whose
 * own comment reads "fail closed if any error occurs".
 *
 * The callers that omit the callback are precisely the unattended ones. A live
 * startup log shows `hasCallback=false` for the morning briefing on every
 * launch, and scheduled automations run the same way with no user present.
 * assistant-bridge.ts's header also promises that every call through
 * executeTool enforces assertPermission + requestConfirmation, which this
 * quietly made untrue.
 *
 * Found by reading a startup log, not by a test — nothing here asserted the
 * negative case.
 */

// Both mocks are hoisted above the imports, matching permissions-smoke.test.ts:
// tools/index.ts pulls in mcp-client (which would spawn real npx subprocesses)
// and electron's app.getPath during module load.
jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));
// Permission is a separate gate and passes for any tool the user has enabled.
// Forced open here so these tests isolate the CONFIRMATION gate behind it —
// the real-world case is clipboard_read, which ships enabled by default and
// requires confirmation, so on a default install an unattended path could read
// the clipboard with no prompt at all.
jest.mock('../config-manager', () => ({
  ...jest.requireActual('../config-manager'),
  assertPermission: jest.fn(() => true),
}));
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

import { registerTool, executeTool } from '../tools';

const ran = { destructive: 0, safe: 0 };

beforeAll(() => {
  registerTool(
    'test_destructive_thing',
    {
      name: 'test_destructive_thing',
      description: 'Pretends to do something irreversible',
      category: 'system',
      requiresConfirmation: true,
      parameters: { type: 'object', properties: {}, required: [] },
    } as any,
    async () => { ran.destructive++; return { success: true, result: 'did it' } as any; },
  );

  registerTool(
    'test_safe_thing',
    {
      name: 'test_safe_thing',
      description: 'Read-only, needs no confirmation',
      category: 'system',
      parameters: { type: 'object', properties: {}, required: [] },
    } as any,
    async () => { ran.safe++; return { success: true, result: 'read' } as any; },
  );
});

beforeEach(() => { ran.destructive = 0; ran.safe = 0; });

describe('confirmation is required, not merely offered', () => {
  it('refuses a confirm-required tool when no callback exists', async () => {
    const res = await executeTool(
      { name: 'test_destructive_thing', arguments: {} },
      { executionId: 'no-callback' } as any,
    );
    // The regression: this used to succeed, having run the tool.
    expect(ran.destructive).toBe(0);
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/confirm/i);
  });

  it('runs it when the user confirms', async () => {
    const res = await executeTool(
      { name: 'test_destructive_thing', arguments: {} },
      { executionId: 'yes', requestConfirmation: async () => true } as any,
    );
    expect(ran.destructive).toBe(1);
    expect(res.success).toBe(true);
  });

  it('refuses when the user declines', async () => {
    const res = await executeTool(
      { name: 'test_destructive_thing', arguments: {} },
      { executionId: 'no', requestConfirmation: async () => false } as any,
    );
    expect(ran.destructive).toBe(0);
    expect(res.success).toBe(false);
  });

  it('still runs ordinary tools with no callback', async () => {
    // The unattended paths — morning briefing, scheduler — must keep working
    // for everything that does not need consent.
    const res = await executeTool(
      { name: 'test_safe_thing', arguments: {} },
      { executionId: 'safe' } as any,
    );
    expect(ran.safe).toBe(1);
    expect(res.success).toBe(true);
  });
});
