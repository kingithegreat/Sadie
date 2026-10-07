'use strict';
// Electron 42's npm package resolves a missing binary by running install.js
// synchronously on require('electron'). Prepare it before entering UI tests.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const EXPECTED_VERSION = '42.11.11';
const INSTALL_TIMEOUT_MS = 9 * 60 * 1000;
const WIDGET_ROOT = path.resolve(__dirname, '..');
const failure = code => Object.assign(new Error(code), { code });
const samePath = (a, b, platform) => platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const validIntegrity = value => {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const encoded = value.slice(7), bytes = Buffer.from(encoded, 'base64');
  return bytes.length === 64 && bytes.toString('base64') === encoded;
};

function readRegular(file, maximum, io, platform) {
  const before = io.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum || !samePath(path.resolve(io.realpathSync(file)), path.resolve(file), platform)) throw failure('ELECTRON_PREPARATION_FILE_INVALID');
  const descriptor = io.openSync(file, 'r');
  try {
    const held = io.fstatSync(descriptor);
    if (!held.isFile() || held.dev !== before.dev || held.ino !== before.ino || held.size !== before.size) throw failure('ELECTRON_PREPARATION_FILE_CHANGED');
    const buffer = Buffer.alloc(held.size + 1); let offset = 0;
    while (offset < buffer.length) { const read = io.readSync(descriptor, buffer, offset, buffer.length - offset, offset); if (!read) break; offset += read; }
    const after = io.fstatSync(descriptor);
    if (offset !== held.size || after.dev !== held.dev || after.ino !== held.ino || after.size !== held.size || after.mtimeMs !== held.mtimeMs) throw failure('ELECTRON_PREPARATION_FILE_CHANGED');
    return buffer.subarray(0, offset);
  } finally { io.closeSync(descriptor); }
}

function installerEnvironment(original) {
  const env = {};
  for (const [key, value] of Object.entries(original)) {
    // The official installer must select this Node host, the bundled checksum
    // map and the official release URL, rather than ambient mirror/target knobs.
    if (/^(ELECTRON_|npm_config_electron_|HOMEBOT_)/i.test(key) || /^(force_no_cache|npm_config_(platform|arch|target|runtime|disturl)|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS)$/i.test(key)) continue;
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

function inspectPackage(runtime) {
  const { io, widgetRoot, platform, arch } = runtime;
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw failure('ELECTRON_HOST_UNSUPPORTED');
  const json = (file, maximum) => JSON.parse(readRegular(file, maximum, io, platform).toString('utf8'));
  const declared = json(path.join(widgetRoot, 'package.json'), 256 * 1024);
  const lock = json(path.join(widgetRoot, 'package-lock.json'), 2 * 1024 * 1024);
  const locked = lock.packages?.['node_modules/electron'];
  if (declared.devDependencies?.electron !== EXPECTED_VERSION || lock.packages?.['']?.devDependencies?.electron !== EXPECTED_VERSION || locked?.version !== EXPECTED_VERSION || locked.resolved !== `https://registry.npmjs.org/electron/-/electron-${EXPECTED_VERSION}.tgz` || !validIntegrity(locked.integrity)) throw failure('ELECTRON_VERSION_PIN_MISMATCH');
  // Injection is exclusively exported test/read-only tooling, never CLI/env.
  const packageRoot = runtime.electronPackageRoot || path.join(widgetRoot, 'node_modules', 'electron');
  if (!samePath(path.resolve(io.realpathSync(packageRoot)), path.resolve(packageRoot), platform) || io.lstatSync(packageRoot).isSymbolicLink()) throw failure('ELECTRON_PACKAGE_REDIRECTED');
  const installed = json(path.join(packageRoot, 'package.json'), 256 * 1024);
  if (installed.name !== 'electron' || installed.version !== EXPECTED_VERSION) throw failure('ELECTRON_INSTALLED_VERSION_MISMATCH');
  const installer = path.join(packageRoot, 'install.js');
  readRegular(installer, 256 * 1024, io, platform);
  const checksums = json(path.join(packageRoot, 'checksums.json'), 128 * 1024);
  const archive = `electron-v${EXPECTED_VERSION}-${platform}-${arch}.zip`;
  if (typeof checksums[archive] !== 'string' || !/^[a-f0-9]{64}$/.test(checksums[archive])) throw failure('ELECTRON_BUNDLED_CHECKSUM_MISSING');
  const relativeExecutable = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return { packageRoot, installer, archive, checksum: checksums[archive], relativeExecutable };
}

function binaryReady(runtime, installed) {
  const { io, platform } = runtime;
  try {
    const version = readRegular(path.join(installed.packageRoot, 'dist', 'version'), 64, io, platform).toString('utf8');
    if (version.replace(/^v/, '') !== EXPECTED_VERSION || readRegular(path.join(installed.packageRoot, 'path.txt'), 256, io, platform).toString('utf8') !== installed.relativeExecutable) return false;
    const executable = path.join(installed.packageRoot, 'dist', installed.relativeExecutable), stat = io.lstatSync(executable);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 512 || !samePath(path.resolve(io.realpathSync(executable)), path.resolve(executable), platform)) return false;
    const fd = io.openSync(executable, 'r');
    try {
      const held = io.fstatSync(fd); if (!held.isFile() || held.dev !== stat.dev || held.ino !== stat.ino || held.size !== stat.size) return false;
      const magic = Buffer.alloc(4); if (io.readSync(fd, magic, 0, 4, 0) !== 4) return false;
      if (platform === 'win32') return magic.toString('ascii', 0, 2) === 'MZ';
      if (platform === 'linux') return magic.toString('hex') === '7f454c46';
      return ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic.toString('hex'));
    } finally { io.closeSync(fd); }
  } catch { return false; }
}

function prepareElectronRuntime(options = {}, injected = {}) {
  const runtime = { io: fs, spawnSync: cp.spawnSync, widgetRoot: WIDGET_ROOT, platform: process.platform, arch: process.arch, execPath: process.execPath, env: process.env, ...injected };
  const installed = inspectPackage(runtime), started = Date.now();
  let preparation = 'already-ready';
  if (!binaryReady(runtime, installed)) {
    if (options.validateOnly) throw failure('ELECTRON_BINARY_INCOMPLETE');
    preparation = 'installed';
    let result;
    try { result = runtime.spawnSync(runtime.execPath, [installed.installer], { cwd: installed.packageRoot, env: installerEnvironment(runtime.env), windowsHide: true, stdio: 'inherit', timeout: INSTALL_TIMEOUT_MS }); }
    catch { throw failure('ELECTRON_INSTALL_LAUNCH_FAILED'); }
    if (result?.error?.code === 'ETIMEDOUT') throw failure('ELECTRON_INSTALL_TIMEOUT');
    if (!result || result.error || result.status !== 0 || result.signal != null) throw failure('ELECTRON_INSTALL_FAILED');
    // Recheck the source pin and package identity after installation; success
    // status alone does not prove the expected host executable was emitted.
    const current = inspectPackage(runtime);
    if (current.packageRoot !== installed.packageRoot || !binaryReady(runtime, current)) throw failure('ELECTRON_BINARY_INCOMPLETE');
  }
  return { electronPreparation: { version: EXPECTED_VERSION, platform: runtime.platform, arch: runtime.arch, preparation: options.validateOnly ? 'validation-only' : preparation, bundledArchive: installed.archive, checksum: installed.checksum, installerTimeoutMs: INSTALL_TIMEOUT_MS, elapsedMs: Date.now() - started, ready: true, executableWasLaunched: false } };
}

module.exports = { EXPECTED_VERSION, INSTALL_TIMEOUT_MS, installerEnvironment, prepareElectronRuntime };
if (require.main === module) {
  try {
    const args = process.argv.slice(2); if (args.length > 1 || (args.length === 1 && args[0] !== '--validate-only')) throw failure('ELECTRON_PREPARATION_ARGUMENT_INVALID');
    console.log(JSON.stringify(prepareElectronRuntime({ validateOnly: args[0] === '--validate-only' })));
  } catch (error) { console.error(JSON.stringify({ electronPreparation: { ready: false, code: /^ELECTRON_[A-Z_]+$/.test(error?.code || '') ? error.code : 'ELECTRON_PREPARATION_FAILED' } })); process.exitCode = 1; }
}
