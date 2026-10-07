import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { spawn, type ChildProcess } from 'child_process';
import { assertWorkspaceRuntimeOpen } from './workspace-runtime-admission';
import { stripAnsi } from '../shared/ansi';
import { checkedAnyTrustedWorkspacePath, checkedTrustedWorkspacePath, validateTrustedWorkspaceRoot, workspacePathWithin } from './workspace-trust';
import type { WorkspaceDiscoveredTest, WorkspaceTestRequest, WorkspaceTestResult } from '../shared/workspace-test-types';
import { rememberWorkspaceChild, stopWorkspaceChild } from './workspace-owned-process';
import { createPendingWorkspaceWindowsJob, type PendingWorkspaceWindowsJob } from './workspace-windows-job';
import { createWorkspaceProcessGate, snapshotWorkspaceLaunch } from './workspace-process-gate';
import { workspacePtyLifecycle } from './workspace-pty-identity';
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.cache', '.next', '.venv']);
const TEST_FILE = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/i;
interface TestRun {
  child: ChildProcess | null; output: string; exitCode: number | null; coveragePath?: string; stopped: boolean;
  starting: boolean; ended: boolean; released: boolean; cleanupConfirmed: boolean; stopRequested: boolean;
  job?: PendingWorkspaceWindowsJob; stopping?: Promise<void>; cleanupError?: string;
  close?: Promise<void>; resolveClose?: () => void;
}
const runs = new Map<string, TestRun>();
let stoppingAll = false, cleanupGeneration = 0;
let globalStopping: Promise<void> | undefined;
function nearestPackage(root: string, file: string): { directory: string; manifest: any } {
  let directory = fs.statSync(file).isDirectory() ? file : path.dirname(file);
  while (workspacePathWithin(root, directory)) {
    const manifestFile = path.join(directory, 'package.json');
    try { if (fs.statSync(manifestFile).size > 1024 * 1024 || checkedTrustedWorkspacePath(root, manifestFile) !== manifestFile) throw new Error('Invalid package manifest.'); return { directory, manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')) }; } catch { /* Try the enclosing package. */ }
    if (directory === root) break; directory = path.dirname(directory);
  }
  return { directory: root, manifest: {} };
}
const JEST_CONFIG_NAMES = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.mts', 'jest.config.cjs', 'jest.config.cts', 'jest.config.json'];
function hasJestConfig(root: string, directory: string): boolean {
  // Jest resolves from the command cwd and stops at the nearest package.json.
  // Inspect only these fixed filenames; discovering a runner never loads config.
  return JEST_CONFIG_NAMES.some(name => {
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return false;
      const canonical = checkedTrustedWorkspacePath(root, file);
      return process.platform === 'win32' ? canonical.toLowerCase() === file.toLowerCase() : canonical === file;
    } catch { return false; }
  });
}
function runnerFor(root: string, file: string, content: string): WorkspaceDiscoveredTest['runner'] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  let explicit: WorkspaceDiscoveredTest['runner'] | undefined;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.moduleSpecifier.text === 'node:test') explicit = 'node'; else if (statement.moduleSpecifier.text === 'vitest') explicit = 'vitest'; else if (statement.moduleSpecifier.text === '@jest/globals') explicit = 'jest';
    }
  }
  if (explicit) return explicit;
  const findRequire = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const module = node.arguments[0].text;
      if (module === 'node:test') explicit = 'node'; else if (module === 'vitest') explicit = 'vitest'; else if (module === '@jest/globals') explicit = 'jest';
    }
    ts.forEachChild(node, findRequire);
  };
  findRequire(source); if (explicit) return explicit;
  const { directory, manifest } = nearestPackage(root, file); const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  // Explicit Jest configuration identifies global Jest tests even when
  // Vitest is also installed. Explicit source imports above still win.
  return manifest.jest || hasJestConfig(root, directory) ? 'jest' : dependencies.vitest ? 'vitest' : dependencies.jest ? 'jest' : 'node';
}
/** Parse declarations, without importing or executing project code. */
export function discoverWorkspaceTests(rootInput: string): WorkspaceDiscoveredTest[] {
  const root = validateTrustedWorkspaceRoot(rootInput); const files: string[] = []; const result: WorkspaceDiscoveredTest[] = [];
  const walk = (directory: string, depth: number) => {
    if (depth > 25 || files.length >= 1000) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !SKIP.has(entry.name)) walk(file, depth + 1);
      else if (entry.isFile() && TEST_FILE.test(file)) files.push(file);
      if (files.length >= 1000) break;
    }
  };
  walk(root, 0);
  let sourceBytes = 0;
  for (const file of files) {
    const size = fs.statSync(file).size;
    if (size > 512 * 1024) continue;
    if (sourceBytes + size > 16 * 1024 * 1024 || result.length >= 2000) break;
    sourceBytes += size;
    const content = fs.readFileSync(file, 'utf8'); const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true); const runner = runnerFor(root, file, content);
    const startCount = result.length;
    const visit = (node: ts.Node, suites: string[]) => {
      let childSuites = suites;
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const expression = node.expression; const base = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : '';
        const title = node.arguments[0];
        if (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) {
          if (base === 'describe' || base === 'suite') childSuites = [...suites, title.text];
          else if (base === 'test' || base === 'it') {
            const pos = source.getLineAndCharacterOfPosition(node.getStart(source)); const name = [...suites, title.text].join(' ');
            result.push({ path: file, name, line: pos.line + 1, runner, skipped: ts.isPropertyAccessExpression(expression) && ['skip', 'todo'].includes(expression.name.text) });
          }
        }
      }
      ts.forEachChild(node, child => visit(child, childSuites));
    };
    visit(source, []);
    if (result.length === startCount) result.push({ path: file, name: '(all tests in file; dynamic declarations)', line: 1, runner });
  }
  return result.slice(0, 2000);
}
function installedRunner(root: string, directory: string, runner: 'jest' | 'vitest'): string {
  let current = directory;
  const relative = runner === 'jest' ? ['node_modules', 'jest', 'bin', 'jest.js'] : ['node_modules', 'vitest', 'vitest.mjs'];
  while (workspacePathWithin(root, current)) {
    const entry = path.join(current, ...relative);
    try { const checked = checkedAnyTrustedWorkspacePath(entry); if (fs.statSync(checked).isFile()) return checked; } catch { /* Try the enclosing package. */ }
    if (current === root) break; current = path.dirname(current);
  }
  throw new Error(`${runner === 'jest' ? 'Jest' : 'Vitest'} is declared but is not installed. Install this project's dependencies before running tests.`);
}
export function prepareWorkspaceTestCommand(request: WorkspaceTestRequest): { root: string; cwd: string; args: string[]; coveragePath?: string } {
  const root = validateTrustedWorkspaceRoot(request.root);
  if (typeof request.file !== 'string') throw new Error('Choose a test file.');
  const file = checkedTrustedWorkspacePath(root, request.file);
  if (!fs.statSync(file).isFile() || !TEST_FILE.test(file)) throw new Error('Choose a discovered test file inside this project.');
  const tests = discoverWorkspaceTests(root).filter(test => test.path === file);
  if (!tests.length) throw new Error('This test file is unavailable.');
  const selected = request.testName ? tests.find(test => test.name === request.testName) : undefined;
  if (request.testName && !selected) throw new Error('Choose one of this file\'s discovered tests.');
  if (selected?.skipped) throw new Error('This test is marked skip/todo. Enable it in the source before running it individually.');
  const runner = tests[0].runner; const { directory } = nearestPackage(root, file);
  if (runner === 'node' && /\.[jt]sx$/i.test(file)) throw new Error('JSX/TSX tests need a configured Jest or Vitest transpiler. Use the project package task if this test uses another runner.');
  const pattern = selected && !selected.name.startsWith('(all tests') ? '^' + selected.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' : undefined;
  let args: string[];
  if (runner === 'node') args = ['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...(request.coverage ? ['--experimental-test-coverage'] : []), file];
  else if (runner === 'jest') args = [installedRunner(root, directory, runner), '--runInBand', '--watch=false', '--runTestsByPath', file, ...(pattern ? ['--testNamePattern', pattern] : []), ...(request.coverage ? ['--coverage'] : [])];
  else args = [installedRunner(root, directory, runner), 'run', file, ...(pattern ? ['-t', pattern] : []), ...(request.coverage ? ['--coverage'] : [])];
  return { root, cwd: directory, args, coveragePath: request.coverage && runner !== 'node' ? path.join(directory, 'coverage') : undefined };
}
function state(run?: TestRun): WorkspaceTestResult {
  if (!run) return { success: true, running: false, output: '', exitCode: null };
  const output = stripAnsi(run.output); const nodePassed = output.match(/^\s*(?:#|ℹ)\s+pass (\d+)/m); const nodeFailed = output.match(/^\s*(?:#|ℹ)\s+fail (\d+)/m); const nodeSkipped = output.match(/^\s*(?:#|ℹ)\s+skipped (\d+)/m);
  const jestLine = output.match(/^Tests:\s*(.+)$/m); const summary = nodePassed ? { passed: Number(nodePassed[1]), failed: Number(nodeFailed?.[1] || 0), skipped: Number(nodeSkipped?.[1] || 0) } : jestLine ? { passed: Number(jestLine[1].match(/(\d+) passed/)?.[1] || 0), failed: Number(jestLine[1].match(/(\d+) failed/)?.[1] || 0), skipped: Number(jestLine[1].match(/(\d+) skipped/)?.[1] || 0) } : undefined;
  const running = run.starting || (!!run.child && !run.ended);
  const cleanupPending = !!run.job && !run.cleanupConfirmed;
  return { success: true, running, cleanupPending, output, exitCode: run.exitCode, coveragePath: run.coveragePath, summary,
    note: run.cleanupError ? `Cleanup remains pending: ${run.cleanupError} Try Stop tests again.` : cleanupPending && !running ? 'The runner ended; Stop tests must confirm its retained Windows Job has no remaining programs.' : run.stopped ? 'Stopped by user.' : !running && run.exitCode === 0 && (!summary || summary.passed === 0) ? 'The process exited successfully; an executed test pass was not confirmed. Review the output.' : undefined };
}
function waitRunClose(run: TestRun): Promise<void> {
  if (!run.close || run.ended) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The owned test runner has not confirmed close.')), 5500);
    void run.close!.then(() => { clearTimeout(timer); resolve(); });
  });
}
function stopRun(run: TestRun): Promise<void> {
  run.stopped = true; run.stopRequested = true;
  if (run.cleanupConfirmed) return Promise.resolve();
  if (run.stopping) return run.stopping;
  const operation = (async () => {
    if (run.job) {
      // A failed assignment must not orphan the exact still-gated child. Both
      // cleanup outcomes remain required; Job uncertainty never becomes success.
      const results = await Promise.allSettled([
        run.job.stop(),
        !run.released && run.child && !run.ended ? stopWorkspaceChild(run.child) : Promise.resolve(),
      ]);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
    } else if (run.child && !run.ended) await stopWorkspaceChild(run.child);
    await waitRunClose(run);
    run.cleanupConfirmed = true; run.cleanupError = undefined;
  })();
  run.stopping = operation;
  void operation.catch(error => { run.cleanupError = error instanceof Error ? error.message : String(error); });
  void operation.finally(() => { if (run.stopping === operation) run.stopping = undefined; }).catch(() => {});
  return operation;
}
export function stopWorkspaceTestRuns(): Promise<void> {
  if (globalStopping) return globalStopping;
  stoppingAll = true; cleanupGeneration++;
  const operation = (async () => {
    try {
    const results = await Promise.allSettled([...runs.values()].map(stopRun));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
    } finally { stoppingAll = false; }
  })();
  globalStopping = operation;
  void operation.finally(() => { if (globalStopping === operation) globalStopping = undefined; }).catch(() => {});
  return operation;
}
export async function performWorkspaceTests(request: WorkspaceTestRequest, assertCurrent: () => void = () => {}): Promise<WorkspaceTestResult> {
  let root: string | undefined;
  try {
    root = validateTrustedWorkspaceRoot(request.root);
    if (request.action === 'list') return { success: true, tests: discoverWorkspaceTests(root) };
    if (request.action === 'state') return state(runs.get(root));
    if (request.action === 'stop') { const run = runs.get(root); if (run) await stopRun(run); return state(run); }
    if (request.action !== 'run') throw new Error('Unknown test action.');
    assertWorkspaceRuntimeOpen();
    assertCurrent();
    const generation = cleanupGeneration;
    const previous = runs.get(root);
    if (previous && !previous.starting && (previous.ended || !previous.child) && !previous.cleanupConfirmed) await stopRun(previous);
    if (stoppingAll || generation !== cleanupGeneration) throw new Error('Test cleanup changed during startup. Try Run again after cleanup finishes.');
    if ([...runs.values()].some(run => run.starting || (!!run.child && !run.ended))) throw new Error('Stop the current test run first.');
    const snapshot = { ...request };
    const prepared = prepareWorkspaceTestCommand(snapshot);
    const file = checkedTrustedWorkspacePath(root, snapshot.file!);
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' };
    const run: TestRun = { child: null, output: '', exitCode: null, coveragePath: prepared.coveragePath, stopped: false,
      starting: true, ended: false, released: false, cleanupConfirmed: false, stopRequested: false };
    // Synchronous reservation prevents two requests or global Stop overlooking
    // an awaited Job listener/assignment that has not spawned its core gate yet.
    runs.set(root, run);
    const admitted = () => {
      assertCurrent(); assertWorkspaceRuntimeOpen();
      if (run.stopRequested || run.ended || stoppingAll || cleanupGeneration !== generation || runs.get(root!) !== run) throw new Error('Test startup was cancelled before project execution.');
      if (validateTrustedWorkspaceRoot(root!) !== root || checkedTrustedWorkspacePath(root!, file) !== file || !fs.statSync(file).isFile()) throw new Error('The test project or file changed during startup.');
    };
    try {
    let child: ChildProcess;
    if (process.platform === 'win32') {
      const gate = createWorkspaceProcessGate(env);
      run.job = createPendingWorkspaceWindowsJob({ env: gate.env, gate: { pipeName: gate.pipeName, capability: gate.capability } });
      void run.job.ready.catch(() => {});
      await run.job.listening; admitted();
      child = spawn(gate.executable, gate.args, { cwd: prepared.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: gate.env });
    } else {
      admitted(); run.released = true;
      child = spawn(process.execPath, prepared.args, { cwd: prepared.cwd, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    }
    run.child = child;
    rememberWorkspaceChild(child);
    run.close = new Promise(resolve => { run.resolveClose = resolve; });
    const append = (chunk: Buffer) => { run.output = (run.output + chunk.toString('utf8')).slice(-256_000); };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    child.once('error', error => { run.output = (run.output + error.message).slice(-256_000); run.exitCode = -1;
      if (!child.pid) { run.ended = true; run.resolveClose?.(); } });
    child.once('close', code => { run.exitCode = code; run.ended = true; run.resolveClose?.();
      // Windows retains the SAME Job after leader close; no descendant/PID
      // recapture. POSIX keeps its existing narrower natural-close behavior.
      if (!run.job) run.cleanupConfirmed = true;
    });
    if (run.job) {
      if (!Number.isSafeInteger(child.pid) || child.pid! <= 0) throw new Error('The test bootstrap did not spawn a positive native PID.');
      const identity = await workspacePtyLifecycle.capture(child.pid!);
      if (!identity) throw new Error('The test bootstrap native identity could not be verified.');
      admitted(); await run.job.attach(child.pid!, identity); await run.job.ready; admitted();
      const launch = snapshotWorkspaceLaunch(process.execPath, prepared.args, env, { cwd: prepared.cwd });
      // Node --test, Jest --watch=false and Vitest run are finite commands.
      // The shared task admission still requires the exact completed-target
      // ACK and retained Job accounting when a fast target has already exited.
      launch.kind = 'task';
      await run.job.authorize(launch, () => { admitted(); run.released = true; });
    }
    run.starting = false;
    return state(run);
    } catch (error) {
      run.starting = false;
      try { await stopRun(run); } catch { /* Retained uncertainty is visible in state and remains retryable. */ }
      throw error;
    }
  } catch (error) { return { ...(root ? state(runs.get(root)) : {}), success: false, error: error instanceof Error ? error.message : String(error) }; }
}
