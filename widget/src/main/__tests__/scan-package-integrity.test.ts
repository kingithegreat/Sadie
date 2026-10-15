import { spawnSync } from 'child_process';
import path from 'path';

// Required widget CI installs the official ASAR fixture writer through its existing
// electron-builder dependency. Root-only CI does not install widget dependencies.
test('package scanner: native tiny-archive suite executes all controls without retries', () => {
  const project = path.resolve(__dirname, '../../../..');
  const suite = path.join(project, 'scripts', 'scan-package-integrity.test.js');
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', suite], {
    cwd: project, encoding: 'utf8', windowsHide: true, timeout: 55_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, HOMEBOT_SCANNER_ASAR_MODULE: require.resolve('@electron/asar'),
      npm_config_offline: 'true', npm_config_yes: 'false' },
  });
  const output = result.stdout + result.stderr;
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect({ status: result.status, output }).toEqual({ status: 0, output });
  const count = /^# tests (\d+)$/m.exec(output);
  expect(count).not.toBeNull();
  expect(Number(count![1])).toBe(34);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
  expect(output).toContain('scans the application archive without extraction or filesystem writes');
  expect(output).toContain('rejects packed bytes that disagree with official declared integrity');
  expect(output).toContain('rejects an unpacked ancestor redirected by a junction or symlink');
}, 60_000);
