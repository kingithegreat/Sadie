'use strict';
// Supplemental exact-PR-head Windows fixture gate. No production/helper edits,
// retry, normal-delivery claim, provider credentials or fabricated exit receipts.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const cp = require('node:child_process'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { createRequire } = require('node:module');
const { attachCrashDiagnostics } = require('./ide-native-crash-diagnostics.cjs');
const EXPECTED_CASES = [
  { file: 'overlay.e2e.spec.ts', title: 'the app shuts down when it is asked to' },
  { file: 'overlay.e2e.spec.ts', title: 'Workspace opens as a real overlay and closes with Escape' },
  { file: 'workspace-problems.e2e.spec.ts', title: 'package task reports a TypeScript problem and opens its exact editor line' },
  { file: 'workspace-problems.e2e.spec.ts', title: 'closing HomeBot stops an approved running watch task and its owned children' }
];
const hash = file => {
  const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, 'r');
  try { for (;;) { const count = fs.readSync(fd, buffer); if (!count) break; digest.update(buffer.subarray(0, count)); } } finally { fs.closeSync(fd); }
  return digest.digest('hex');
};
const within = (root, target) => { const relative = path.relative(path.resolve(root), path.resolve(target)); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };
function hashTree(root, prefix = '') {
  assert.ok(!fs.lstatSync(root).isSymbolicLink(), 'Hash tree must not traverse a junction: ' + root);
  const actualRoot = fs.realpathSync.native(root), result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name), stat = fs.lstatSync(full), relative = prefix + entry.name;
    assert.ok(!stat.isSymbolicLink() && within(actualRoot, fs.realpathSync.native(full)), 'Hash tree link/escape: ' + full);
    if (stat.isDirectory()) result.push(...hashTree(full, relative + '/'));
    else { assert.ok(stat.isFile(), 'Unsupported hash tree entry: ' + full); result.push({ path: relative, bytes: stat.size, sha256: hash(full) }); }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function validateResults(report) {
  assert.ok(report && report.stats && report.config, 'Missing Playwright report.');
  for (const [key, value] of Object.entries({ expected: 4, unexpected: 0, skipped: 0, flaky: 0 })) assert.equal(report.stats[key], value, 'Playwright stats.' + key);
  assert.equal(report.config.version, '1.57.0', 'Inspector transport lease requires Playwright 1.57.0.');
  assert.equal(report.config.workers, 1); assert.equal(report.config.forbidOnly, true);
  assert.equal(report.config.projects.length, 1, 'Exactly one project is permitted.');
  assert.equal(report.config.projects[0].retries, 0); assert.equal(report.config.projects[0].repeatEach, 1);
  const specs = [];
  const walk = suite => { for (const spec of suite.specs || []) specs.push(spec); for (const child of suite.suites || []) walk(child); };
  for (const suite of report.suites || []) walk(suite);
  assert.equal(specs.length, EXPECTED_CASES.length, 'Wrong actual selected case count.');
  const identities = specs.map(spec => path.basename(spec.file) + ':' + spec.title).sort();
  assert.deepEqual(identities, EXPECTED_CASES.map(row => row.file + ':' + row.title).sort(), 'Unexpected or missing selected case.');
  for (const spec of specs) {
    assert.equal(spec.ok, true); assert.equal(spec.tests.length, 1);
    const test = spec.tests[0]; assert.equal(test.expectedStatus, 'passed'); assert.equal(test.status, 'expected');
    assert.equal(test.results.length, 1, 'Retry/repeated attempt is forbidden.');
    assert.equal(test.results[0].status, 'passed'); assert.equal(test.results[0].retry, 0);
    assert.deepEqual(test.results[0].errors || [], []);
  }
  return specs.map(spec => ({ file: spec.file, title: spec.title, status: spec.tests[0].results[0].status, retry: 0 }));
}
function validateShutdownReceipts(receipts) {
  assert.equal(receipts.length, 4, 'Exactly four new actual native shutdown receipts required.');
  const seen = new Set();
  return receipts.map(({ file, receipt }) => {
    assert.equal(receipt.graceful, true, file); assert.ok(!receipt.failure, 'Graceful failure recorded: ' + file);
    assert.ok(!Object.hasOwn(receipt, 'forcedOwnedCleanup'), 'Forced native cleanup is never a passing shutdown.');
    const native = receipt.native, exit = receipt.nativeExit;
    assert.ok(native && Number.isSafeInteger(native.pid) && native.pid > 0 && Number.isSafeInteger(native.ppid) && native.ppid > 0 && typeof native.execPath === 'string');
    assert.match(native.creation || '', /^\d{1,19}$/); assert.ok(!seen.has(native.pid + ':' + native.creation), 'Duplicate native process receipt.'); seen.add(native.pid + ':' + native.creation);
    assert.ok(Number.isSafeInteger(receipt.launcherPid) && receipt.launcherPid > 0);
    assert.ok(native.pid === receipt.launcherPid || native.ppid === receipt.launcherPid, 'Native main must belong to captured launcher.');
    assert.equal(exit?.code, 0); assert.equal(exit.creation, native.creation);
    // The Windows held-handle observer emits {code, creation}; absence of signal
    // is preserved in raw receipts, and normalized separately, not invented.
    assert.ok(!Object.hasOwn(exit, 'signal') || exit.signal === null, 'Native termination signal is forbidden.');
    assert.equal(receipt.verificationScope, 'captured-owned-tree');
    const tree = receipt.ownedTree;
    assert.ok(Array.isArray(tree) && tree.length > 0 && tree.length <= 128, 'Missing bounded native owned tree.');
    assert.equal(tree[0].pid, native.pid); assert.equal(tree[0].parent, native.ppid); assert.equal(tree[0].creation, native.creation);
    const owned = new Map();
    for (const row of tree) {
      assert.ok(Number.isSafeInteger(row.pid) && row.pid > 0 && Number.isSafeInteger(row.parent) && row.parent > 0); assert.match(row.creation, /^\d{1,19}$/);
      assert.ok(!owned.has(row.pid), 'Duplicate PID in native tree.');
      if (row.pid !== native.pid) { assert.ok(owned.has(row.parent), 'Unowned parent in captured tree.'); assert.ok(BigInt(row.creation) >= BigInt(owned.get(row.parent).creation), 'Child predates captured parent.'); }
      owned.set(row.pid, row);
    }
    assert.equal(receipt.capturedIdentitiesGone, true);
    assert.ok(Array.isArray(receipt.identityObservations) && receipt.identityObservations.length > 0, 'Missing actual identity observations.');
    for (const observation of receipt.identityObservations) {
      assert.ok(Number.isFinite(observation.at) && typeof observation.gone === 'boolean' && Array.isArray(observation.live));
      assert.equal(observation.gone, observation.live.length === 0);
      for (const row of observation.live) assert.ok(tree.some(identity => identity.pid === row.pid && identity.creation === row.creation), 'Uncaptured identity in observation.');
    }
    const final = receipt.identityObservations.at(-1); assert.equal(final.gone, true); assert.deepEqual(final.live, []);
    assert.ok(Number.isFinite(receipt.elapsed) && receipt.elapsed >= 0 && receipt.elapsed < 20000, 'Native close exceeded existing helper budget.');
    if (receipt.inspectorQualification || receipt.ownedInspectorSocketTerminated) {
      assert.equal(receipt.inspectorQualification?.mainPid, native.pid); assert.equal(receipt.inspectorQualification?.matchingExitNonce, true);
      assert.equal(receipt.productionAtExit?.pid, native.pid); assert.ok(typeof receipt.productionAtExit?.nonce === 'string' && receipt.productionAtExit.nonce.length > 0);
    }
    return { file, native, launcherPid: receipt.launcherPid, nativeExit: exit, normalizedSignal: null, rawSignalPresent: Object.hasOwn(exit, 'signal'), ownedIdentities: tree.length, capturedIdentitiesGone: true, graceful: true, forcedOwnedCleanup: false, elapsed: receipt.elapsed };
  });
}
const PATH_KEYS = ['home', 'appData', 'userData', 'sessionData', 'temp', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos', 'logs', 'crashDumps'];
function validatePathReceipts(rows, shutdown, privateRoot, frozenMain) {
  assert.equal(rows.length, 4, 'Exactly four actual app path receipts required.');
  const seen = new Set();
  for (const row of rows) {
    assert.ok(!seen.has(row.pid)); seen.add(row.pid);
    assert.ok(shutdown.some(item => item.native.pid === row.pid), 'Path receipt is not one of the held native mains.');
    assert.equal(row.main, frozenMain); assert.equal(row.ragRoot, path.resolve(path.dirname(frozenMain), '../../../../')); assert.equal(row.mode, 'existing-E2E-fixtures; isolation-only-bootstrap');
    assert.equal(row.env.HOMEBOT_E2E, '1'); assert.equal(row.env.NODE_ENV, 'test'); assert.equal(row.env.HOMEBOT_ENABLE_AUTO_UPDATE, '0'); assert.equal(row.env.ELECTRON_RUN_AS_NODE, undefined);
    for (const key of PATH_KEYS) assert.ok(typeof row.paths[key] === 'string' && within(privateRoot, row.paths[key]), 'Electron store is not private: ' + key);
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'ANCIENT_PATHWAYS_DIR', 'HOMEBOT_MOVIE_PROJECTS_DIR', 'HOMEBOT_E2E_USER_DATA_DIR']) assert.ok(typeof row.env[key] === 'string' && within(privateRoot, row.env[key]), 'Environment store is not private: ' + key);
    assert.deepEqual(row.paths, row.expectedPaths, 'Actual Electron paths differ from bootstrap contract.');
    assert.equal(row.paths.home, row.env.HOME); assert.equal(row.env.USERPROFILE, row.env.HOME);
    assert.equal(row.paths.appData, row.env.APPDATA); assert.equal(row.paths.temp, row.env.TEMP); assert.equal(row.env.TMP, row.env.TEMP); assert.equal(row.env.TMPDIR, row.env.TEMP);
    assert.equal(row.paths.userData, row.env.HOMEBOT_E2E_USER_DATA_DIR); assert.equal(row.paths.sessionData, path.join(row.paths.userData, 'Chromium'));
    for (const key of ['desktop', 'documents', 'downloads', 'music', 'pictures', 'videos']) assert.equal(row.paths[key], path.join(row.paths.home, key[0].toUpperCase() + key.slice(1)));
    assert.equal(row.paths.logs, path.join(row.paths.userData, 'logs')); assert.equal(row.paths.crashDumps, path.join(row.paths.userData, 'CrashDumps'));
    assert.equal(row.osHome, row.env.HOME); assert.equal(row.osTemp, row.env.TEMP); assert.ok(within(privateRoot, row.ragRoot));
  }
  return rows;
}
function privateEnvironment(original, home) {
  const env = { ...original };
  for (const key of Object.keys(env)) if (/^(HOMEBOT_|ELECTRON_|NODE_OPTIONS$|NODE_PATH$|NODE_ENV$|VSCODE_INSPECTOR_OPTIONS$|ANCIENT_PATHWAYS_DIR$|PLAYWRIGHT_|PW_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_|GEMINI_|OLLAMA_)/i.test(key) || /(?:TOKEN|SECRET|PASSWORD|API_KEY)$/i.test(key)) delete env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), TMPDIR: path.join(home, 'tmp'), ANCIENT_PATHWAYS_DIR: path.join(home, 'ap'), HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'movies'), HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_ENABLE_AUTO_UPDATE: '0', HOMEDRIVE: path.parse(home).root.slice(0, 2), HOMEPATH: home.slice(2) });
  return env;
}
function isolationEntry(privateRoot, widget, main) {
  return `'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app}=require('electron');
const privateRoot=${JSON.stringify(privateRoot)},widget=${JSON.stringify(widget)},main=${JSON.stringify(main)};
const within=(root,target)=>{const r=path.relative(root,path.resolve(target));return !path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep)};
const env=Object.fromEntries(['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','ANCIENT_PATHWAYS_DIR','HOMEBOT_MOVIE_PROJECTS_DIR','HOMEBOT_E2E_USER_DATA_DIR','HOMEBOT_E2E','NODE_ENV','HOMEBOT_ENABLE_AUTO_UPDATE','ELECTRON_RUN_AS_NODE'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','ANCIENT_PATHWAYS_DIR','HOMEBOT_MOVIE_PROJECTS_DIR','HOMEBOT_E2E_USER_DATA_DIR']){if(!env[key]||!within(privateRoot,env[key]))throw Error('Private fixture path missing/escaped: '+key);fs.mkdirSync(env[key],{recursive:true});if(!within(fs.realpathSync.native(privateRoot),fs.realpathSync.native(env[key])))throw Error('Private environment path redirected: '+key)}
if(env.HOMEBOT_E2E!=='1'||env.NODE_ENV!=='test'||env.HOMEBOT_ENABLE_AUTO_UPDATE!=='0'||env.ELECTRON_RUN_AS_NODE!==undefined)throw Error('Fixture mode mismatch');
const home=env.HOME,profile=env.HOMEBOT_E2E_USER_DATA_DIR;
const paths={home,appData:env.APPDATA,userData:profile,sessionData:path.join(profile,'Chromium'),temp:env.TEMP,desktop:path.join(home,'Desktop'),documents:path.join(home,'Documents'),downloads:path.join(home,'Downloads'),music:path.join(home,'Music'),pictures:path.join(home,'Pictures'),videos:path.join(home,'Videos'),logs:path.join(profile,'logs'),crashDumps:path.join(profile,'CrashDumps')};
for(const [key,value]of Object.entries(paths)){fs.mkdirSync(value,{recursive:true});if(!within(fs.realpathSync.native(privateRoot),fs.realpathSync.native(value)))throw Error('Private Electron path redirected: '+key);app.setPath(key,value)}
app.setAppPath(widget);app.setName('HomeBot');app.setVersion(require(path.join(widget,'package.json')).version);
const actual=Object.fromEntries(Object.keys(paths).map(key=>[key,app.getPath(key)]));
if(JSON.stringify(actual)!==JSON.stringify(paths))throw Error('Actual Electron stores differ');
const output=path.join(widget,'test-results');fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'ide-native-paths-'+process.pid+'.json'),JSON.stringify({pid:process.pid,main,ragRoot:path.resolve(path.dirname(main),'../../../../'),paths:actual,expectedPaths:paths,env,osHome:os.homedir(),osTemp:os.tmpdir(),mode:'existing-E2E-fixtures; isolation-only-bootstrap'},null,2));
require(main);
`;
}
function command(executable, args, options = {}) {
  const result = cp.spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options });
  validateSpawn(result, executable + ': ' + (result.error?.message || result.stderr || result.stdout)); return result.stdout.trim();
}
function validateSpawn(result, message = 'Actual process did not exit successfully without a signal.') { assert.ok(!result.error && result.status === 0 && result.signal === null, message); }
function copyFiles(root, destination) { for (const row of hashTree(root)) { const target = path.join(destination, row.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, row.path), target); } }
async function run() {
  const source = path.resolve(__dirname, '..'), widget = path.join(source, 'widget');
  const arg = process.argv.indexOf('--expected-head'), expected = arg >= 0 ? process.argv[arg + 1] : '';
  const proofParent = path.join(source, 'artifacts', 'ide-native-zero-retry'); fs.mkdirSync(proofParent, { recursive: true });
  const output = fs.mkdtempSync(path.join(proofParent, 'run-'));
  const proof = { source, expectedHead: expected, output, started: new Date().toISOString(), checks: [], limitations: ['Supplemental four-case Windows E2E fixture gate; not normal first-run delivery, installer, cloud/provider quality or all-IDE acceptance.', 'No retries. Exact PR head compiled by workflow; isolation bootstrap only sets paths before requiring frozen production main.', 'Native shutdown receipts and helper PID+nonce inspector ownership are unchanged production-test helpers.'] };
  const persist = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2));
  const check = (name, detail = {}) => { proof.checks.push({ name, passed: true, ...detail }); persist(); console.log(JSON.stringify({ name, ...detail })); };
  let runtime, before, env;
  persist();
  try {
    assert.equal(process.platform, 'win32', 'The native held-handle contract is a Windows lane.'); assert.match(expected, /^[0-9a-f]{40}$/);
    const privateRoot = fs.mkdtempSync(path.join(path.resolve(process.env.RUNNER_TEMP || os.tmpdir()), 'hbn-'));
    const home = path.join(privateRoot, 'h'); runtime = { root: privateRoot, home, widget: path.join(privateRoot, 'app', 'widget') }; proof.runtime = runtime;
    for (const directory of ['tmp', 'AppData/Roaming', 'AppData/Local', 'ap', 'movies']) fs.mkdirSync(path.join(home, directory), { recursive: true });
    fs.writeFileSync(path.join(home, 'ap', 'run_pipeline.py'), '# Isolated native gate: AP provider is not configured.\n');
    env = privateEnvironment(process.env, home);
    const head = command('git', ['rev-parse', 'HEAD'], { cwd: source, env }); assert.equal(head, expected, 'Checkout must be exact PR head, not merge ref.');
    assert.equal(command('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: source, env }), '', 'Tracked source changed.');
    proof.sourceHead = head;
    const req = createRequire(path.join(widget, 'package.json'));
    const versions = { electron: req('electron/package.json').version, playwright: req('playwright-core/package.json').version, pty: req('node-pty/package.json').version };
    assert.deepEqual(versions, { electron: '42.8.1', playwright: '1.57.0', pty: '1.2.0-beta.15' }); proof.versions = versions;
    for (const folder of [path.join(source, 'node_modules'), path.join(widget, 'node_modules')]) assert.ok(!fs.lstatSync(folder).isSymbolicLink(), 'CI dependency install must be private and real, not a shared junction.');
    const roots = {
      rootSqlite: path.join(source, 'node_modules', 'better-sqlite3'), widgetSqlite: path.join(widget, 'node_modules', 'better-sqlite3'),
      pty: path.join(widget, 'node_modules', 'node-pty'), electron: path.join(widget, 'node_modules', 'electron')
    };
    for (const folder of Object.values(roots)) assert.ok(within(source, fs.realpathSync.native(folder)), 'Native dependency escaped this private checkout.');
    const nativeSnapshot = () => Object.fromEntries(Object.entries(roots).map(([key, root]) => [key, { root, files: hashTree(root) }]));
    before = { compiled: hashTree(path.join(widget, 'out')), native: nativeSnapshot() };
    assert.equal(before.compiled.length, 79, 'Fresh build must contain the exact 79 compiled files.');
    for (const required of [path.join(roots.rootSqlite, 'build/Release/better_sqlite3.node'), path.join(roots.widgetSqlite, 'build/Release/better_sqlite3.node'), path.join(roots.pty, 'prebuilds/win32-x64/conpty.node'), path.join(roots.pty, 'prebuilds/win32-x64/conpty_console_list.node'), path.join(roots.pty, 'lib/worker/conoutSocketWorker.js')]) assert.ok(fs.statSync(required).isFile(), 'Required private native binding/worker missing: ' + required);
    proof.before = before; fs.writeFileSync(path.join(output, 'before-hashes.json'), JSON.stringify(before, null, 2));
    fs.mkdirSync(runtime.widget, { recursive: true }); copyFiles(path.join(widget, 'out'), path.join(runtime.widget, 'out')); fs.copyFileSync(path.join(widget, 'package.json'), path.join(runtime.widget, 'package.json'));
    fs.symlinkSync(path.join(widget, 'node_modules'), path.join(runtime.widget, 'node_modules'), 'junction');
    fs.symlinkSync(path.join(source, 'node_modules'), path.join(privateRoot, 'app', 'node_modules'), 'junction');
    const e2e = path.join(runtime.widget, 'src', 'renderer', 'e2e');
    copyFiles(path.join(widget, 'src/renderer/e2e/helpers'), path.join(e2e, 'helpers'));
    for (const name of ['launchElectron.ts', 'overlay.e2e.spec.ts', 'tooltip.e2e.spec.ts', 'workspace-problems.e2e.spec.ts']) { fs.mkdirSync(e2e, { recursive: true }); fs.copyFileSync(path.join(widget, 'src/renderer/e2e', name), path.join(e2e, name)); }
    const mainSupport = path.join(runtime.widget, 'src', 'main'); fs.mkdirSync(mainSupport, { recursive: true });
    for (const name of ['workspace-pty-force-stop.ts', 'workspace-pty-identity.ts']) fs.copyFileSync(path.join(widget, 'src/main', name), path.join(mainSupport, name));
    const main = path.join(runtime.widget, 'out/main/index.js'), shim = path.join(runtime.widget, 'dist/main/index.js'); fs.mkdirSync(path.dirname(shim), { recursive: true }); fs.writeFileSync(shim, isolationEntry(privateRoot, runtime.widget, main));
    proof.bootstrap = { path: shim, sha256: hash(shim), sourceMain: main, ragRoot: path.resolve(path.dirname(main), '../../../../'), noSettingsOrConsentSeed: true, noProviderResponseOverride: true };
    assert.equal(proof.bootstrap.ragRoot, privateRoot);
    proof.fixtures = hashTree(path.join(runtime.widget, 'src')); proof.runtimeCompiledBefore = hashTree(path.join(runtime.widget, 'out'));
    assert.deepEqual(proof.runtimeCompiledBefore, before.compiled);
    const rag = path.join(privateRoot, 'memory', 'rag-index.json'), ragBefore = fs.existsSync(rag) ? hash(rag) : null;
    const resultDirectory = path.join(runtime.widget, 'test-results'); fs.mkdirSync(resultDirectory, { recursive: true });
    env.HOMEBOT_NATIVE_ZERO_RETRY_TEST_DIR = e2e; env.HOMEBOT_NATIVE_ZERO_RETRY_OUTPUT = output;
    const config = path.join(widget, 'playwright.ide-native-zero-retry.config.cjs'); proof.config = { path: config, sha256: hash(config) };
    const args = [path.join(widget, 'node_modules/@playwright/test/cli.js'), 'test', '--config', config, '--workers=1', '--retries=0', '--repeat-each=1']; proof.args = args;
    check('Exact PR checkout, pinned dependencies, all79 frozen bytes and complete native hash inventory prepared');
    persist();
    const result = cp.spawnSync(process.execPath, args, { cwd: runtime.widget, env, encoding: 'utf8', windowsHide: true, timeout: 330000, maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(path.join(output, 'output.log'), (result.stdout || '') + (result.stderr || ''));
    proof.spawn = { status: result.status, signal: result.signal, error: result.error?.message }; persist();
    // Collect every result before checking exit/status so failed native receipts
    // and screenshots survive null status, timeout or an assertion failure.
    copyFiles(resultDirectory, path.join(output, 'native-artifacts'));
    proof.after = { compiled: hashTree(path.join(widget, 'out')), runtimeCompiled: hashTree(path.join(runtime.widget, 'out')), native: nativeSnapshot(), fixtures: hashTree(path.join(runtime.widget, 'src')), bootstrapSha256: hash(shim), ragSha256: fs.existsSync(rag) ? hash(rag) : null };
    fs.writeFileSync(path.join(output, 'after-hashes.json'), JSON.stringify(proof.after, null, 2));
    assert.deepEqual(proof.after.compiled, before.compiled); assert.deepEqual(proof.after.runtimeCompiled, before.compiled); assert.deepEqual(proof.after.native, before.native); assert.deepEqual(proof.after.fixtures, proof.fixtures); assert.equal(proof.after.bootstrapSha256, proof.bootstrap.sha256); assert.equal(proof.after.ragSha256, ragBefore);
    proof.compiledAndNativeUnchanged = true;
    check('All compiled/native/bootstrap/fixture bytes unchanged after actual test process');
    const report = JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8')); proof.stats = report.stats;
    proof.cases = validateResults(report);
    const receipts = fs.readdirSync(resultDirectory).filter(file => /^electron-shutdown-.*\.json$/.test(file)).map(file => ({ file, receipt: JSON.parse(fs.readFileSync(path.join(resultDirectory, file), 'utf8')) }));
    proof.shutdown = validateShutdownReceipts(receipts);
    const paths = fs.readdirSync(resultDirectory).filter(file => /^ide-native-paths-\d+\.json$/.test(file)).map(file => JSON.parse(fs.readFileSync(path.join(resultDirectory, file), 'utf8')));
    proof.actualPaths = validatePathReceipts(paths, proof.shutdown, privateRoot, main);
    validateSpawn(result, 'Actual Playwright process did not exit successfully without a signal.');
    check('Exactly4 actual passed tests, zero skip/flaky/retry and four matching private-path/held-OS0 native receipts', { cases: proof.cases.length, shutdown: proof.shutdown.length });
    proof.passed = true;
  } catch (error) {
    proof.passed = false; proof.failure = { message: error.message, stack: error.stack }; console.error(error.stack || String(error));
    if (runtime) {
      try { const resultDirectory = path.join(runtime.widget, 'test-results'); if (fs.existsSync(resultDirectory)) copyFiles(resultDirectory, path.join(output, 'native-artifacts')); } catch (copyError) { proof.artifactCaptureError = copyError.message; }
      // Never guess/kill a PID here. Existing unchanged helpers perform bounded
      // positively owned cleanup, which remains a failed shutdown in receipts.
    }
    process.exitCode = 1;
  } finally {
    proof.finished = new Date().toISOString();
    await attachCrashDiagnostics(proof, { privateRoot: runtime?.root, output, started: proof.started, finished: proof.finished, shutdownDirectory: runtime && path.join(runtime.widget, 'test-results'), env });
    persist(); console.log(JSON.stringify({ proof: path.join(output, 'proof.json'), passed: proof.passed === true }));
  }
}
module.exports = { EXPECTED_CASES, PATH_KEYS, hashTree, validateResults, validateShutdownReceipts, validatePathReceipts, privateEnvironment, isolationEntry, validateSpawn };
if (require.main === module) void run();
