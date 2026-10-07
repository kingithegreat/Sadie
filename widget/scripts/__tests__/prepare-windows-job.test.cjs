'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sourceFile = path.resolve(__dirname, '../prepare-windows-job.cjs');
function fixture() {
  const root = 'C:\\HomeBot\\widget', dir = path.win32.join(root, 'native', 'generated');
  const preparation = path.win32.join(root, 'scripts', 'prepare-windows-job.cjs');
  const files = new Map([[path.win32.join(root, 'native', 'OwnedWindowsJob.cs'), Buffer.from('trusted immutable source')], [preparation, fs.readFileSync(sourceFile)]]);
  const compiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const framework = path.win32.dirname(compiler);
  files.set(compiler, Buffer.from('compiler'));
  for (const name of ['mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Web.Extensions.dll']) files.set(path.win32.join(framework, name), Buffer.from('fixed system ref'));
  const stats = file => ({ size: files.get(file)?.length || 0, isFile: () => files.has(file), isDirectory: () => file === dir, isSymbolicLink: () => false });
  const calls = [];
  const fakeFs = { existsSync: file => files.has(file), lstatSync: stats, statSync: stats, realpathSync: { native: file => file }, readFileSync: (file, encoding) => { if (!files.has(file)) throw Error('missing'); return encoding ? files.get(file).toString(encoding) : files.get(file); }, mkdirSync: () => {}, renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); }, writeFileSync: (file, value) => files.set(file, Buffer.from(value)), unlinkSync: file => files.delete(file) };
  let failure = false;
  const spawnSync = (exe, argv, options) => {
    calls.push({ exe, argv, options }); if (failure) return { status: 1 };
    const bytes = Buffer.alloc(512); bytes.write('MZ'); files.set(argv.find(arg => arg.startsWith('/out:')).slice(5), bytes); return { status: 0, signal: null };
  };
  const module = { exports: {} };
  const proc = { platform: 'win32', env: { SystemRoot: 'C:\\Windows', NODE_OPTIONS: '--require malicious', PSModulePath: 'C:\\project', PATH: 'C:\\project', PRIVATE_SECRET: 'never-forward' } };
  const req = name => ({ 'node:fs': fakeFs, 'node:path': { ...path.win32, win32: path.win32 }, 'node:crypto': crypto, 'node:child_process': { spawnSync } })[name];
  const load = (code, target) => vm.runInNewContext(code, { require: req, module: target, __filename: preparation, __dirname: path.win32.join(root, 'scripts'), process: proc, Buffer });
  load(fs.readFileSync(sourceFile, 'utf8'), module);
  return { api: module.exports, files, calls, proc, dir, preparation, framework, reload(code) { files.set(preparation, Buffer.from(code)); const next = { exports: {} }; load(code, next); return next.exports; }, fail: () => { failure = true; } };
}
test('preparation uses installed compiler/absolute references and strips request/module environment', () => {
  const f = fixture(), result = f.api.prepareWindowsJob(), call = f.calls[0];
  assert.equal(result.version, 2); assert.match(result.assemblySha256, /^[a-f0-9]{64}$/);
  assert.equal(call.exe, 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe');
  assert.equal(call.options.cwd, path.win32.dirname(call.exe));
  assert.equal(call.options.shell, false); assert.equal(call.options.timeout, 30000); assert.equal(call.options.maxBuffer, 262144);
  assert.deepEqual(Object.keys(call.options.env).sort(), ['SystemRoot', 'TEMP', 'TMP']);
  assert.ok(call.argv.includes('/noconfig')); assert.ok(call.argv.includes('/nostdlib+'));
  for (const arg of call.argv.filter(arg => arg.startsWith('/reference:'))) assert.ok(path.win32.isAbsolute(arg.slice(11)));
});
test('same prepared product bytes are reused by dev/build/Jest while changed source rebuilds', () => {
  const f = fixture(); f.api.prepareWindowsJob(); f.api.prepareWindowsJob(); assert.equal(f.calls.length, 1);
  f.files.set(path.win32.join(path.win32.dirname(f.dir), 'OwnedWindowsJob.cs'), Buffer.from('changed immutable source'));
  f.api.prepareWindowsJob(); assert.equal(f.calls.length, 2);
});
test('tampered cached DLL is rebuilt during preparation rather than trusted', () => {
  const f = fixture(); f.api.prepareWindowsJob(); f.files.get(path.win32.join(f.dir, 'OwnedWindowsJob.dll'))[511] = 1;
  f.api.prepareWindowsJob(); assert.equal(f.calls.length, 2);
});
test('changed preparation bytes invalidate cached output even when C# and compiler are unchanged', () => {
  const f = fixture(), previous = f.api.prepareWindowsJob();
  f.files.set(f.preparation, Buffer.from('changed immutable preparation implementation'));
  const current = f.api.prepareWindowsJob();
  assert.equal(f.calls.length, 2); assert.notEqual(current.preparationSha256, previous.preparationSha256);
});
test('changed actual compiler flags invalidate cached options independently of the script hash', () => {
  const f = fixture(), previous = f.api.prepareWindowsJob();
  const next = fs.readFileSync(sourceFile, 'utf8').replace("'/optimize+'", "'/optimize-'");
  const api = f.reload(next), file = path.win32.join(f.dir, 'manifest.json');
  const metadata = JSON.parse(f.files.get(file));
  metadata.preparationSha256 = crypto.createHash('sha256').update(next).digest('hex'); // Isolate the options fence.
  f.files.set(file, Buffer.from(JSON.stringify(metadata)));
  const current = api.prepareWindowsJob();
  assert.equal(f.calls.length, 2); assert.ok(f.calls[1].argv.includes('/optimize-'));
  assert.notEqual(current.optionsSha256, previous.optionsSha256);
});
test('installed reference changes invalidate output and are recorded in fixed ordered metadata', () => {
  const f = fixture(), previous = f.api.prepareWindowsJob();
  f.files.set(path.win32.join(f.framework, 'System.Core.dll'), Buffer.from('updated trusted system reference'));
  const current = f.api.prepareWindowsJob();
  assert.equal(f.calls.length, 2); assert.equal(current.compilerSha256, previous.compilerSha256);
  assert.notEqual(current.references[2].sha256, previous.references[2].sha256);
  assert.equal(JSON.stringify(current.references.map(row => row.name)), JSON.stringify(['mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Web.Extensions.dll']));
});
test('version1 caches are rebuilt rather than promoted without dependency identities', () => {
  const f = fixture(); f.api.prepareWindowsJob();
  const file = path.win32.join(f.dir, 'manifest.json'), metadata = JSON.parse(f.files.get(file)); metadata.version = 1;
  f.files.set(file, Buffer.from(JSON.stringify(metadata))); f.api.prepareWindowsJob(); assert.equal(f.calls.length, 2);
});
test('compiler failure is fatal; no installer, runtime preparation or fallback compiler', () => {
  const f = fixture(); f.fail(); assert.throws(() => f.api.prepareWindowsJob(), /compilation failed/); assert.equal(f.calls.length, 1);
});
test('POSIX product preparation performs no compiler launch', () => {
  const f = fixture(); f.proc.platform = 'linux'; assert.equal(f.api.prepareWindowsJob(), undefined); assert.equal(f.calls.length, 0);
});
test('missing installed compiler fails closed instead of PATH lookup', () => {
  const f = fixture(); for (const key of [...f.files.keys()]) if (key.endsWith('csc.exe')) f.files.delete(key);
  assert.throws(() => f.api.prepareWindowsJob(), /unavailable/); assert.equal(f.calls.length, 0);
});

// Exercise the real bundled resolver with a virtual product tree; no C# or OS
// process is launched by these Node controls.
function builtAsset(directory, identity, redirect = false) {
  const ts = require('typescript');
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/main/workspace-windows-job-asset.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const bytes = Buffer.alloc(512); bytes.write('MZ');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const stat = { dev: 1, ino: 2, size: bytes.length, isFile: () => true, isSymbolicLink: () => false };
  const opened = [], module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, __dirname: directory, Buffer, Error,
    ...(identity === undefined ? {} : { HOMEBOT_WINDOWS_JOB_ASSET_IDENTITY: identity === 'valid' ? 'HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:' + digest : identity }),
    require: name => name === 'fs' ? { lstatSync: () => stat, realpathSync: { native: file => redirect ? file + '.redirected' : file }, openSync: file => { opened.push(file); return 7; }, fstatSync: () => stat, readSync: (_fd, target, offset, length, position) => bytes.copy(target, offset, position, position + length), closeSync: () => {} } : require(name) });
  return { resolve: module.exports.verifiedWorkspaceWindowsJobAsset, opened, digest };
}
test('built bundle resolves only the pinned output DLL without source or manifest fallback', () => {
  const dir = path.resolve('fixed-product/out/main'), f = builtAsset(dir, 'valid');
  assert.equal(f.resolve().assembly, path.join(dir, 'assets', 'OwnedWindowsJob.dll'));
  assert.equal(f.opened.length, 1);
});
test('packaged resolution uses the physical app.asar.unpacked DLL', () => {
  const dir = path.resolve('fixed-product/resources/app.asar/out/main'), f = builtAsset(dir, 'valid');
  assert.equal(f.resolve().assembly, path.resolve('fixed-product/resources/app.asar.unpacked/out/main/assets/OwnedWindowsJob.dll'));
});
test('bad bundled identity, tampered SHA and missing build define are refused', () => {
  const dir = path.resolve('fixed-product/out/main');
  for (const identity of [undefined, '', 'not-owned:' + 'a'.repeat(64), 'HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:' + 'a'.repeat(64)]) assert.throws(() => builtAsset(dir, identity).resolve());
});
test('a bundled ancestor redirect does not change the selected product asset', () => {
  assert.throws(() => builtAsset(path.resolve('fixed-product/out/main'), 'valid', true).resolve(), /regular/);
});

function packagingFixture() {
  const bytes = Buffer.alloc(512); bytes.write('MZ');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const root = path.resolve('prepared-widget'), main = path.join(root, 'out/main/index.js'), dll = path.join(root, 'out/main/assets/OwnedWindowsJob.dll');
  const files = new Map([[main, Buffer.from('const identity="HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:' + sha + '";')], [dll, bytes]]);
  let held; const stats = () => ({ dev: 1, ino: 2, size: files.get(held)?.length, isFile: () => true, isSymbolicLink: () => false });
  const fakeFs = { lstatSync: file => { held = file; if (!files.has(file)) throw Error('missing'); return stats(); }, realpathSync: { native: file => file }, openSync: file => { held = file; return 1; }, fstatSync: stats, readSync: (_fd, target, offset, length, position) => files.get(held).copy(target, offset, position, position + length), closeSync: () => {} };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../verify-windows-job-package.cjs'), 'utf8'), { module, Buffer, require: name => name === 'node:fs' ? fakeFs : require(name) });
  return { check: platform => module.exports({ electronPlatformName: platform, packager: { info: { appDir: root } } }), files, main, dll };
}
test('actual package hook accepts the exact pinned asset and leaves POSIX packaging unchanged', () => {
  const f = packagingFixture(); f.check('win32'); f.files.clear(); f.check('linux'); f.check('darwin');
});
test('actual package hook rejects missing, changed, mismatched or duplicate managed inputs', () => {
  for (const change of ['missing', 'changed', 'marker', 'duplicate']) {
    const f = packagingFixture();
    if (change === 'missing') f.files.delete(f.dll);
    if (change === 'changed') f.files.get(f.dll)[511] = 1;
    if (change === 'marker') f.files.set(f.main, Buffer.from('HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:' + 'a'.repeat(64)));
    if (change === 'duplicate') f.files.set(f.main, Buffer.concat([f.files.get(f.main), f.files.get(f.main)]));
    assert.throws(() => f.check('win32'));
  }
});

test('actual Vite watch registers immutable inputs and rejects changed C# or preparation before stale emission', () => {
  const ts = require('typescript'), file = path.resolve(__dirname, '../../electron.vite.config.ts');
  const source = Buffer.from('immutable managed source'), preparation = Buffer.from('immutable preparation'), bytes = Buffer.alloc(512); bytes.write('MZ');
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  const app = path.resolve(__dirname, '../..'), managed = path.join(app, 'native/OwnedWindowsJob.cs'), prepareFile = path.join(app, 'scripts/prepare-windows-job.cjs');
  const files = new Map([[managed, source], [prepareFile, preparation], [path.join(app, 'native/generated/OwnedWindowsJob.dll'), bytes]]);
  const metadata = { assembly: path.join(app, 'native/generated/OwnedWindowsJob.dll'), sourceSha256: sha(source), preparationSha256: sha(preparation), assemblySha256: sha(bytes) };
  const module = { exports: {} }, watched = [], emitted = [];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, __dirname: app, process: { env: {} },
    require: name => name === 'electron-vite' ? { defineConfig: value => value, externalizeDepsPlugin: () => ({}) } : name === '@vitejs/plugin-react' ? { default: () => ({}) } : name === 'node:module' ? { createRequire: () => () => ({ prepareWindowsJob: () => metadata }) } : name === 'node:fs' ? { readFileSync: name => files.get(name) } : require(name) });
  const config = module.exports.default(), plugin = config.main.plugins[1], context = { addWatchFile: file => watched.push(file), emitFile: value => emitted.push(value) };
  plugin.buildStart.call(context);
  assert.equal(JSON.stringify(watched), JSON.stringify([managed, prepareFile])); assert.equal(emitted.length, 1);
  assert.equal(JSON.parse(config.main.define.HOMEBOT_WINDOWS_JOB_ASSET_IDENTITY), 'HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:' + metadata.assemblySha256);
  for (const changed of [managed, prepareFile]) {
    const old = files.get(changed); files.set(changed, Buffer.from('changed while dev is running'));
    assert.throws(() => plugin.buildStart.call(context), /Restart electron-vite dev/);
    assert.equal(emitted.length, 1); files.set(changed, old);
  }
});
