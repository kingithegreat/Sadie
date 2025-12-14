import os from 'os';
import fs from 'fs';
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-smoke-'));
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

    const results = await executeToolBatch(calls as any, { executionId: 'ci-smoke' } as any);

    // Should have executed both calls successfully
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.success).toBe(true);
    }

    // Verify file exists on the real Desktop (path expansion resolves 'Desktop/...')
    // Use environment-based Desktop resolution for CI-friendly checks.
    const desktop = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), 'Desktop');
    const reportPath = path.join(desktop, 'SmokeTest', 'report.txt');
    expect(fs.existsSync(reportPath)).toBe(true);

    // Cleanup: remove the SmokeTest folder from the system Desktop and the temporary HOME
    try { fs.rmSync(path.join(desktop, 'SmokeTest'), { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }, 20000);
});
