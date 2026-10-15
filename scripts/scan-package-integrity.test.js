'use strict';

// Tiny real ASAR/CLI fixtures. No Electron launch, installer, download or native rebuild.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { finished } = require('node:stream/promises');

const project = path.resolve(__dirname, '..');
const widgetRequire = createRequire(path.join(project, 'widget', 'package.json'));
const asarModule = process.env.HOMEBOT_SCANNER_ASAR_MODULE || widgetRequire.resolve('@electron/asar');
const asar = require(asarModule);
const { Pickle } = require(path.join(path.dirname(asarModule), 'pickle.js'));
const asarCLI = path.resolve(path.dirname(asarModule), '../bin/asar.js');
const dependencyRoot = path.resolve(path.dirname(asarModule), '../../..');
const scanner = path.join(project, 'scripts', 'scan-package-integrity.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-asar-scan-'));
  const scripts = path.join(root, 'scripts');
  const widget = path.join(root, 'widget');
  const dist = path.join(widget, 'dist-electron');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(dist, { recursive: true });
  const script = path.join(scripts, 'scan-package-integrity.js');
  fs.copyFileSync(scanner, script);
  const dependencies = path.join(widget, 'node_modules');
  fs.symlinkSync(dependencyRoot, dependencies, process.platform === 'win32' ? 'junction' : 'dir');
  const ownedLinks = [dependencies];
  // The hostile-size control must never allocate gigabytes, including in the old CLI.
  const allocationGuard = path.join(root, 'bounded-allocation.cjs');
  fs.writeFileSync(allocationGuard, `const original=Buffer.alloc;
Buffer.alloc=(size,...args)=>{if(size>16*1024*1024)throw new Error('FORBIDDEN_HEAP_ALLOCATION');return original(size,...args);};\n`);
  // The original CLI spells `npx asar extract`. Redirect ONLY that literal command
  // to the installed official CLI with an argument array: no npm/network or fake ASAR.
  const adapter = path.join(root, 'local-asar-cli.cjs');
  fs.writeFileSync(adapter, `require(${JSON.stringify(allocationGuard)}); const cp=require('node:child_process');
cp.execSync=function(command, options){const m=/^npx asar extract "([^"]+)" "([^"]+)"$/.exec(command);
if(!m) throw new Error('Unexpected scanner subprocess: '+command);
return cp.execFileSync(process.execPath,['--require',${JSON.stringify(allocationGuard)},${JSON.stringify(asarCLI)},'extract',m[1],m[2]],options);};\n`);
  const guard = path.join(root, 'read-only-scanner.cjs');
  fs.writeFileSync(guard, `const fs=require('node:fs');
for(const name of ['mkdirSync','rmSync','writeFileSync','appendFileSync','copyFileSync','unlinkSync','symlinkSync'])
fs[name]=()=>{throw new Error('Scanner must not materialize or mutate files: '+name);};
const open=fs.openSync;fs.openSync=(file,flags,...args)=>{if(flags!=='r')throw new Error('Scanner must open read-only');return open(file,flags,...args);};\n`);
  t.after(() => {
    const resolved = path.resolve(root);
    const temporaryRoot = path.resolve(os.tmpdir());
    assert.equal(fs.realpathSync(root), resolved);
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    assert(resolved.startsWith(temporaryRoot + path.sep) && path.dirname(resolved) === temporaryRoot);
    assert(path.basename(resolved).startsWith('homebot-asar-scan-'));
    // One registry owns every junction: unlink all of them before recursive cleanup.
    for (const link of ownedLinks) {
      assert(path.resolve(link).startsWith(resolved + path.sep));
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
      fs.unlinkSync(link);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, dist, script, widget, adapter, guard, ownedLinks,
    archive: path.join(dist, 'win-unpacked', 'resources', 'app.asar') };
}

async function archive(f, files = { 'package.json': '{}', 'out/main/index.js': 'module.exports = 1;' }, options = {}, destination = f.archive) {
  const source = fs.mkdtempSync(path.join(f.root, 'source-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const output = await asar.createPackageWithOptions(source, destination, options);
  await finished(output);
  asar.uncache(destination);
  return destination;
}

function run(f, { readOnly = false, importOnly = false } = {}) {
  const args = ['--require', f.adapter];
  if (readOnly) args.push('--require', f.guard);
  if (importOnly) args.push('-e', `const s=require(${JSON.stringify(f.script)}); if(typeof s.scanPackage!=='function'||typeof s.findApplicationArchive!=='function')throw new Error('Missing scanner exports'); console.log('IMPORT_OK');`);
  else args.push(f.script);
  return cp.spawnSync(process.execPath, args, {
    cwd: f.widget, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, npm_config_offline: 'true', npm_config_yes: 'false' },
  });
}

function passes(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Package integrity check passed/);
}
function rejects(result, reason) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0, 'Invalid package was accepted: ' + result.stdout);
  assert.match(result.stdout + result.stderr, reason);
}

// Use the official writer/parser for corrupt-fixture construction, not a new ASAR parser.
function changeHeader(file, change) {
  const raw = asar.getRawHeader(file);
  const payload = fs.readFileSync(file).subarray(8 + raw.headerSize);
  change(raw.header);
  const header = Pickle.createEmpty();
  header.writeString(JSON.stringify(raw.header));
  const headerBytes = header.toBuffer();
  const size = Pickle.createEmpty(); size.writeUInt32(headerBytes.length);
  fs.writeFileSync(file, Buffer.concat([size.toBuffer(), headerBytes, payload]));
  asar.uncache(file);
}

test('permits a real clean archive with nested directories and an empty file', async t => {
  const f = fixture(t); await archive(f, { 'package.json': '{}', 'out/main/index.js': 'ok', 'out/empty.txt': '' });
  passes(run(f));
});
test('scans the application archive without extraction or filesystem writes', async t => {
  const f = fixture(t); await archive(f); passes(run(f, { readOnly: true }));
  assert.equal(fs.existsSync(path.join(f.dist, 'asar-extract')), false);
});
test('import exposes scanner functions without invoking the CLI or filesystem writes', async t => {
  const f = fixture(t); await archive(f);
  const result = run(f, { importOnly: true, readOnly: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), 'IMPORT_OK');
});
test('default_app.asar alone cannot stand in for the missing application archive', async t => {
  const f = fixture(t); await archive(f, undefined, {}, path.join(f.dist, 'win-unpacked', 'resources', 'default_app.asar'));
  rejects(run(f), /app\.asar|application archive/i);
});
test('a permitted default_app.asar does not distract from the real application archive', async t => {
  const f = fixture(t); await archive(f);
  await archive(f, { 'default.js': 'ok' }, {}, path.join(path.dirname(f.archive), 'default_app.asar'));
  passes(run(f));
});
test('multiple resources/app.asar candidates fail instead of choosing the first', async t => {
  const f = fixture(t); await archive(f);
  await archive(f, undefined, {}, path.join(f.dist, 'other-unpacked', 'resources', 'app.asar'));
  rejects(run(f), /ambiguous|multiple/i);
});
test('an app.asar outside resources cannot satisfy the application identity', async t => {
  const f = fixture(t); await archive(f, undefined, {}, path.join(f.dist, 'app.asar'));
  rejects(run(f), /app\.asar|application archive/i);
});
for (const forbidden of ['__tests__', 'mocks', '.test.tsx', '.spec.ts', '.e2e.spec.ts']) {
  test(`rejects existing forbidden filename fragment ${forbidden}`, async t => {
    const f = fixture(t); await archive(f, { [`out/file${forbidden}.txt`]: 'forbidden' });
    rejects(run(f), /Forbidden/i);
  });
}
test('rejects a forbidden directory at nested depth even with permitted filenames', async t => {
  const f = fixture(t); await archive(f, { 'out/vendor/mocks/nested/file.js': 'forbidden' });
  rejects(run(f), /Forbidden/i);
});
test('does not widen existing case-sensitive forbidden-name semantics', async t => {
  const f = fixture(t); await archive(f, { 'out/MOCKS/allowed.js': 'ok', 'out/file.TEST.TSX.txt': 'ok' });
  passes(run(f));
});
test('rejects a truncated packed payload instead of accepting zero-filled extraction', async t => {
  const f = fixture(t); await archive(f, { 'payload.txt': 'real payload' });
  fs.truncateSync(f.archive, fs.statSync(f.archive).size - 1);
  rejects(run(f), /truncated|payload|extent|read/i);
});
test('rejects an out-of-range packed offset', async t => {
  const f = fixture(t); await archive(f, { 'payload.txt': 'real payload' });
  changeHeader(f.archive, header => { header.files['payload.txt'].offset = '99999999'; });
  rejects(run(f), /offset|extent|payload|archive/i);
});
test('rejects malformed header JSON with a bounded error', async t => {
  const f = fixture(t); await archive(f);
  const raw = asar.getRawHeader(f.archive);
  const data = fs.readFileSync(f.archive);
  const offset = data.indexOf(Buffer.from(raw.headerString)); assert(offset >= 8);
  data[offset] = 0x21; fs.writeFileSync(f.archive, data); asar.uncache(f.archive);
  rejects(run(f), /header|JSON|Unexpected|extract/i);
});
test('rejects an excessive header size before allocating or extracting it', async t => {
  const f = fixture(t); await archive(f);
  const fd = fs.openSync(f.archive, 'r+'); const size = Buffer.alloc(4); size.writeUInt32LE(0x7fffffff);
  try { fs.writeSync(fd, size, 0, 4, 4); } finally { fs.closeSync(fd); }
  const result = run(f);
  rejects(result, /header|limit|size|extract/i);
  assert.doesNotMatch(result.stdout + result.stderr, /FORBIDDEN_HEAP_ALLOCATION/);
});
test('rejects an archive entry that escapes its path', async t => {
  const f = fixture(t); await archive(f, { 'safe.js': 'ok' });
  changeHeader(f.archive, header => { header.files['../escaped.js'] = header.files['safe.js']; delete header.files['safe.js']; });
  rejects(run(f), /escape|entry|path|extract/i);
});
test('rejects ambiguous case-colliding entry names for a Windows release', async t => {
  const f = fixture(t); await archive(f, { 'safe.js': 'ok' });
  changeHeader(f.archive, header => { header.files['SAFE.js'] = { ...header.files['safe.js'] }; });
  rejects(run(f), /collision|ambiguous|duplicate|overlap/i);
});
test('permits a safe in-archive file link and verifies its target', async t => {
  const f = fixture(t);
  const output = await asar.createPackageFromStreams(f.archive, [
    { type: 'file', path: 'target.js', unpacked: false, stat: { size: 2, mode: 0o644 }, streamGenerator: () => Readable.from([Buffer.from('ok')]) },
    { type: 'link', path: 'alias.js', symlink: 'target.js', unpacked: false, stat: { size: 0, mode: 0o644 }, streamGenerator: () => Readable.from([]) },
  ]);
  await finished(output);
  passes(run(f));
});
test('rejects a dangling archive link', async t => {
  const f = fixture(t); await archive(f);
  changeHeader(f.archive, header => { header.files['alias.js'] = { link: 'missing.js' }; });
  rejects(run(f), /link|target|extract|file/i);
});
test('rejects a link that escapes the archive', async t => {
  const f = fixture(t); await archive(f);
  changeHeader(f.archive, header => { header.files['alias.js'] = { link: '../outside.js' }; });
  rejects(run(f), /link|escape|target|extract/i);
});
test('rejects a link cycle without hanging', async t => {
  const f = fixture(t); await archive(f);
  changeHeader(f.archive, header => { header.files['a'] = { link: 'b' }; header.files['b'] = { link: 'a' }; });
  rejects(run(f), /cycle|link|stack|extract/i);
});
test('permits real unpacked files at the exact archive sidecar root', async t => {
  const f = fixture(t); await archive(f, { 'native/native.node': 'tiny native fixture', 'index.js': 'ok' }, { unpack: '*.node' });
  passes(run(f, { readOnly: true }));
});
test('rejects a missing unpacked leaf', async t => {
  const f = fixture(t); await archive(f, { 'native/native.node': 'tiny native fixture' }, { unpack: '*.node' });
  fs.unlinkSync(path.join(f.archive + '.unpacked', 'native', 'native.node'));
  rejects(run(f), /unpacked|missing|ENOENT|extract/i);
});
test('rejects an unpacked size mismatch', async t => {
  const f = fixture(t); await archive(f, { 'native/native.node': 'tiny native fixture' }, { unpack: '*.node' });
  fs.writeFileSync(path.join(f.archive + '.unpacked', 'native', 'native.node'), 'short');
  rejects(run(f), /unpacked|size|payload/i);
});
test('rejects an unpacked ancestor redirected by a junction or symlink', async t => {
  const f = fixture(t); await archive(f, { 'native/native.node': 'tiny native fixture' }, { unpack: '*.node' });
  const native = path.join(f.archive + '.unpacked', 'native');
  const outside = path.join(f.root, 'redirected-native'); fs.renameSync(native, outside);
  fs.symlinkSync(outside, native, process.platform === 'win32' ? 'junction' : 'dir');
  f.ownedLinks.push(native);
  rejects(run(f), /unpacked|link|redirect|reparse|ancestor/i);
});
test('rejects impossible negative file sizes', async t => {
  const f = fixture(t); await archive(f, { 'payload.txt': 'real payload' });
  changeHeader(f.archive, header => { header.files['payload.txt'].size = -1; });
  rejects(run(f), /size|header|payload|extract/i);
});

test('rejects packed bytes that disagree with official declared integrity', async t => {
  const f = fixture(t); await archive(f, { 'payload.txt': 'real payload' });
  const raw = asar.getRawHeader(f.archive);
  assert.equal(raw.header.files['payload.txt'].integrity.algorithm, 'SHA256');
  const fd = fs.openSync(f.archive, 'r+');
  try { fs.writeSync(fd, Buffer.from('X'), 0, 1, 8 + raw.headerSize); } finally { fs.closeSync(fd); }
  rejects(run(f), /integrity|hash|checksum/i);
});
test('rejects unpacked bytes that disagree with official declared integrity', async t => {
  const f = fixture(t); await archive(f, { 'native/native.node': 'tiny native fixture' }, { unpack: '*.node' });
  const native = path.join(f.archive + '.unpacked', 'native', 'native.node');
  const bytes = fs.readFileSync(native); bytes[0] ^= 1; fs.writeFileSync(native, bytes);
  rejects(run(f), /integrity|hash|checksum/i);
});

test('permits an official safe directory alias with a real packed target', async t => {
  const f = fixture(t);
  const output = await asar.createPackageFromStreams(f.archive, [
    { type: 'file', path: 'd/target.js', unpacked: false, stat: { size: 2, mode: 0o644 }, streamGenerator: () => Readable.from([Buffer.from('ok')]) },
    { type: 'link', path: 'alias', symlink: 'd', unpacked: false, stat: { size: 0, mode: 0o644 }, streamGenerator: () => Readable.from([]) },
  ]);
  await finished(output);
  passes(run(f, { readOnly: true }));
});
test('rejects a directory alias back to its own ancestor', async t => {
  const f = fixture(t); await archive(f, { 'd/target.js': 'ok' });
  changeHeader(f.archive, header => { header.files.d.files.alias = { link: 'd' }; });
  rejects(run(f), /directory.*cycle|link.*cycle/i);
});
test('rejects a cycle through sibling directory aliases', async t => {
  const f = fixture(t); await archive(f, { 'a/target.js': 'a', 'b/target.js': 'b' });
  changeHeader(f.archive, header => {
    header.files.a.files.other = { link: 'b' };
    header.files.b.files.other = { link: 'a' };
  });
  rejects(run(f), /directory.*cycle|link.*cycle/i);
});
