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
  // Defaults to "the user has not granted standing permission", so the tests
  // above still describe a run with no consent of any kind.
  hasStandingConsent: jest.fn(() => false),
}));
// Pointed at a throwaway directory by the standing-consent tests below, which
// need config-manager to read a settings file they control. jest.mock factories
// may only close over names beginning with "mock".
let mockUserDataDir = require('os').tmpdir();
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => mockUserDataDir),
    getAppPath: jest.fn(() => mockUserDataDir),
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

/**
 * "Always allow" is consent given in advance.
 *
 * Refusing it made the fail-closed rule too broad: a scheduled automation
 * could never touch a tool the user had explicitly allowed, which is most of
 * the point of the Automation Center. Found because an e2e test that granted
 * write_file and then wrote a file had been failing invisibly — the CI job
 * that runs it died in setup before reaching a test.
 */
describe('standing consent', () => {
  const { hasStandingConsent } = require('../config-manager');

  afterEach(() => (hasStandingConsent as jest.Mock).mockReturnValue(false));

  it('lets an unattended run proceed for a tool the user always-allowed', async () => {
    (hasStandingConsent as jest.Mock).mockReturnValue(true);
    const res = await executeTool(
      { name: 'test_destructive_thing', arguments: {} },
      { executionId: 'standing' } as any,
    );
    expect(ran.destructive).toBe(1);
    expect(res.success).toBe(true);
  });

  it('still asks when a channel exists, so a live run is not silently skipped', async () => {
    (hasStandingConsent as jest.Mock).mockReturnValue(true);
    const asked: string[] = [];
    await executeTool(
      { name: 'test_destructive_thing', arguments: {} },
      { executionId: 'attended', requestConfirmation: async (m: string) => { asked.push(m); return true; } } as any,
    );
    expect(asked).toHaveLength(1);
  });

  it('a decline still stops it, standing consent or not', async () => {
    (hasStandingConsent as jest.Mock).mockReturnValue(true);
    const res = await executeTool(
      { name: 'test_destructive_thing', arguments: {} },
      { executionId: 'declined', requestConfirmation: async () => false } as any,
    );
    expect(ran.destructive).toBe(0);
    expect(res.success).toBe(false);
  });
});

/**
 * The boundary that keeps the above from reopening the hole.
 *
 * A permission being `true` is NOT consent on its own: run_terminal_command
 * requires confirmation and SHIPS defaulting to true, so "permissions[x] ===
 * true" would have let an unattended run execute arbitrary shell commands.
 * Standing consent means the user MOVED the setting.
 */
describe('what counts as the user having chosen', () => {
  const fs = require('fs');
  const os = require('os');
  const nodePath = require('path');

  /**
   * hasStandingConsent reads settings through config-manager's own
   * module-local getSettings, so jest.spyOn on the export cannot reach it, and
   * a doMock inside isolateModules loses to the hoisted mock at the top of this
   * file. So point the mocked userData at a throwaway directory and let the
   * real read happen.
   *
   * The directory is unique per case and removed afterwards: settings written
   * into the shared tmpdir are how one suite has broken another here before.
   */
  function withPermissions(permissions: Record<string, boolean>, assert: (cm: any) => void) {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'homebot-consent-'));
    const previous = mockUserDataDir;
    fs.mkdirSync(nodePath.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(
      nodePath.join(dir, 'config', 'user-settings.json'),
      JSON.stringify({ permissions }),
      'utf-8',
    );
    mockUserDataDir = dir;
    try {
      // requireActual, not require: the mock at the top of this file replaces
      // hasStandingConsent with a stub, which would make these tests assert
      // the stub's return value. isolateModules gives it a fresh settings cache.
      jest.isolateModules(() => assert(jest.requireActual('../config-manager')));
    } finally {
      mockUserDataDir = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('a tool that ships allowed gets no standing consent from staying allowed', () => {
    const { DEFAULT_SETTINGS } = jest.requireActual('../config-manager');
    const shipped = Object.entries(DEFAULT_SETTINGS.permissions as Record<string, boolean>)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    // run_terminal_command is the case that matters: confirm-required AND
    // shipped allowed. If it ever stops being both, this guard tests nothing.
    expect(shipped).toContain('run_terminal_command');

    withPermissions({ run_terminal_command: true }, (cm) => {
      expect(cm.hasStandingConsent('run_terminal_command')).toBe(false);
    });
  });

  it('a tool that ships denied does, once the user allows it', () => {
    withPermissions({ write_file: true }, (cm) => {
      expect(cm.hasStandingConsent('write_file')).toBe(true);
    });
  });

  it('and not while it is still denied', () => {
    withPermissions({ write_file: false }, (cm) => {
      expect(cm.hasStandingConsent('write_file')).toBe(false);
    });
  });
});
