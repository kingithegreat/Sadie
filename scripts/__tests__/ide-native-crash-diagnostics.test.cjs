'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const diagnostics = require('../ide-native-crash-diagnostics.cjs');
const sourceFile = path.resolve(__dirname, '../ide-native-crash-diagnostics.cjs');
const started = '2026-10-07T01:11:00.000Z', finished = '2026-10-07T01:12:00.000Z';
const birth = '639269322000000000';
const identity = { pid: 8484, ppid: 5512, execPath: "C:\\fixture with spaces\\Aden's Electron\\electron.exe", creation: birth };

function dump() {
  const bytes = Buffer.alloc(600);
  bytes.write('MDMP'); bytes.writeUInt32LE(42899, 4); bytes.writeUInt32LE(3, 8); bytes.writeUInt32LE(32, 12);
  for (const [index, type, size, rva] of [[0, 6, 168, 80], [1, 4, 112, 256], [2, 15, 24, 480]]) { const o = 32 + index * 12; bytes.writeUInt32LE(type, o); bytes.writeUInt32LE(size, o + 4); bytes.writeUInt32LE(rva, o + 8); }
  bytes.writeUInt32LE(99, 80); bytes.writeUInt32LE(0xc0000005, 88); bytes.writeBigUInt64LE(0x100000123n, 104);
  bytes.writeUInt32LE(1, 256); bytes.writeBigUInt64LE(0x100000000n, 260); bytes.writeUInt32LE(0x1000, 268); bytes.writeUInt32LE(380, 280);
  const name = Buffer.from('C:\\private\\module.node', 'utf16le'); bytes.writeUInt32LE(name.length, 380); name.copy(bytes, 384);
  bytes.writeUInt32LE(24, 480); bytes.writeUInt32LE(3, 484); bytes.writeUInt32LE(identity.pid, 488); bytes.writeUInt32LE(Number((BigInt(birth) - 621355968000000000n) / 10000000n), 492);
  return bytes;
}
function event(changes = {}) {
  return { eventId: 1000, recordId: '42', time: '2026-10-07T01:11:45.000Z', pid: identity.pid, creation: birth, execPath: identity.execPath, exceptionCode: 'c0000005', faultingOffset: '0000000000000123', moduleName: 'C:\\private\\module.node', xml: '<Event><EventID>1000</EventID></Event>', ...changes };
}
function fixture() {
  // Keep the tiny synthetic fixture as evidence; never delete/move shared or
  // user files. Local controls set TEMP/TMP to their explicitly owned proof root.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbn-diag-')), output = path.join(root, 'proof'), receipts = path.join(root, 'app/widget/test-results'), profile = path.join(root, 'profile'), crashes = path.join(profile, 'CrashDumps');
  for (const directory of [output, receipts, crashes]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(receipts, 'electron-shutdown-test.json'), JSON.stringify({ native: identity, nativeExit: { code: -1073741819, creation: birth }, graceful: false }));
  fs.writeFileSync(path.join(receipts, 'ide-native-paths-8484.json'), JSON.stringify({ pid: identity.pid, main: path.join(root, 'app/widget/out/main/index.js'), ragRoot: root, mode: 'existing-E2E-fixtures; isolation-only-bootstrap', paths: { userData: profile, crashDumps: crashes }, expectedPaths: { crashDumps: crashes } }));
  return { root, output, receipts, crashes, options: { privateRoot: root, output, started, finished, shutdownDirectory: receipts, env: {} } };
}
function isolatedCollector(response, platform = 'win32', filesystem = fs) {
  let calls = 0; const holder = { exports: {} };
  vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), { module: holder, exports: holder.exports, Buffer, process: { platform, env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' } }, require(name) {
    if (name === 'node:fs') return filesystem;
    if (name === 'node:child_process') return { execFile(exe, args, options, callback) { calls++; assert.equal(exe, 'powershell.exe'); assert.equal(options.timeout, 4000); assert.equal(options.windowsHide, true); if (response instanceof Error) callback(response); else callback(null, JSON.stringify(response)); } };
    return require(name);
  } }, { filename: sourceFile });
  return { api: holder.exports, calls: () => calls };
}

test('synthetic dump reports known exception/module/offset and only a weaker process candidate', () => {
  const summary = diagnostics.summarizeMinidump(dump());
  assert.deepEqual(summary, { threadId: 99, exceptionCode: '0xc0000005', exceptionAddress: '0x0000000100000123', faultModule: { name: 'module.node', base: '0x100000000', offset: '0x123' }, processId: identity.pid, processCreateTime: Number((BigInt(birth) - 621355968000000000n) / 10000000n) });
  assert.equal(diagnostics.associateDump(summary, identity).status, 'candidate');
  assert.match(diagnostics.associateDump(summary, identity).precision, /not native exit\/kill authority/);
  assert.equal(diagnostics.associateDump({ ...summary, processId: 1 }, identity).status, 'unqualified');
  assert.equal(diagnostics.associateDump({ ...summary, processCreateTime: summary.processCreateTime + 1 }, identity).status, 'unqualified');
  assert.equal(diagnostics.associateDump({}, identity).status, 'unqualified');
});
test('exception address outside loaded modules is unresolved rather than an invented fault module', () => {
  const bytes = dump(); bytes.writeBigUInt64LE(0x200000000n, 104); assert.equal(diagnostics.summarizeMinidump(bytes).faultModule, null);
});
for (const [name, mutate] of [
  ['signature', b => b.write('BAD!')], ['version', b => b.writeUInt32LE(1, 4)], ['stream count', b => b.writeUInt32LE(129, 8)],
  ['directory RVA', b => b.writeUInt32LE(599, 12)], ['stream RVA', b => b.writeUInt32LE(500, 40)], ['truncated exception', b => b.writeUInt32LE(167, 36)],
  ['parameter count', b => b.writeUInt32LE(16, 112)], ['module count', b => b.writeUInt32LE(513, 256)], ['module name RVA', b => b.writeUInt32LE(599, 280)],
  ['module name length', b => b.writeUInt32LE(4098, 380)], ['odd UTF16 length', b => b.writeUInt32LE(3, 380)], ['MiscInfo size', b => b.writeUInt32LE(600, 480)],
]) test(`malformed ${name} dump fails within explicit bounds`, () => { const bytes = dump(); mutate(bytes); assert.throws(() => diagnostics.summarizeMinidump(bytes)); });
test('truncated bytes and duplicate selected streams fail closed', () => {
  assert.throws(() => diagnostics.summarizeMinidump(Buffer.alloc(31)));
  const bytes = dump(); bytes.writeUInt32LE(6, 44); assert.throws(() => diagnostics.summarizeMinidump(bytes), /Duplicate/);
});
test('only exact app PID/path/native birth events are retained; missing identity never qualifies', () => {
  assert.equal(diagnostics.qualifiedEvent(event(), [identity], started, finished).moduleName, 'module.node');
  for (const changes of [{ pid: 1 }, { execPath: 'C:\\other\\electron.exe' }, { creation: '639269322000000010' }, { creation: undefined }, { time: '2026-10-07T02:00:00Z' }, { exceptionCode: '' }, { xml: 'x'.repeat(diagnostics.LIMITS.xmlBytes + 1) }]) assert.equal(diagnostics.qualifiedEvent(event(changes), [identity], started, finished), undefined);
});
test('the generated query is read-only and requires actual Application Error process identity', () => {
  const source = diagnostics.eventQuerySource([identity], started, finished);
  assert.match(source, /Get-WinEvent/); assert.match(source, /Id=1000/); assert.match(source, /-MaxEvents 128/);
  assert.match(source, /ProcessCreationTime/); assert.match(source, /FromFileTimeUtc/); assert.match(source, /execPath -eq \$fields.AppPath/);
  assert.doesNotMatch(source, /Stop-Process|TerminateProcess|taskkill|reg add|crashReporter/);
});
test('bounded regular read preserves bytes and refuses size and redirected targets', () => {
  const f = fixture(), file = path.join(f.crashes, 'owned.dmp'), bytes = dump(); fs.writeFileSync(file, bytes);
  assert.deepEqual(diagnostics.readBounded(f.root, file, 600), bytes); assert.deepEqual(fs.readFileSync(file), bytes);
  assert.throws(() => diagnostics.readBounded(f.root, file, 599), /bound/);
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'hbn-diag-foreign-')); fs.writeFileSync(path.join(foreign, 'decoy'), 'preserve foreign bytes');
  const redirected = path.join(f.root, 'redirect'); fs.symlinkSync(foreign, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => diagnostics.readBounded(f.root, path.join(redirected, 'decoy'), 100), /redirected/); assert.equal(fs.readFileSync(path.join(foreign, 'decoy'), 'utf8'), 'preserve foreign bytes');
});
test('local guard cannot be overridden with caller environment and launches no helper', async () => {
  const f = isolatedCollector({}, 'linux'); const result = await f.api.collectWindowsCrashDiagnostics({ env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' } });
  assert.equal(result.status, 'unavailable'); assert.equal(result.helperLaunched, false); assert.equal(f.calls(), 0);
  if (process.env.GITHUB_ACTIONS !== 'true') assert.equal((await diagnostics.collectWindowsCrashDiagnostics({ env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' } })).status, 'unavailable');
});
test('mocked CI collection saves only matched XML and unchanged dump bytes with complete hashes', async () => {
  const f = fixture(), bytes = dump(); fs.writeFileSync(path.join(f.crashes, 'sample.dmp'), bytes);
  const mock = isolatedCollector({ events: [event(), event({ pid: 999, xml: '<unrelated-secret/>' })], examined: 2, unknown: 0, capped: false });
  const report = await mock.api.collectWindowsCrashDiagnostics(f.options);
  assert.equal(mock.calls(), 1); assert.equal(report.status, 'observed'); assert.equal(report.causeEstablished, false); assert.equal(report.events.length, 1); assert.equal(report.dumps.length, 1);
  assert.equal(fs.readFileSync(report.events[0].file, 'utf8'), event().xml);
  assert.equal(report.dumps[0].association.status, 'candidate'); assert.deepEqual(fs.readFileSync(report.dumps[0].file), bytes);
  assert.equal(report.dumps[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex')); assert.deepEqual(fs.readFileSync(path.join(f.crashes, 'sample.dmp')), bytes);
  assert(!JSON.stringify(report).includes('unrelated-secret'));
});
test('empty event/dump observation is explicit and is never described as crash-free', async () => {
  const f = fixture(), mock = isolatedCollector({ events: [], examined: 0, unknown: 0, capped: false });
  const report = await mock.api.collectWindowsCrashDiagnostics(f.options); assert.equal(report.status, 'not-observed'); assert.match(report.absenceMeaning, /not proof of no crash/);
});
test('query errors and invalid dump keep diagnostics distinct from the failed native result', async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.crashes, 'corrupt.dmp'), 'not a minidump');
  const mock = isolatedCollector(new Error('Event log query denied'));
  const proof = { passed: false, failure: { message: 'native OS -1073741819' }, spawn: { status: 1 } };
  await diagnostics.attachCrashDiagnostics(proof, f.options, mock.api.collectWindowsCrashDiagnostics);
  assert.equal(proof.passed, false); assert.equal(proof.failure.message, 'native OS -1073741819'); assert.equal(proof.spawn.status, 1);
  assert(proof.crashDiagnostics.errors.some(item => item.error.includes('Event log query denied')));
  assert.match(proof.crashDiagnostics.dumps[0].parseError, /bound/); assert.equal(proof.crashDiagnostics.dumps[0].association.status, 'unqualified');
});
test('collection failure cannot mask or change an original successful or failed result', async () => {
  for (const passed of [false, true]) { const original = { passed, failure: passed ? undefined : { message: 'original native error' }, spawn: { status: passed ? 0 : 1 } }; const proof = structuredClone(original);
    await diagnostics.attachCrashDiagnostics(proof, {}, async () => { throw Error('Diagnostic copy failure'); });
    const { crashDiagnostics, ...result } = proof; assert.deepEqual(result, original); assert.equal(crashDiagnostics.status, 'error'); assert.equal(crashDiagnostics.originalResultPreserved, true);
  }
});

test('selected held-file metadata reproduces the buffer decoder and authenticates bounded ranges', () => {
  const f = fixture(), file = path.join(f.crashes, 'metadata.dmp'), bytes = dump(); fs.writeFileSync(file, bytes);
  const selected = diagnostics.readMinidumpMetadata(f.root, file);
  assert.deepEqual(selected.summary, diagnostics.summarizeMinidump(bytes)); assert.equal(selected.fileBytes, 600);
  assert(selected.selectedBytes < 1024); assert.equal(selected.selectedBytes, selected.ranges.reduce((n, r) => n + r.bytes, 0));
  for (const r of selected.ranges) { const data = Buffer.from(r.data, 'base64'); assert.equal(data.length, r.bytes); assert.equal(r.sha256, crypto.createHash('sha256').update(data).digest('hex')); assert.deepEqual(data, bytes.subarray(r.offset, r.offset + r.bytes)); }
  assert.throws(() => diagnostics.readMinidumpMetadata(f.root, file, 31), /read bound/);
  assert.throws(() => diagnostics.readMinidumpMetadata(f.root, file, diagnostics.LIMITS.metadataBytes + 1), /budget/);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('oversized logical dump retains only positional metadata, no memory/context or full-file hash', async () => {
  // Keep a legal lexical alias deliberately: production opens the canonical
  // path, just as hosted Windows expands RUNNER~1 to its long directory name.
  const f = fixture(), file = f.crashes + path.sep + '.' + path.sep + 'oversized.dmp', bytes = dump();
  // An unreferenced large context lies in the logical file; never read it.
  bytes.writeUInt32LE(1024, 240); bytes.writeUInt32LE(16 * 1024 * 1024, 244); fs.writeFileSync(file, bytes);
  const canonicalFile = fs.realpathSync.native(file), ownsFile = p => fs.realpathSync.native(p) === canonicalFile;
  const logicalSize = BigInt(diagnostics.LIMITS.dumpBytes) + 1n; let selectedFd; const calls = [];
  const large = stat => ({ ...stat, size: typeof stat.size === 'bigint' ? logicalSize : Number(logicalSize), isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
  const controlledFs = { ...fs,
    lstatSync(p, options) { const stat = fs.lstatSync(p, options); return ownsFile(p) ? large(stat) : stat; },
    openSync(p, flags) { const fd = fs.openSync(p, flags); if (ownsFile(p)) selectedFd = fd; return fd; },
    fstatSync(fd, options) { const stat = fs.fstatSync(fd, options); return fd === selectedFd ? large(stat) : stat; },
    readSync(fd, buffer, offset, length, position) { if (fd === selectedFd) { calls.push({ length, position }); assert(Number.isInteger(position)); assert(length <= 1024); assert(position + length <= bytes.length); } return fs.readSync(fd, buffer, offset, length, position); },
    readFileSync(p, options) { assert.equal(ownsFile(p), false, 'No whole dump read'); return fs.readFileSync(p, options); },
  };
  const mock = isolatedCollector({ events: [], examined: 0, unknown: 0, capped: false }, 'win32', controlledFs);
  const proof = { passed: false, failure: { message: 'actual native AV' }, spawn: { status: 1 } };
  await mock.api.attachCrashDiagnostics(proof, f.options);
  assert.equal(proof.passed, false); assert.equal(proof.failure.message, 'actual native AV'); assert.equal(proof.spawn.status, 1);
  const report = proof.crashDiagnostics; assert.equal(report.status, 'observed'); assert.equal(report.dumps.length, 1);
  const d = report.dumps[0]; assert.equal(d.metadataOnly, true); assert.equal(d.rawDumpCopied, false); assert.equal(d.fullFileSha256, null); assert.equal(d.sourceFileBytes, Number(logicalSize)); assert.equal(d.association.status, 'candidate'); assert(d.file.endsWith('.metadata.json'));
  const packet = JSON.parse(fs.readFileSync(d.file, 'utf8')); assert.deepEqual(packet.summary, diagnostics.summarizeMinidump(dump())); assert.equal(packet.selectedBytes, calls.reduce((n, r) => n + r.length, 0)); assert(packet.selectedBytes < 1024);
  assert.equal(diagnostics.LIMITS.dumpBytes, 32 * 1024 * 1024); assert.equal(diagnostics.LIMITS.totalBytes, 64 * 1024 * 1024); assert.deepEqual(fs.readFileSync(file), bytes);
});

test('selected parser refuses invalid references before reading them and never follows context', () => {
  const bytes = dump(), calls = []; bytes.writeUInt32LE(0xfffffff0, 280);
  assert.throws(() => diagnostics.parseSelectedMinidump((offset, length) => { calls.push({ offset, length }); return bytes.subarray(offset, offset + length); }, bytes.length), /RVA/);
  assert(calls.every(r => r.offset < bytes.length && r.length < 1024));
  for (const length of [undefined, NaN, Infinity, 31, 32.5]) assert.throws(() => diagnostics.parseSelectedMinidump(() => { throw Error('Must not read'); }, length), /file bound/);
  const badName = dump(); badName.writeUInt16LE(0, 384); assert.throws(() => diagnostics.summarizeMinidump(badName), /module name/);
});

test('held metadata file changes refuse and always close the exact descriptor', () => {
  const f = fixture(), file = f.crashes + path.sep + '.' + path.sep + 'changed.dmp'; fs.writeFileSync(file, dump());
  const canonicalFile = fs.realpathSync.native(file), ownsFile = p => fs.realpathSync.native(p) === canonicalFile;
  for (const mode of ['size', 'mtime', 'inode', 'short-read']) {
    let fd, queries = 0, closed = false;
    const controlledFs = { ...fs,
      openSync(p, flags) { const opened = fs.openSync(p, flags); if (ownsFile(p)) fd = opened; return opened; },
      fstatSync(h, options) { const stat = fs.fstatSync(h, options); if (h !== fd || ++queries < 2) return stat; return { ...stat, isFile: () => true, ...(mode === 'size' ? { size: stat.size + 1n } : mode === 'mtime' ? { mtimeNs: stat.mtimeNs + 1n } : mode === 'inode' ? { ino: stat.ino + 1n } : {}) }; },
      readSync(h, ...args) { return h === fd && mode === 'short-read' ? 0 : fs.readSync(h, ...args); },
      closeSync(h) { if (h === fd) closed = true; return fs.closeSync(h); },
    };
    const mock = isolatedCollector({}, 'win32', controlledFs);
    assert.throws(() => mock.api.readMinidumpMetadata(f.root, file), /changed|truncated/); assert.equal(closed, true); assert.deepEqual(fs.readFileSync(file), dump());
  }
});

test('selected metadata refuses declared context and nonselected stream overlap before reading names', () => {
  for (const kind of ['context', 'nonselected-stream']) {
    const bytes = dump(), calls = [];
    if (kind === 'context') { bytes.writeUInt32LE(100, 240); bytes.writeUInt32LE(380, 244); }
    else { bytes.writeUInt32LE(4, 8); bytes.writeUInt32LE(5, 68); bytes.writeUInt32LE(100, 72); bytes.writeUInt32LE(380, 76); }
    assert.throws(() => diagnostics.parseSelectedMinidump((offset, size) => { calls.push({ offset, size }); return bytes.subarray(offset, offset + size); }, bytes.length), /overlaps excluded/);
    assert(calls.every(r => r.offset !== 380 && r.offset !== 384));
  }
});

test('selected metadata refuses forged selected-stream, name, header and directory aliases before overlapping reads', () => {
  const cases = [
    { name: 'MiscInfo inside Exception', offset: 120, mutate(bytes) {
      bytes.writeUInt32LE(120, 64); bytes.writeUInt32LE(24, 120); bytes.writeUInt32LE(3, 124);
      bytes.writeUInt32LE(identity.pid, 128); bytes.writeUInt32LE(Number((BigInt(birth) - 621355968000000000n) / 10000000n), 132);
    } },
    { name: 'MiscInfo inside module records', offset: 300, mutate(bytes) {
      bytes.writeUInt32LE(300, 64); bytes.writeUInt32LE(24, 300); bytes.writeUInt32LE(3, 304);
      bytes.writeUInt32LE(identity.pid, 308); bytes.writeUInt32LE(Number((BigInt(birth) - 621355968000000000n) / 10000000n), 312);
    } },
    { name: 'module name inside Exception', offset: 120, mutate(bytes) {
      const name = Buffer.from('C:\\private\\forged.node', 'utf16le'); bytes.writeUInt32LE(120, 280);
      bytes.writeUInt32LE(name.length, 120); name.copy(bytes, 124);
    } },
    { name: 'directory inside header', offset: 16, refusal: /directory invalid/, mutate(bytes) { bytes.writeUInt32LE(16, 12); } },
    { name: 'Exception inside directory', offset: 56, mutate(bytes) { bytes.writeUInt32LE(56, 40); } },
    { name: 'module count inside Exception', offset: 88, mutate(bytes) { bytes.writeUInt32LE(88, 52); } },
  ];
  for (const c of cases) {
    const bytes = dump(), calls = []; c.mutate(bytes);
    assert.throws(() => diagnostics.parseSelectedMinidump((offset, size) => { calls.push({ offset, size }); return bytes.subarray(offset, offset + size); }, bytes.length), c.refusal || /overlaps selected/, c.name);
    assert(!calls.some(r => r.offset === c.offset), c.name + ': overlapping read must not occur');
  }
  const normal = diagnostics.summarizeMinidump(dump()); assert.equal(normal.faultModule.name, 'module.node'); assert.equal(diagnostics.associateDump(normal, identity).status, 'candidate');
});
