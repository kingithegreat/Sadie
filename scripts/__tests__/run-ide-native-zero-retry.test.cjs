'use strict';
// Synthetic contract controls only; these never claim native process evidence.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const gate = require('../run-ide-native-zero-retry.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
function report() {
  return { stats: { expected: 4, unexpected: 0, skipped: 0, flaky: 0 }, config: { version: '1.57.0', workers: 1, forbidOnly: true, projects: [{ retries: 0, repeatEach: 1 }] }, suites: [{ specs: gate.EXPECTED_CASES.map(row => ({ ...row, ok: true, tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }] })) }] };
}
function receipts() {
  return gate.EXPECTED_CASES.map((_, i) => {
    const pid = 42001 + i * 10, parent = 41001 + i, creation = String(639000000000000000n + BigInt(i));
    return { file: 'synthetic-' + i + '.json', receipt: { native: { pid, ppid: parent, execPath: 'synthetic-electron.exe', creation }, launcherPid: parent, nativeExit: { code: 0, creation }, graceful: true, verificationScope: 'captured-owned-tree', ownedTree: [{ pid, parent, creation }, { pid: pid + 1, parent: pid, creation: String(BigInt(creation) + 1n) }], capturedIdentitiesGone: true, identityObservations: [{ at: 1, gone: true, live: [] }], elapsed: 1000 } };
  });
}
const privateRoot = path.resolve('synthetic-native-contract');
const main = path.join(privateRoot, 'app/widget/out/main/index.js');
function paths() {
  return receipts().map(({ receipt }, i) => {
    const home = path.join(privateRoot, 'h', 'fixture-' + i), profile = path.join(privateRoot, 'h/tmp/profile-' + i);
    const env = { ...gate.privateEnvironment({}, home), HOMEBOT_E2E_USER_DATA_DIR: profile };
    const actual = { home, appData: env.APPDATA, userData: profile, sessionData: path.join(profile, 'Chromium'), temp: env.TEMP, desktop: path.join(home, 'Desktop'), documents: path.join(home, 'Documents'), downloads: path.join(home, 'Downloads'), music: path.join(home, 'Music'), pictures: path.join(home, 'Pictures'), videos: path.join(home, 'Videos'), logs: path.join(profile, 'logs'), crashDumps: path.join(profile, 'CrashDumps') };
    return { pid: receipt.native.pid, main, ragRoot: privateRoot, mode: 'existing-E2E-fixtures; isolation-only-bootstrap', env, paths: actual, expectedPaths: clone(actual), osHome: home, osTemp: env.TEMP };
  });
}
test('four exact first attempts pass; retries, flakiness, missing/extra cases and skips fail', () => {
  assert.equal(gate.validateResults(report()).length, 4);
  const mutations = [r => { r.stats.expected = 0; }, r => { r.stats.flaky = 1; }, r => { r.stats.skipped = 1; }, r => { r.suites[0].specs.push(clone(r.suites[0].specs[0])); }, r => { r.suites[0].specs[0].title = 'different test'; }, r => { r.config.projects[0].retries = 1; }, r => { r.suites[0].specs[0].tests[0].results[0].retry = 1; }, r => { r.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }); }, r => { r.suites[0].specs[0].tests[0].expectedStatus = 'failed'; }];
  for (const mutate of mutations) { const value = report(); mutate(value); assert.throws(() => gate.validateResults(value)); }
});

test('independent terminal mode requires its exact first attempt and held receipt, while default still requires four', () => {
  const selected = report();
  selected.stats.expected = 1;
  const spec = selected.suites[0].specs[0];
  spec.file = gate.TERMINAL_TREE_CASES[0].file;
  spec.title = gate.TERMINAL_TREE_CASES[0].title;
  selected.suites[0].specs = [spec];
  assert.equal(gate.validateResults(selected, gate.TERMINAL_TREE_CASES).length, 1);
  assert.throws(() => gate.validateResults(selected));
  const held = receipts().slice(0, 1), stores = paths().slice(0, 1);
  const receipt = gate.validateShutdownReceipts(held, 1);
  assert.equal(gate.validatePathReceipts(stores, receipt, privateRoot, main, 1).length, 1);
  assert.throws(() => gate.validateShutdownReceipts(held));
  assert.throws(() => gate.validatePathReceipts(stores, receipt, privateRoot, main));
  selected.suites[0].specs[0].tests[0].results[0].retry = 1;
  assert.throws(() => gate.validateResults(selected, gate.TERMINAL_TREE_CASES));
  held[0].receipt.forcedOwnedCleanup = true;
  assert.throws(() => gate.validateShutdownReceipts(held, 1));
});
test('four held-main receipts pass; force cleanup, OS failure, unknown/live identities and absent tree fail', () => {
  const positive = gate.validateShutdownReceipts(receipts()); assert.equal(positive.length, 4); assert.equal(positive[0].rawSignalPresent, false); assert.equal(positive[0].normalizedSignal, null);
  const mutations = [r => { r.length = 0; }, r => { r.pop(); }, r => { r[0].receipt.graceful = false; }, r => { r[0].receipt.forcedOwnedCleanup = false; }, r => { r[0].receipt.nativeExit.code = 1; }, r => { r[0].receipt.nativeExit.signal = 'SIGTERM'; }, r => { r[0].receipt.nativeExit.creation = 'different'; }, r => { r[0].receipt.ownedTree = []; }, r => { r[0].receipt.ownedTree[1].parent = 99; }, r => { r[0].receipt.capturedIdentitiesGone = false; }, r => { r[0].receipt.identityObservations = []; }, r => { r[0].receipt.identityObservations = [{ at: 1, gone: false, live: [{ pid: r[0].receipt.native.pid, creation: r[0].receipt.native.creation }] }]; }, r => { r[0].receipt.elapsed = 20000; }];
  for (const mutate of mutations) { const value = receipts(); mutate(value); assert.throws(() => gate.validateShutdownReceipts(value)); }
  const qualified = receipts(); qualified[0].receipt.inspectorQualification = { mainPid: qualified[0].receipt.native.pid, matchingExitNonce: true }; qualified[0].receipt.productionAtExit = { pid: qualified[0].receipt.native.pid, nonce: 'synthetic-exit-nonce' };
  assert.equal(gate.validateShutdownReceipts(qualified).length, 4); qualified[0].receipt.productionAtExit.pid += 1; assert.throws(() => gate.validateShutdownReceipts(qualified));
});
test('all actual private stores must match the four held PIDs; zero/path escape/path substitution fails', () => {
  const held = gate.validateShutdownReceipts(receipts()); assert.equal(gate.validatePathReceipts(paths(), held, privateRoot, main).length, 4);
  for (const mutate of [p => { p.length = 0; }, p => { p[0].pid = 1; }, p => { p[0].paths.desktop = path.resolve('outside'); }, p => { p[0].paths.downloads = p[0].paths.documents; }, p => { p[0].env.HOME = path.resolve('outside'); }, p => { p[0].ragRoot = path.resolve('outside'); }, p => { p[0].paths.sessionData = p[0].paths.userData; }]) { const value = paths(); mutate(value); assert.throws(() => gate.validatePathReceipts(value, held, privateRoot, main)); }
});
test('process null status, timeout/error and non-null signal fail even beside passing reports', () => {
  gate.validateSpawn({ status: 0, signal: null });
  for (const value of [{ status: null, signal: null }, { status: 0, signal: 'SIGTERM' }, { status: 1, signal: null }, { status: 0, signal: null, error: new Error('timeout') }]) assert.throws(() => gate.validateSpawn(value));
});
test('private child environment removes inherited modes/credentials while retaining system executables', () => {
  const env = gate.privateEnvironment({ PATH: 'system-path', SystemRoot: 'system-root', HOME: 'owner', APPDATA: 'owner', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require owner-module', OPENAI_API_KEY: 'fixture-only', GITHUB_TOKEN: 'fixture-only', HOMEBOT_E2E_LIVE: '1' }, path.join(privateRoot, 'h'));
  assert.equal(env.PATH, 'system-path'); assert.equal(env.SystemRoot, 'system-root'); assert.equal(env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.HOMEBOT_E2E_LIVE, undefined); assert.equal(env.HOMEBOT_E2E, '1'); assert.ok(env.TEMP.startsWith(env.HOME));
});
test('complete tree inventory catches byte changes and refuses a linked subtree', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-native-contract-'));
  try {
    const tree = path.join(temp, 'tree'); fs.mkdirSync(tree); fs.writeFileSync(path.join(tree, 'binding.node'), 'synthetic-native-bytes');
    const first = gate.hashTree(tree); assert.equal(first.length, 1); fs.writeFileSync(path.join(tree, 'binding.node'), 'different-native-bytes'); assert.notDeepEqual(gate.hashTree(tree), first);
    const target = path.join(temp, 'owned-target'); fs.mkdirSync(target); fs.symlinkSync(target, path.join(tree, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => gate.hashTree(tree), /link|junction/);
  } finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()), 'Only this freshly allocated temp child may be removed.'); fs.rmSync(temp, { recursive: true, force: true }); }
});
test('generated bootstrap parses and contains path isolation without settings/consent/provider writes', () => {
  const source = gate.isolationEntry(privateRoot, path.dirname(path.dirname(path.dirname(main))), main);
  new vm.Script(source); assert.ok(source.includes("app.setPath(key,value)")); assert.ok(source.includes('require(main)'));
  assert.ok(!source.includes('user-settings.json') && !source.includes('showMessageBox') && !source.includes('sendStreamMessage') && !source.includes('ipcMain'));
});
