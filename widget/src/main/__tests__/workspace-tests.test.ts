jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverWorkspaceTests, performWorkspaceTests, prepareWorkspaceTestCommand, stopWorkspaceTestRuns } from '../workspace-tests';
jest.setTimeout(30_000);
let root: string; let file: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-tests-')); file = path.join(root, 'math.test.js');
  fs.writeFileSync(file, 'const { test, describe, it } = require("node:test");\nconst assert = require("node:assert/strict");\ndescribe("math", () => { it("adds correctly", () => { assert.equal(1 + 2, 3); }); it.skip("disabled", () => {}); });\n// test("fake comment", () => {});\n');
});
afterEach(async () => { await stopWorkspaceTestRuns(); for (let index = 0; index < 50; index++) { if (!(await performWorkspaceTests({ root, action: 'state' })).running) break; await new Promise(resolve => setTimeout(resolve, 20)); } fs.rmSync(root, { recursive: true, force: true }); });
async function finishRun() { for (let index = 0; index < 100; index++) { const state = await performWorkspaceTests({ root, action: 'state' }); if (!state.running) return state; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('The actual test run did not finish.'); }
test('AST discovery excludes commented tests and identifies suite names, runners and skipped declarations', () => {
  const tests = discoverWorkspaceTests(root); expect(tests.map(test => test.name)).toEqual(['math adds correctly', 'math disabled']); expect(tests[0].runner).toBe('node'); expect(tests[1].skipped).toBe(true);
  expect(prepareWorkspaceTestCommand({ root, action: 'run', file, testName: 'math adds correctly' }).args).toContain('^math adds correctly$');
});
test('runs one selected actual Node test, reports a nonzero pass count and collects coverage output', async () => {
  const started = await performWorkspaceTests({ root, action: 'run', file, testName: 'math adds correctly', coverage: true });
  expect(started.success).toBe(true); expect(started.running || started.exitCode === 0).toBe(true);
  const result = await finishRun(); expect(result.exitCode).toBe(0); expect(result.summary?.passed).toBeGreaterThan(0); expect(result.output).toMatch(/coverage|file.*line/i);
  if (process.platform === 'win32') expect(result.cleanupPending).toBe(true);
  expect(await performWorkspaceTests({ root, action: 'stop' })).toMatchObject({ success: true, running: false, cleanupPending: false });
  console.info(JSON.stringify({ selectedTestProof: { selected: 'math adds correctly', exitCode: result.exitCode, ...result.summary, coverageOutput: /coverage|file.*line/i.test(result.output || '') } }));
});
test('Stop terminates an owned long-running test and reports user cancellation', async () => {
  fs.writeFileSync(file, 'const { test } = require("node:test"); test("waits", async () => { await new Promise(resolve => setTimeout(resolve, 30000)); });');
  expect((await performWorkspaceTests({ root, action: 'run', file })).running).toBe(true);
  const stop = await performWorkspaceTests({ root, action: 'stop' }); expect(stop.success).toBe(true);
  const done = await finishRun(); expect(done.note).toBe('Stopped by user.'); expect(done.running).toBe(false);
});
test('does not execute unavailable/skipped names, foreign files or declared missing runner dependencies', async () => {
  expect((await performWorkspaceTests({ root, action: 'run', file, testName: 'not real' })).success).toBe(false);
  expect((await performWorkspaceTests({ root, action: 'run', file, testName: 'math disabled' })).error).toMatch(/skip\/todo/);
  expect((await performWorkspaceTests({ root, action: 'run', file: '../foreign.test.js' })).success).toBe(false);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { jest: '1.0.0' } }));
  fs.writeFileSync(file, 'test("actual test", () => {});');
  expect(() => prepareWorkspaceTestCommand({ root, action: 'run', file })).toThrow(/not installed/);
});

test.each([
  { label: 'configured globals', source: 'test("configured globals", () => {});', configured: true, runner: 'jest' },
  { label: 'explicit Vitest', source: 'import { test } from "vitest"; test("configured globals", () => {});', configured: true, runner: 'vitest' },
  { label: 'explicit Jest', source: 'import { test } from "@jest/globals"; test("configured globals", () => {});', configured: false, runner: 'jest' },
  { label: 'dependency fallback', source: 'test("configured globals", () => {});', configured: false, runner: 'vitest' },
])('selects the correct discovered runner and command for $label when both packages are installed', ({ source, configured, runner }) => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    devDependencies: { jest: '29.7.0', vitest: '3.0.0' },
    ...(configured ? { jest: { testEnvironment: 'node', transform: {} } } : {}),
  }));
  fs.writeFileSync(file, source);
  const jestEntry = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  for (const entry of [jestEntry, vitestEntry]) {
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '// Discovery/command fixture only; never executed.\n');
  }
  expect(discoverWorkspaceTests(root)).toEqual([expect.objectContaining({ name: 'configured globals', runner })]);
  const command = prepareWorkspaceTestCommand({ root, action: 'run', file, testName: 'configured globals' });
  expect(command.cwd).toBe(root);
  expect(command.args[0]).toBe(runner === 'jest' ? jestEntry : vitestEntry);
  expect(command.args).toEqual(runner === 'jest'
    ? [jestEntry, '--runInBand', '--watch=false', '--runTestsByPath', file, '--testNamePattern', '^configured globals$']
    : [vitestEntry, 'run', file, '-t', '^configured globals$']);
});
