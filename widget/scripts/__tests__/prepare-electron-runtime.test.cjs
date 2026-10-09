'use strict';
// Tiny private metadata fixtures; every installer/process operation is mocked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { prepareElectronRuntime, installerEnvironment, EXPECTED_VERSION, INSTALL_TIMEOUT_MS } = require('../prepare-electron-runtime.cjs');

function fixture(run) {
  const parent = fs.realpathSync(os.tmpdir()), directory = fs.mkdtempSync(path.join(parent, 'hbi-electron-contract-'));
  const widgetRoot = path.join(directory, 'widget'), packageRoot = path.join(widgetRoot, 'node_modules', 'electron');
  fs.mkdirSync(packageRoot, { recursive: true });
  const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const declaration = { devDependencies: { electron: EXPECTED_VERSION } };
  const lock = { packages: { '': declaration, 'node_modules/electron': { version: EXPECTED_VERSION, resolved: `https://registry.npmjs.org/electron/-/electron-${EXPECTED_VERSION}.tgz`, integrity: 'sha512-' + 'A'.repeat(86) + '==' } } };
  json(path.join(widgetRoot, 'package.json'), declaration); json(path.join(widgetRoot, 'package-lock.json'), lock);
  json(path.join(packageRoot, 'package.json'), { name: 'electron', version: EXPECTED_VERSION });
  json(path.join(packageRoot, 'checksums.json'), { [`electron-v${EXPECTED_VERSION}-win32-x64.zip`]: 'a'.repeat(64) });
  fs.writeFileSync(path.join(packageRoot, 'install.js'), '// Mock fixture only; no executable installer.');
  const calls = [], runtime = { widgetRoot, platform: 'win32', arch: 'x64', execPath: 'C:\\fixed\\node.exe', env: { SystemRoot: 'C:\\Windows', PATH: 'fixed' }, spawnSync(...args) { calls.push(args); throw Error('Unexpected installer execution'); } };
  const ready = (relative = 'electron.exe', version = EXPECTED_VERSION) => {
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'path.txt'), relative);
    fs.writeFileSync(path.join(packageRoot, 'dist', 'version'), version);
    const bytes = Buffer.alloc(512); bytes.write('MZ'); fs.writeFileSync(path.join(packageRoot, 'dist', 'electron.exe'), bytes);
  };
  let primary;
  try { run({ widgetRoot, packageRoot, calls, runtime, ready, json, declaration, lock }); }
  catch (error) { primary = error; throw error; }
  finally {
    try {
      assert(path.isAbsolute(directory) && path.dirname(directory) === parent && path.basename(directory).startsWith('hbi-electron-contract-'));
      assert(!fs.lstatSync(directory).isSymbolicLink() && fs.realpathSync(directory) === directory);
      fs.rmSync(directory, { recursive: true });
    } catch (error) { if (!primary) throw error; console.error('Preparation fixture cleanup failed; original assertion retained.'); }
  }
}

test('first missing binary uses only fixed installed installer/current Node and verifies emitted runtime', () => fixture(({ runtime, calls, packageRoot, ready }) => {
  runtime.spawnSync = (...args) => { calls.push(args); ready(); return { status: 0, signal: null }; };
  const result = prepareElectronRuntime({}, runtime);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], runtime.execPath);
  assert.deepEqual(calls[0][1], [path.join(packageRoot, 'install.js')]);
  assert.equal(calls[0][2].cwd, packageRoot); assert.equal(calls[0][2].timeout, 540000);
  assert.equal(calls[0][2].windowsHide, true); assert.equal(calls[0][2].stdio, 'inherit');
  assert.equal(result.electronPreparation.version, EXPECTED_VERSION); assert.equal(result.electronPreparation.preparation, 'installed');
  assert.equal(result.electronPreparation.ready, true); assert.equal(result.electronPreparation.executableWasLaunched, false);
}));

test('existing valid executable is inspected without requiring Electron or spawning installer/app', () => fixture(({ runtime, ready, calls }) => {
  ready(); assert.equal(prepareElectronRuntime({}, runtime).electronPreparation.preparation, 'already-ready'); assert.equal(calls.length, 0);
}));

test('validation-only missing binary refuses without installing', () => fixture(({ runtime, calls }) => {
  assert.throws(() => prepareElectronRuntime({ validateOnly: true }, runtime), { code: 'ELECTRON_BINARY_INCOMPLETE' }); assert.equal(calls.length, 0);
}));

test('validation-only existing binary is read-only and reports metadata scope', () => fixture(({ runtime, ready, calls }) => {
  ready(); assert.equal(prepareElectronRuntime({ validateOnly: true }, runtime).electronPreparation.preparation, 'validation-only'); assert.equal(calls.length, 0);
}));

test('timeout, null status, nonzero, signal and transport errors cannot report readiness', () => fixture(({ runtime }) => {
  for (const result of [{ status: null, error: { code: 'ETIMEDOUT' } }, { status: null }, { status: 1 }, { status: 0, signal: 'SIGTERM' }, { status: 0, error: { code: 'unknown' } }, undefined]) {
    runtime.spawnSync = () => result;
    assert.throws(() => prepareElectronRuntime({}, runtime), { code: result?.error?.code === 'ETIMEDOUT' ? 'ELECTRON_INSTALL_TIMEOUT' : 'ELECTRON_INSTALL_FAILED' });
  }
  runtime.spawnSync = () => { throw Error('raw secret error'); };
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_INSTALL_LAUNCH_FAILED' });
  assert.equal(INSTALL_TIMEOUT_MS, 9 * 60 * 1000);
}));

test('installer status zero without complete host output still fails', () => fixture(({ runtime }) => {
  runtime.spawnSync = () => ({ status: 0, signal: null });
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_BINARY_INCOMPLETE' });
}));

test('declared, lock and installed version pins must agree before any installer executes', () => fixture(({ runtime, calls, widgetRoot, packageRoot, json, declaration, lock }) => {
  json(path.join(widgetRoot, 'package.json'), { devDependencies: { electron: '42.8.1' } });
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_VERSION_PIN_MISMATCH' });
  json(path.join(widgetRoot, 'package.json'), declaration); lock.packages['node_modules/electron'].version = '42.8.1'; json(path.join(widgetRoot, 'package-lock.json'), lock);
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_VERSION_PIN_MISMATCH' });
  lock.packages['node_modules/electron'].version = EXPECTED_VERSION; json(path.join(widgetRoot, 'package-lock.json'), lock);
  json(path.join(packageRoot, 'package.json'), { name: 'electron', version: '42.8.1' });
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_INSTALLED_VERSION_MISMATCH' }); assert.equal(calls.length, 0);
}));

test('remote package replacement and missing integrity are refused before installation', () => fixture(({ runtime, calls, widgetRoot, json, lock }) => {
  lock.packages['node_modules/electron'].resolved = 'https://unapproved.invalid/electron.tgz'; json(path.join(widgetRoot, 'package-lock.json'), lock);
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_VERSION_PIN_MISMATCH' });
  lock.packages['node_modules/electron'].resolved = `https://registry.npmjs.org/electron/-/electron-${EXPECTED_VERSION}.tgz`; delete lock.packages['node_modules/electron'].integrity; json(path.join(widgetRoot, 'package-lock.json'), lock);
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_VERSION_PIN_MISMATCH' }); assert.equal(calls.length, 0);
  lock.packages['node_modules/electron'].integrity = 'sha512-A=='; json(path.join(widgetRoot, 'package-lock.json'), lock);
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_VERSION_PIN_MISMATCH' }); assert.equal(calls.length, 0);
}));

test('bundled checksum must cover exact default host/version without remote checksum bypass', () => fixture(({ runtime, packageRoot, json, calls }) => {
  json(path.join(packageRoot, 'checksums.json'), { [`electron-v${EXPECTED_VERSION}-darwin-arm64.zip`]: 'b'.repeat(64) });
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_BUNDLED_CHECKSUM_MISSING' }); assert.equal(calls.length, 0);
}));

test('ambient target/mirror/checksum/cache/preload flags are removed while normal host environment is copied', () => {
  const original = { SystemRoot: 'C:\\Windows', HOME: 'private', PATH: 'fixed', ELECTRON_OVERRIDE_DIST_PATH: 'external', ELECTRON_MIRROR: 'external', electron_use_remote_checksums: '1', npm_config_electron_use_remote_checksums: '1', ELECTRON_INSTALL_PLATFORM: 'darwin', npm_config_arch: 'arm64', npm_config_platform: 'darwin', ELECTRON_CUSTOM_DIR: 'external', ELECTRON_CONFIG_CACHE: 'external', force_no_cache: 'true', NODE_OPTIONS: '--require forbidden', NODE_PATH: 'external', HOMEBOT_E2E: '1' };
  assert.deepEqual(installerEnvironment(original), { SystemRoot: 'C:\\Windows', HOME: 'private', PATH: 'fixed' });
  assert.equal(original.ELECTRON_MIRROR, 'external');
});

test('wrong path marker, dist version or executable magic is incomplete in validation-only mode', () => fixture(({ runtime, ready, packageRoot, calls }) => {
  ready('../outside.exe'); assert.throws(() => prepareElectronRuntime({ validateOnly: true }, runtime), { code: 'ELECTRON_BINARY_INCOMPLETE' });
  ready('electron.exe', '42.8.1'); assert.throws(() => prepareElectronRuntime({ validateOnly: true }, runtime), { code: 'ELECTRON_BINARY_INCOMPLETE' });
  ready(); fs.writeFileSync(path.join(packageRoot, 'dist', 'electron.exe'), Buffer.alloc(512));
  assert.throws(() => prepareElectronRuntime({ validateOnly: true }, runtime), { code: 'ELECTRON_BINARY_INCOMPLETE' }); assert.equal(calls.length, 0);
}));

test('redirected installed package or executable cannot satisfy canonical readiness', () => fixture(({ runtime, packageRoot, ready, calls }) => {
  ready(); const realpath = fs.realpathSync;
  runtime.io = { ...fs, realpathSync(file) { return file === packageRoot ? path.join(path.dirname(packageRoot), 'different') : realpath(file); } };
  assert.throws(() => prepareElectronRuntime({ validateOnly: true }, runtime), { code: 'ELECTRON_PACKAGE_REDIRECTED' });
  runtime.io.realpathSync = file => file === path.join(packageRoot, 'dist', 'electron.exe') ? path.join(path.dirname(packageRoot), 'outside.exe') : realpath(file);
  assert.throws(() => prepareElectronRuntime({ validateOnly: true }, runtime), { code: 'ELECTRON_BINARY_INCOMPLETE' }); assert.equal(calls.length, 0);
}));

test('installed package is rechecked after a purported successful install', () => fixture(({ runtime, ready, packageRoot, json }) => {
  runtime.spawnSync = () => { ready(); json(path.join(packageRoot, 'package.json'), { name: 'electron', version: '42.8.1' }); return { status: 0, signal: null }; };
  assert.throws(() => prepareElectronRuntime({}, runtime), { code: 'ELECTRON_INSTALLED_VERSION_MISMATCH' });
}));
