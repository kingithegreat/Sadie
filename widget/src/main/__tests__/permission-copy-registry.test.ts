/**
 * Drift gate for the permission copy registry (issue #6 copy pass).
 *
 * Every permission name in config-manager's DEFAULT_SETTINGS.permissions must
 * resolve to human-written copy — either an explicit KNOWN_PERMISSION_COPY
 * entry or the mcp_<server>_<tool> heuristic. If a new tool permission is
 * added to the defaults without copy, this test fails, so a raw slug can
 * never reach the permission modal for a native tool.
 */

// jest.mock is hoisted before imports — mock electron BEFORE config-manager
// loads (it touches app.getPath at module scope). Canonical mock block from
// permissions-smoke.test.ts.
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    webContents: { send: jest.fn() },
  })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

import { describePermission } from '../../../../src/trust/permission-copy';

describe('permission copy registry covers every default permission', () => {
  test('no default permission falls back to the generic prettifier', () => {
    const { DEFAULT_SETTINGS } = require('../config-manager');
    const names = Object.keys(DEFAULT_SETTINGS.permissions || {});
    expect(names.length).toBeGreaterThan(50);

    const uncovered = names.filter((n) => describePermission(n).source === 'fallback');
    // Every native permission needs explicit copy; MCP-style names are
    // covered by the heuristic. An empty list means full coverage.
    expect(uncovered).toEqual([]);
  });
});
