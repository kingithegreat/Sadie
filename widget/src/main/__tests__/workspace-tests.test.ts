jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const nativeFs: typeof import('fs') = jest.requireActual('fs');
import { discoverWorkspaceTests, performWorkspaceTests, prepareWorkspaceTestCommand, stopWorkspaceTestRuns } from '../workspace-tests';
jest.setTimeout(30_000);
let root: string; let file: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-tests-')); file = path.join(root, 'math.test.js');
  fs.writeFileSync(file, 'const { test, describe, it } = require("node:test");\nconst assert = require("node:assert/strict");\ndescribe("math", () => { it("adds correctly", () => { assert.equal(1 + 2, 3); }); it.skip("disabled", () => {}); });\n// test("fake comment", () => {});\n');
});
afterEach(async () => { jest.restoreAllMocks(); await stopWorkspaceTestRuns(); for (let index = 0; index < 50; index++) { if (!(await performWorkspaceTests({ root, action: 'state' })).running) break; await new Promise(resolve => setTimeout(resolve, 20)); } fs.rmSync(root, { recursive: true, force: true }); });
async function finishRun() { for (let index = 0; index < 100; index++) { const state = await performWorkspaceTests({ root, action: 'state' }); if (!state.running) return state; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('The actual test run did not finish.'); }
test('AST discovery excludes commented tests and identifies suite names, runners and skipped declarations', () => {
  const tests = discoverWorkspaceTests(root); expect(tests.map(test => test.name)).toEqual(['math adds correctly', 'math disabled']); expect(tests[0].runner).toBe('node'); expect(tests[1].skipped).toBe(true);
  expect(prepareWorkspaceTestCommand({ root, action: 'run', file, testName: 'math adds correctly' }).args).toContain('^math adds correctly$');
});

function bothInstalled(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ devDependencies: { jest: '30.5.0', vitest: '3.0.0' } }));
  for (const entry of ['node_modules/jest/bin/jest.js', 'node_modules/vitest/vitest.mjs']) {
    const target = path.join(directory, entry); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// Prepared-command fixture; never executed.\n');
  }
}
test.each(['js', 'ts', 'mjs', 'mts', 'cjs', 'cts', 'json'])('recognizes file-based jest.config.%s without reading or executing it', extension => {
  bothInstalled(root); const config = path.join(root, `jest.config.${extension}`);
  fs.writeFileSync(config, 'throw new Error("Configuration must never execute during discovery");');
  fs.writeFileSync(file, 'test("configured globals", () => {});');
  const reads = jest.spyOn(nativeFs, 'readFileSync');
  expect(discoverWorkspaceTests(root)[0].runner).toBe('jest');
  const command = prepareWorkspaceTestCommand({ root, action: 'run', file, testName: 'configured globals' });
  expect(command.cwd).toBe(root);
  expect(command.args).toEqual([path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--watch=false', '--runTestsByPath', file, '--testNamePattern', '^configured globals$']);
  expect(reads.mock.calls.some(call => String(call[0]) === config)).toBe(false);
});
test.each(['vitest', '@jest/globals', 'node:test'])('explicit %s imports retain precedence over a file-based Jest config', runner => {
  bothInstalled(root); fs.writeFileSync(path.join(root, 'jest.config.js'), 'throw new Error("Never load");');
  fs.writeFileSync(file, `import { test } from "${runner}"; test("configured globals", () => {});`);
  const command = prepareWorkspaceTestCommand({ root, action: 'run', file });
  expect(discoverWorkspaceTests(root)[0].runner).toBe(runner === '@jest/globals' ? 'jest' : runner === 'node:test' ? 'node' : 'vitest');
  expect(command.args[0]).toBe(runner === '@jest/globals' ? path.join(root, 'node_modules/jest/bin/jest.js') : runner === 'node:test' ? '--test' : path.join(root, 'node_modules/vitest/vitest.mjs'));
});
test.each([
  { source: 'const {test}=require("@jest/globals");', configured: false, runner: 'jest' },
  { source: 'const test=require("@jest/globals").test;', configured: false, runner: 'jest' },
  { source: 'const {test}=require("vitest");', configured: true, runner: 'vitest' },
  { source: 'const {test}=require("node:test");', configured: true, runner: 'node' },
  { source: 'import {test} from "vitest"; const jestGlobals=require("@jest/globals");', configured: true, runner: 'vitest' },
  { source: '// require("@jest/globals")\n', configured: false, runner: 'vitest' },
  { source: 'const text="require(\'@jest/globals\')";', configured: false, runner: 'vitest' },
  { source: 'const moduleName="@jest/globals";const {test}=require(moduleName);', configured: false, runner: 'vitest' },
  { source: 'const entry=require.resolve("@jest/globals");', configured: false, runner: 'vitest' },
  { source: 'const {test}=loader.require("@jest/globals");', configured: false, runner: 'vitest' },
])('selects $runner from static CommonJS calls without executing project code: $source', ({ source, configured, runner }) => {
  bothInstalled(root);
  if (configured) fs.writeFileSync(path.join(root, 'jest.config.js'), 'throw new Error("Never load configuration");');
  fs.writeFileSync(file, `${source}\ntest("configured globals", () => {});throw new Error("Never execute test module");`);
  expect(discoverWorkspaceTests(root)[0].runner).toBe(runner);
  const command = prepareWorkspaceTestCommand({ root, action: 'run', file, testName: 'configured globals' });
  expect(command.cwd).toBe(root);
  expect(command.args).toEqual(runner === 'jest'
    ? [path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--watch=false', '--runTestsByPath', file, '--testNamePattern', '^configured globals$']
    : runner === 'node' ? ['--test', '--test-name-pattern', '^configured globals$', file]
    : [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', file, '-t', '^configured globals$']);
});
test('nearest package config and command cwd are used without inheriting another monorepo package config', () => {
  bothInstalled(root); fs.writeFileSync(path.join(root, 'jest.config.js'), 'throw new Error("Parent config");');
  const packageRoot = path.join(root, 'packages', 'ui'); bothInstalled(packageRoot);
  file = path.join(packageRoot, 'ui.test.js'); fs.writeFileSync(file, 'test("nested globals", () => {});');
  expect(discoverWorkspaceTests(root).find(test => test.path === file)?.runner).toBe('vitest');
  expect(prepareWorkspaceTestCommand({ root, action: 'run', file }).cwd).toBe(packageRoot);
  fs.writeFileSync(path.join(packageRoot, 'jest.config.ts'), 'throw new Error("Child config");');
  expect(discoverWorkspaceTests(root).find(test => test.path === file)?.runner).toBe('jest');
  expect(prepareWorkspaceTestCommand({ root, action: 'run', file }).args[0]).toBe(path.join(packageRoot, 'node_modules/jest/bin/jest.js'));
});
test('config-looking directories and oversized files do not select a runner', () => {
  bothInstalled(root); fs.writeFileSync(file, 'test("configured globals", () => {});');
  fs.mkdirSync(path.join(root, 'jest.config.js'));
  fs.writeFileSync(path.join(root, 'jest.config.ts'), Buffer.alloc(1024 * 1024 + 1));
  expect(discoverWorkspaceTests(root)[0].runner).toBe('vitest');
});
test('symlink or canonically redirected config metadata does not select a runner or read its bytes', () => {
  bothInstalled(root); fs.writeFileSync(file, 'test("configured globals", () => {});');
  const config = path.join(root, 'jest.config.js'); fs.writeFileSync(config, 'throw new Error("Never load");');
  const originalStat = nativeFs.lstatSync, originalRealpath = nativeFs.realpathSync;
  const stat = jest.spyOn(nativeFs, 'lstatSync').mockImplementation(((input: any, options: any) => {
    const actual = originalStat(input, options); if (String(input) !== config) return actual;
    return Object.assign(Object.create(actual), { isSymbolicLink: () => true });
  }) as any);
  const reads = jest.spyOn(nativeFs, 'readFileSync');
  expect(discoverWorkspaceTests(root)[0].runner).toBe('vitest');
  stat.mockRestore();
  jest.spyOn(nativeFs, 'realpathSync').mockImplementation(((input: any, options: any) => String(input) === config ? path.join(path.dirname(root), 'outside-config.js') : originalRealpath(input, options)) as any);
  expect(discoverWorkspaceTests(root)[0].runner).toBe('vitest');
  expect(reads.mock.calls.some(call => String(call[0]) === config)).toBe(false);
});
test('config detection never inspects an enclosing directory outside the chosen project', () => {
  bothInstalled(root); fs.writeFileSync(file, 'test("configured globals", () => {});');
  const stats = jest.spyOn(nativeFs, 'lstatSync');
  expect(prepareWorkspaceTestCommand({ root, action: 'run', file }).args[0]).toBe(path.join(root, 'node_modules/vitest/vitest.mjs'));
  expect(stats.mock.calls.some(call => path.basename(String(call[0])).startsWith('jest.config.') && path.dirname(String(call[0])) !== root)).toBe(false);
});
test('file-based config recognition matches native Windows filename case behavior', () => {
  bothInstalled(root); fs.writeFileSync(file, 'test("configured globals", () => {});');
  const name = process.platform === 'win32' ? 'Jest.Config.JS' : 'jest.config.js';
  fs.writeFileSync(path.join(root, name), 'throw new Error("Never load config");');
  expect(discoverWorkspaceTests(root)[0].runner).toBe('jest');
  expect(prepareWorkspaceTestCommand({ root, action: 'run', file }).args[0]).toBe(path.join(root, 'node_modules/jest/bin/jest.js'));
});
test('canonical filename case is accepted only on Windows without accepting another target', () => {
  bothInstalled(root); fs.writeFileSync(file, 'test("configured globals", () => {});');
  const config = path.join(root, 'jest.config.js'); fs.writeFileSync(config, 'throw new Error("Never load config");');
  const original = nativeFs.realpathSync;
  jest.spyOn(nativeFs, 'realpathSync').mockImplementation(((input: any, options: any) => String(input) === config ? path.join(root, 'Jest.Config.JS') : original(input, options)) as any);
  expect(discoverWorkspaceTests(root)[0].runner).toBe(process.platform === 'win32' ? 'jest' : 'vitest');
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
