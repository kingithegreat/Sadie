/**
 * Registry-vs-permissions parity.
 *
 * For every NATIVE registered tool, at least one of these must hold:
 *   1. DEFAULT_SETTINGS.permissions names it explicitly, or
 *   2. its definition sets requiresConfirmation (default-deny via
 *      assertPermission's `!requiresConfirmation` fallback).
 *
 * A tool satisfying neither is invisible to the permission system twice over:
 * it executes with no dialog AND has no entry a user could ever have turned
 * off or on. That is exactly how all 21 CRM write tools shipped — allowed by
 * default with no gate of any kind — while email_send and media_approve_job
 * next door carried both gates. Nothing asserted the invariant, so nothing
 * noticed.
 *
 * The reverse direction is checked too: a permission key naming no registered
 * tool is either a typo waiting to be "enabled" pointlessly or a stale entry,
 * and this test is where that gets noticed instead of in review.
 */

// Hoisted mocks (same pattern as confirmation-fail-closed.test.ts): index.ts
// pulls mcp-client, which would otherwise spawn real npx subprocesses during
// initializeTools().
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
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

import { __resetToolsInitForTest, initializeTools, getAllToolDefinitions } from '../tools';
import { DEFAULT_SETTINGS } from '../config-manager';

beforeAll(() => {
  __resetToolsInitForTest();
  initializeTools();
});

describe('tool/permission parity', () => {
  const perms = (DEFAULT_SETTINGS.permissions || {}) as Record<string, boolean>;

  test('every native tool has a permission entry or requires confirmation', () => {
    const unlisted = getAllToolDefinitions()
      .filter((d) => !d.name.startsWith('mcp_')) // MCP tools arrive dynamically
      .filter(
        (d) =>
          !Object.prototype.hasOwnProperty.call(perms, d.name) &&
          d.requiresConfirmation !== true
      )
      .map((d) => d.name);

    expect(unlisted).toEqual([]);
  });

  test('every non-MCP permission key names a registered tool', () => {
    const registered = new Set(getAllToolDefinitions().map((d) => d.name));
    const orphans = Object.keys(perms).filter(
      (k) => !k.startsWith('mcp_') && !registered.has(k)
    );

    expect(orphans).toEqual([]);
  });
});
