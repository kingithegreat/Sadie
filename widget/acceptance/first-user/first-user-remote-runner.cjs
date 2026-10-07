'use strict';
// Runs only on disposable Windows Actions runners. Never installs/rebuilds
// dependencies after native launch; linked dependency targets are CI-owned.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

assert.equal(process.platform, 'win32', 'Acceptance requires Windows CIM process identity');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use only disposable GitHub Actions dependencies');
const repo = fs.realpathSync(process.env.GITHUB_WORKSPACE || path.resolve(__dirname, '../../..'));
const widget = path.join(repo, 'widget');
const acceptance = path.join(widget, 'acceptance', 'first-user');
const temp = fs.realpathSync(process.env.RUNNER_TEMP);
const proof = path.join(temp, 'first-user-native-proof');
const compiledArtifact = path.join(temp, 'first-user-native-compiled');
// Refuse reuse: a retry/job must have fresh stores and receipts.
fs.mkdirSync(proof);
fs.mkdirSync(compiledArtifact);
const owned = fs.mkdtempSync(path.join(temp, 'fu-'));
const runtimeRoot = path.join(owned, 'runtime');
const runtimeWidget = path.join(runtimeRoot, 'app', 'widget');
const fixtureRoot = path.join(owned, 'h');
fs.mkdirSync(runtimeWidget, { recursive: true });
fs.mkdirSync(fixtureRoot);
const errors = [];
let stage = 'source';
let source;
let payloadBefore;
let dependencyBefore;
let nativeStatus;
let sqliteBinding;

function write(name, value) {
  fs.writeFileSync(path.join(proof, name), JSON.stringify(value, null, 2));
}
function resourcePreflight(label) {
  const disk=fs.statfsSync(runtimeRoot,{bigint:true});
  const observed={label,freeDiskBytes:String(disk.bavail*disk.bsize),freeRAMBytes:os.freemem(),minimumDiskBytes:5*1024**3,minimumRAMBytes:2*1024**3,at:new Date().toISOString()};
  write('resource-'+label+'.json',observed);
  assert(disk.bavail*disk.bsize>=5n*1024n**3n,'Acceptance requires 5GiB disk before '+label);
  assert(observed.freeRAMBytes>=observed.minimumRAMBytes,'Acceptance requires 2GiB RAM before '+label);
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function record(file) {
  return fs.existsSync(file) ? { exists: true, bytes: fs.statSync(file).size, sha256: hash(file) } : { exists: false };
}
function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function walk(dir, prefix = '') {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name), relative = path.posix.join(prefix, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected link in compiled/proof payload: ${relative}`);
    if (entry.isDirectory()) files.push(...walk(file, relative));
    else if (entry.isFile()) files.push({ path: relative, ...record(file) });
  }
  return files;
}
function payload(root) {
  return Object.fromEntries(['out', 'resources', 'build', 'package.json'].map(name => {
    const target = path.join(root, name);
    return [name, name === 'package.json' ? record(target) : walk(target)];
  }));
}
function command(executable, args, cwd, env, capture = false, timeout = 12 * 60_000) {
  const result = spawnSync(executable, args, { cwd, env, windowsHide: true, shell: false,
    encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) {
    const error = new Error(`Command failed during ${stage}: ${path.basename(executable)} ${args.join(' ')} (exit ${result.status})`);
    error.cause = result.error;
    error.stdout = capture ? result.stdout : undefined;
    error.stderr = capture ? result.stderr : undefined;
    throw error;
  }
  return capture ? result.stdout : result;
}
function git(args) { return command('git.exe', args, repo, process.env, true, 30_000).trim(); }
function binary(packageRoot, key) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[key];
  assert(relative, `No declared ${key} executable`);
  return path.resolve(packageRoot, relative);
}
function cases(report) {
  const found = [];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) found.push({ title: spec.title, file: spec.file, test });
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites || []) visit(suite);
  return found;
}
function dependencySnapshot() {
  const files = {
    rootPackage: path.join(repo, 'package.json'), rootLock: path.join(repo, 'package-lock.json'),
    widgetPackage: path.join(widget, 'package.json'), widgetLock: path.join(widget, 'package-lock.json'),
    electron: path.join(widget, 'node_modules', 'electron', 'dist', 'electron.exe'),
    widgetSQLite: sqliteBinding || path.join(widget, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    rootSQLite: path.join(repo, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    sharp: path.join(widget, 'node_modules', '@img', 'sharp-win32-x64', 'lib', 'sharp-win32-x64.node'),
  };
  return Object.fromEntries(Object.entries(files).map(([name, file]) => [name, { file, ...record(file) }]));
}

// Install/build may use dependency-network access. Electron runtime is guarded
// by the unchanged acceptance bootstrap and has no provider/model access.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('HOMEBOT_') || ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'JEST_WORKER_ID'].includes(key)
    || /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key) || key.startsWith('N8N_')) delete env[key];
}
Object.assign(env, { NODE_ENV: 'production', HOMEBOT_FIRST_USER_NATIVE: '1',
  HOMEBOT_FIRST_USER_ENTRY: path.join(runtimeWidget, 'out', 'main', 'index.js'),
  HOMEBOT_FIRST_USER_RUNTIME_ROOT: runtimeRoot, HOMEBOT_FIRST_USER_FIXTURE_ROOT: fixtureRoot,
  HOMEBOT_FIRST_USER_PROOF_OUTPUT: proof });
write('runner-layout.json', { repo, owned, runtimeRoot, runtimeWidget, fixtureRoot, proof, compiledArtifact,
  e2eFlagPresent: Object.hasOwn(env, 'HOMEBOT_E2E'), dependencyTargetsDisposable: true,
  dependencyReadOnlyDuringNative: 'No install/rebuild during native; critical binaries and four package manifests compared before/after.' });
fs.writeFileSync(path.join(compiledArtifact, 'manifest.json'), JSON.stringify({ available: false, stage }, null, 2));

try {
  source = { head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), githubSha: process.env.GITHUB_SHA };
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'CI source must be clean before install/build');
  if (source.githubSha) assert.equal(source.head, source.githubSha, 'Checkout must match workflow SHA');
  write('source.json', source);
  for (const root of [repo, widget]) assert(!fs.existsSync(path.join(root, 'node_modules')), 'Clean CI must not inherit dependencies or a shared junction');
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert(fs.existsSync(npmCli), 'setup-node must supply its native npm CLI');
  // npm must install dev tools/Electron; production is the native runtime mode,
  // not npm's dependency-omission mode during the clean CI install.
  const installEnv = { ...env, NODE_ENV: 'development' };
  stage = 'root npm ci --ignore-scripts';
  resourcePreflight('root-install');
  command(process.execPath, [npmCli, 'ci', '--ignore-scripts'], repo, installEnv, false, 8 * 60_000);
  stage = 'widget npm ci / private Electron ABI';
  resourcePreflight('widget-install');
  command(process.execPath, [npmCli, 'ci'], widget, installEnv, false, 8 * 60_000);
  git(['diff', '--exit-code', 'HEAD', '--']);
  stage = 'build';
  resourcePreflight('build');
  command(process.execPath, [binary(path.join(widget, 'node_modules', 'electron-vite'), 'electron-vite'), 'build'], widget, env, false, 5 * 60_000);

  stage = 'isolated runtime copy';
  resourcePreflight('copy');
  for (const name of ['out', 'resources', 'build', 'package.json']) {
    const original = path.join(widget, name);
    assert(fs.existsSync(original), `Missing compiled runtime member ${name}`);
    fs.cpSync(original, path.join(runtimeWidget, name), { recursive: true, dereference: false, errorOnExist: true, force: false });
    fs.cpSync(original, path.join(compiledArtifact, name), { recursive: true, dereference: false, errorOnExist: true, force: false });
  }
  payloadBefore = payload(runtimeWidget);
  assert(payloadBefore.out.some(file => file.path === 'main/index.js'), 'Compiled production entry missing');
  assert.deepEqual(payload(compiledArtifact), payloadBefore, 'Artifact and exercised runtime bytes must match');
  write('compiled-before.json', { source, payload: payloadBefore });
  fs.writeFileSync(path.join(compiledArtifact, 'manifest.json'), JSON.stringify({ available: true, source, payload: payloadBefore }, null, 2));
  for (const [destination, target] of [[path.join(runtimeRoot, 'app', 'node_modules'), path.join(repo, 'node_modules')],
    [path.join(runtimeWidget, 'node_modules'), path.join(widget, 'node_modules')]]) {
    assert(within(repo, fs.realpathSync(target)), 'Dependency junction target must remain inside disposable checkout');
    fs.symlinkSync(target, destination, 'junction');
    assert.equal(fs.realpathSync(destination), fs.realpathSync(target));
  }
  stage = 'Electron SQLite load control';
  resourcePreflight('native-binding');
  const bindingHome=path.join(owned,'binding-home');
  fs.mkdirSync(bindingHome);
  const probeCode=`const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(path.join(widget,'package.json'))});const Database=r('better-sqlite3');const db=new Database(':memory:');const result=db.prepare('SELECT 42 AS value').get();const native=Object.keys(require.cache).filter(file=>file.endsWith('better_sqlite3.node'));db.close();console.log(JSON.stringify({value:result.value,native,electron:process.versions.electron,modules:process.versions.modules}));`;
  const bindingProbe=JSON.parse(command(path.join(widget,'node_modules/electron/dist/electron.exe'),['-e',probeCode],bindingHome,
    {...env,ELECTRON_RUN_AS_NODE:'1',HOME:bindingHome,USERPROFILE:bindingHome,APPDATA:bindingHome,LOCALAPPDATA:bindingHome,TEMP:bindingHome,TMP:bindingHome},true,30_000));
  write('native-binding-proof.json',bindingProbe);
  assert.equal(bindingProbe.value,42,'Electron must execute a real in-memory SQLite query');
  assert.equal(bindingProbe.electron,JSON.parse(fs.readFileSync(path.join(widget,'node_modules/electron/package.json'),'utf8')).version);
  assert.equal(bindingProbe.native.length,1,'Resolve the actually loaded SQLite binary');
  sqliteBinding=fs.realpathSync(bindingProbe.native[0]);
  assert(within(fs.realpathSync(path.join(widget,'node_modules/better-sqlite3')),sqliteBinding),'SQLite must come from disposable widget dependencies');
  dependencyBefore = dependencySnapshot();
  assert(dependencyBefore.electron.exists && dependencyBefore.widgetSQLite.exists, 'Widget install must provide Electron and rebuilt SQLite');
  write('dependencies-before.json', dependencyBefore);
  const disk = fs.statfsSync(runtimeRoot, { bigint: true });
  const resources = { freeDiskBytes: String(disk.bavail * disk.bsize), freeRAMBytes: os.freemem(),
    minimumDiskBytes: 5 * 1024 ** 3, minimumRAMBytes: 2 * 1024 ** 3, at: new Date().toISOString() };
  write('resource-preflight.json', resources);
  assert(disk.bavail * disk.bsize >= 5n * 1024n ** 3n, 'Native launch requires at least 5GiB free disk');
  assert(resources.freeRAMBytes >= resources.minimumRAMBytes, 'Native launch requires at least 2GiB free RAM');
  const widgetRequire = createRequire(path.join(widget, 'package.json'));
  const playwright = binary(path.dirname(widgetRequire.resolve('@playwright/test/package.json')), 'playwright');
  const config = path.join(acceptance, 'playwright.config.cjs');
  const discoveryEnv = { ...env };
  for (const key of ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_DIR']) delete discoveryEnv[key];
  stage = 'exact native discovery';
  const listed = command(process.execPath, [playwright, 'test', '--config', config, '--list', '--reporter=json', '--workers=1', '--retries=0'], acceptance, discoveryEnv, true, 60_000);
  fs.writeFileSync(path.join(proof, 'discovery.json'), listed);
  const discovered = cases(JSON.parse(listed));
  assert.equal(discovered.length, 4, 'Discover exactly four native cases');
  assert.equal(new Set(discovered.map(item => `${item.file}:${item.title}`)).size, 4, 'Cases must be unique');
  stage = 'native four cases';
  nativeStatus = command(process.execPath, [playwright, 'test', '--config', config, '--workers=1', '--retries=0'], acceptance, env, false, 12 * 60_000).status;
  stage = 'native result gate';
  const report = JSON.parse(fs.readFileSync(path.join(proof, 'result.json'), 'utf8'));
  assert.deepEqual({ expected: report.stats.expected, unexpected: report.stats.unexpected, flaky: report.stats.flaky, skipped: report.stats.skipped },
    { expected: 4, unexpected: 0, flaky: 0, skipped: 0 });
  const executed = cases(report);
  assert.equal(executed.length, 4);
  for (const item of executed) {
    assert.equal(item.test.results.length, 1, `${item.title}: no retries`);
    assert.equal(item.test.results[0].status, 'passed', `${item.title}: must execute and pass`);
  }
  const receipts = walk(path.join(proof, 'results')).filter(file => path.posix.basename(file.path) === 'first-user-shutdown.json');
  assert.equal(receipts.length, 4, 'Each case needs its own strict process disappearance receipt');
  for (const file of receipts) {
    const receipt = JSON.parse(fs.readFileSync(path.join(proof, 'results', file.path), 'utf8'));
    assert.equal(receipt.closeOutcome, 'closed'); assert.equal(receipt.forced, false);
    assert.equal(receipt.closeError, null); assert.equal(receipt.refusal, null);
    assert.equal(receipt.nativeProbeSucceeded, true); assert.equal(receipt.launcherProbeSucceeded, true);
    assert.equal(receipt.nativeSameIdentityAlive, false); assert.equal(receipt.launcherSameIdentityAlive, false);
    assert.equal(receipt.safeToCloseServers, true);
  }
} catch (error) {
  errors.push(error);
  if (error.stdout) fs.writeFileSync(path.join(proof, 'failed-command.stdout.txt'), error.stdout);
  if (error.stderr) fs.writeFileSync(path.join(proof, 'failed-command.stderr.txt'), error.stderr);
} finally {
  // Retain after-snapshots even when build/native/assertions fail. Never delete
  // native profiles or follow/remove their dependency junctions in this runner.
  try {
    const after = payload(runtimeWidget);
    write('compiled-after.json', { source, payload: after });
    if (payloadBefore) assert.deepEqual(after, payloadBefore, 'Exercised compiled bytes changed during native acceptance');
    else fs.writeFileSync(path.join(compiledArtifact, 'manifest.json'), JSON.stringify({ available: false, source, stage, partialPayload: after }, null, 2));
  } catch (error) { errors.push(error); }
  try {
    if (dependencyBefore) {
      const after = dependencySnapshot();
      write('dependencies-after.json', after);
      assert.deepEqual(after, dependencyBefore, 'Dependency binaries/package manifests changed during native execution');
    }
    if (source) {
      assert.equal(git(['rev-parse', 'HEAD^{tree}']), source.tree, 'Source tree changed');
      git(['diff', '--exit-code', 'HEAD', '--']);
    }
  } catch (error) { errors.push(error); }
  write('runner-result.json', { source, stage, nativeStatus, passed: errors.length === 0,
    nativeOSExit0Proved: false, observedBoundary: 'Exact native/launcher CIM identities disappeared without forced cleanup; no native OS exit code claim.',
    errors: errors.map(error => ({ name: error.name, message: error.message, cause: error.cause?.message })) });
}
if (errors.length === 1) throw errors[0];
if (errors.length > 1) throw new AggregateError(errors, 'First-user remote build/native/hash checks failed');
