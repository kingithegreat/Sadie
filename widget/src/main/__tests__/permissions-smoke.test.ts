// jest.mock is hoisted before imports — mock mcp-client so initializeTools()'s
// fire-and-forget MCP bootstrap (../mcp-client's initializeMcpServers) never
// spawns real npx subprocesses / makes real network calls in this smoke test.
// Without this, initializeTools() kicks off connection attempts (with retries)
// that are still in flight when the test's own assertions finish — Jest tears
// the environment down mid-flight and any subsequent console.log/warn/error
// from those retries fails the whole run with "Cannot log after tests are done",
// even though the actual permission-batch assertions passed.
jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));

// jest.mock is hoisted before imports — mock electron BEFORE tools/index.ts loads
// so mcp-client.ts sees a valid app when seedMcpDefaults() calls app.getPath().
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

import os from 'os';
import * as fs from 'fs';
import path from 'path';

// Note: we intentionally `require` the tools after setting `HOME` so
// that module-level HOME_DIR constants in `filesystem.ts` pick up the
// test-specific temp directory.
let executeToolBatch: any;
let initializeTools: any;
let config: any;

describe('CI smoke - permissions', () => {
  test('permission-allowed batch executes end-to-end', async () => {
    // Make a temp HOME so writes do not affect runner home and ensure module-level
    // constants are initialized with this temp during module load.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-smoke-'));
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;

    // Require modules after HOME is set so internal `HOME_DIR` values are correct
    ({ executeToolBatch, initializeTools } = require('../tools'));
    config = require('../config-manager');

    // Initialize built-in tools
    initializeTools();

    // Ensure assertPermission returns true for the smoke
    jest.spyOn(config, 'assertPermission').mockImplementation(() => true as any);

    const calls = [
      { name: 'create_directory', arguments: { path: 'Desktop/SmokeTest' } },
      { name: 'write_file', arguments: { path: 'Desktop/SmokeTest/report.txt', content: 'smoke' } }
    ];

    // write_file requires confirmation, and the real chat path always supplies
    // a confirmation callback (message-router passes requestConfirmation into
    // every tool context it builds). This ran without one and still expected
    // success, which quietly asserted the old fail-open: executeTool used to
    // skip the confirmation block entirely when no callback was present, so a
    // confirm-required tool ran unconfirmed. Supplying one here matches
    // production and keeps the check meaningful — see
    // confirmation-fail-closed.test.ts for the refusal case.
    const results = await executeToolBatch(
      calls as any,
      { executionId: 'ci-smoke', requestConfirmation: async () => true } as any,
    );

    // Should have executed both calls successfully
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.success).toBe(true);
    }

    // Verify file exists by resolving via HomeBot's path resolver
    const { resolveUserPath } = require('../tools/filesystem');
    const reportPath = resolveUserPath('Desktop/SmokeTest/report.txt');
    expect(fs.existsSync(reportPath)).toBe(true);

    // Cleanup: remove the SmokeTest folder from the system Desktop and the temporary HOME
    try { fs.rmSync(resolveUserPath('Desktop/SmokeTest'), { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }, 20000);
});
