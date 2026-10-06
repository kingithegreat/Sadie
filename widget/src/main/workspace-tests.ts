import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { spawn, type ChildProcess } from 'child_process';
import { stripAnsi } from '../shared/ansi';
import { checkedAnyTrustedWorkspacePath, checkedTrustedWorkspacePath, validateTrustedWorkspaceRoot, workspacePathWithin } from './workspace-trust';
import type { WorkspaceDiscoveredTest, WorkspaceTestRequest, WorkspaceTestResult } from '../shared/workspace-test-types';
import { rememberWorkspaceChild, stopWorkspaceChild } from './workspace-owned-process';
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.cache', '.next', '.venv']);
const TEST_FILE = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/i;
interface TestRun { child: ChildProcess | null; output: string; exitCode: number | null; coveragePath?: string; stopped: boolean }
const runs = new Map<string, TestRun>();
function nearestPackage(root: string, file: string): { directory: string; manifest: any } {
  let directory = fs.statSync(file).isDirectory() ? file : path.dirname(file);
  while (workspacePathWithin(root, directory)) {
    const manifestFile = path.join(directory, 'package.json');
    try { if (fs.statSync(manifestFile).size > 1024 * 1024 || checkedTrustedWorkspacePath(root, manifestFile) !== manifestFile) throw new Error('Invalid package manifest.'); return { directory, manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')) }; } catch { /* Try the enclosing package. */ }
    if (directory === root) break; directory = path.dirname(directory);
  }
  return { directory: root, manifest: {} };
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
  const findRequire = (node: ts.Node) => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'node:test') explicit = 'node'; ts.forEachChild(node, findRequire); };
  findRequire(source); if (explicit) return explicit;
  const { manifest } = nearestPackage(root, file); const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  return dependencies.vitest ? 'vitest' : dependencies.jest || manifest.jest ? 'jest' : 'node';
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
  return { success: true, running: !!run.child, output, exitCode: run.exitCode, coveragePath: run.coveragePath, summary, note: run.stopped ? 'Stopped by user.' : !run.child && run.exitCode === 0 && (!summary || summary.passed === 0) ? 'The process exited successfully; an executed test pass was not confirmed. Review the output.' : undefined };
}
async function stopRun(run: TestRun) {
  const child = run.child; run.stopped = true;
  if (!child?.pid || child.exitCode !== null) { run.child = null; return; }
  await stopWorkspaceChild(child);
}
export async function stopWorkspaceTestRuns(): Promise<void> { await Promise.all([...runs.values()].map(stopRun)); }
export async function performWorkspaceTests(request: WorkspaceTestRequest): Promise<WorkspaceTestResult> {
  try {
    const root = validateTrustedWorkspaceRoot(request.root);
    if (request.action === 'list') return { success: true, tests: discoverWorkspaceTests(root) };
    if (request.action === 'state') return state(runs.get(root));
    if (request.action === 'stop') { const run = runs.get(root); if (run) await stopRun(run); return state(run); }
    if (request.action !== 'run') throw new Error('Unknown test action.');
    if (runs.get(root)?.child || [...runs.values()].some(run => !!run.child)) throw new Error('Stop the current test run first.');
    const prepared = prepareWorkspaceTestCommand(request);
    const child = spawn(process.execPath, prepared.args, { cwd: prepared.cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' } });
    rememberWorkspaceChild(child);
    const run: TestRun = { child, output: '', exitCode: null, coveragePath: prepared.coveragePath, stopped: false }; runs.set(root, run);
    const append = (chunk: Buffer) => { run.output = (run.output + chunk.toString('utf8')).slice(-256_000); };
    child.stdout!.on('data', append); child.stderr!.on('data', append);
    child.once('error', error => { run.output += error.message; run.exitCode = -1; run.child = null; }); child.once('close', code => { run.exitCode = code; run.child = null; });
    return state(run);
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
