import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performWorkspaceDebug, stopWorkspaceDebuggers } from '../workspace-debug';
jest.setTimeout(30_000);
let root: string; let file: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.homedir(), 'hb-debug-')); file = path.join(root, 'main.js'); fs.writeFileSync(file, 'let count = 1;\ncount += 2;\nconsole.log("RESULT", count);\ncount += 1;\n'); });
afterEach(async () => { await stopWorkspaceDebuggers(); fs.rmSync(root, { recursive: true, force: true }); });
const call = (action: Parameters<typeof performWorkspaceDebug>[0]['action'], extra = {}) => performWorkspaceDebug({ root, action, ...extra });
async function waitForPaused(expectedLine?: number) {
  let lastLine: number | undefined;
  for (let attempts = 0; attempts < 50; attempts++) {
    const state = await call('state');
    if (!state.success || !state.running) throw new Error(state.error || 'The actual debug program exited before its requested pause.');
    lastLine = state.frames?.[0]?.line;
    // A resume response can arrive before Debugger.resumed. Do not mistake
    // the old entry pause for the subsequently requested breakpoint event.
    if (state.paused && (expectedLine === undefined || (state.frames?.[0]?.path === file && lastLine === expectedLine))) return state;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`The actual program never paused${expectedLine === undefined ? '' : ` at ${file}:${expectedLine}`}. Last top-frame line: ${lastLine}.`);
}
test('real Node inspector pauses, steps, watches, shows variables and executes output', async () => {
  const started = await call('start', { file }); expect(started.success).toBe(true);
  const childPid = started.pid!; expect(Number.isInteger(childPid)).toBe(true); expect(childPid).not.toBe(process.pid);
  let state = await waitForPaused(); expect(state.frames?.some(frame => frame.path === file)).toBe(true);
  expect((await call('breakpoint', { file, line: 3 })).success).toBe(true);
  expect((await call('resume')).success).toBe(true);
  state = await waitForPaused(3); expect(state.frames?.[0].line).toBe(3);
  expect((await call('evaluate', { expression: 'count' })).value).toBe('3');
  expect((await call('scopes')).variables?.some(variable => variable.name.endsWith('.count') && variable.value === '3')).toBe(true);
  expect((await call('step-over')).success).toBe(true);
  state = await waitForPaused(4); expect(state.frames?.[0].line).toBeGreaterThan(3);
  for (let index = 0; index < 50; index++) { state = await call('state'); if (state.output?.includes('RESULT 3')) break; await new Promise(resolve => setTimeout(resolve, 30)); }
  expect(state.output).toContain('RESULT 3');
  expect((await call('stop')).running).toBe(false);
  expect(() => process.kill(childPid, 0)).toThrow();
  console.info(JSON.stringify({ debuggerProof: { childPid, pausedAt: 3, watchValue: 3, output: 'RESULT 3', stopProcessGone: true } }));
});
test('refuses unrelated scripts, unsupported runtimes, invalid breakpoints, and evaluation while running', async () => {
  expect((await call('start', { file: path.join(root, '..', 'other.js') })).success).toBe(false);
  const python = path.join(root, 'test.py'); fs.writeFileSync(python, 'print(1)');
  expect((await call('start', { file: python })).error).toMatch(/supports JavaScript Node/);
  expect((await call('breakpoint', { file, line: -1 })).success).toBe(false);
  expect((await call('evaluate', { expression: '1 + 1' })).error).toMatch(/Start|Pause/);
});
test('a program exiting without Stop clears installed points; restart installs and hits a fresh breakpoint', async () => {
  // The first program reaches real inspector completion. Windows releases the
  // frontend after tree capture; POSIX cleans its owned group at that boundary.
  // User-emitted prose must not detach the later live program prematurely.
  fs.writeFileSync(file, 'let count = 1;\ncount += 2;\nprocess.stderr.write("Waiting for the debugger to disconnect...\\n");\nconsole.log("RESTART", count);\nif (!process.argv.includes("--end-without-stop")) setInterval(() => {}, 1000);\n');
  const first = await call('start', { file, args: ['--end-without-stop'] }); expect(first.success).toBe(true);
  const firstPid = first.pid!; expect(Number.isInteger(firstPid)).toBe(true);
  await waitForPaused();
  const duplicate = await call('start', { file }); expect(duplicate.error).toMatch(/Stop the current/);
  expect(await call('state')).toEqual(expect.objectContaining({ running: true, paused: true, pid: firstPid }));
  const installed = await call('breakpoint', { file, line: 2 }); expect(installed.success).toBe(true); expect(installed.breakpoints).toEqual([{ path: file, line: 2 }]);
  expect((await call('resume')).success).toBe(true); await waitForPaused(2);
  expect((await call('resume')).success).toBe(true);
  let ended = await call('state');
  // Allow the existing 4,500ms read-only capture bound to finish before the
  // same natural-leader-exit assertions; this changes only fixture polling.
  for (let attempt = 0; ended.running && attempt < 200; attempt++) { await new Promise(resolve => setTimeout(resolve, 30)); ended = await call('state'); }
  expect(ended).toEqual(expect.objectContaining({ success: true, running: false, paused: false, frames: [], breakpoints: [] }));
  expect(ended.output).toContain('RESTART 3');
  expect(() => process.kill(firstPid, 0)).toThrow();
  const second = await call('start', { file }); expect(second.success).toBe(true); expect(second.pid).not.toBe(firstPid); expect(second.breakpoints).toEqual([]);
  await waitForPaused();
  const fresh = await call('breakpoint', { file, line: 4 }); expect(fresh.success).toBe(true); expect(fresh.breakpoints).toEqual([{ path: file, line: 4 }]);
  expect((await call('resume')).success).toBe(true); const paused = await waitForPaused(4); expect(paused.frames?.[0]?.path).toBe(file);
  expect((await call('evaluate', { expression: 'count' })).value).toBe('3');
  const secondPid = second.pid!; expect((await call('stop')).running).toBe(false); expect(() => process.kill(secondPid, 0)).toThrow();
  console.info(JSON.stringify({ debuggerRestartProof: { firstPid, exitedWithoutStop: true, completionCleanup: process.platform === 'win32' ? 'captured tree before natural leader exit' : 'owned group signaled at inspector completion', emptyPointsAfterExit: true, secondPid, freshBreakpointLine: 4, watchValue: 3, stoppedSecondChildGone: true } }));
});

test('completed debug roots free the live limit while retained cleanup remains available across three projects', async () => {
  const results: Array<{ project: string; pid: number }> = [];
  for (let index = 0; index < 3; index++) {
    const project = path.join(root, `project-${index}`); fs.mkdirSync(project);
    const entry = path.join(project, 'main.js'); fs.writeFileSync(entry, 'console.log("COMPLETED");\n');
    const started = await performWorkspaceDebug({ root: project, action: 'start', file: entry }); expect(started.success).toBe(true);
    let state = await performWorkspaceDebug({ root: project, action: 'state' });
    for (let attempt = 0; !state.paused && attempt < 100; attempt++) { await new Promise(resolve => setTimeout(resolve, 30)); state = await performWorkspaceDebug({ root: project, action: 'state' }); }
    expect(state.paused).toBe(true); expect((await performWorkspaceDebug({ root: project, action: 'resume' })).success).toBe(true);
    for (let attempt = 0; state.running && attempt < 200; attempt++) { await new Promise(resolve => setTimeout(resolve, 30)); state = await performWorkspaceDebug({ root: project, action: 'state' }); }
    expect(state.running).toBe(false); expect(state.output).toContain('COMPLETED');
    if (process.platform === 'win32') expect(state.cleanupPending).toBe(true);
    results.push({ project, pid: started.pid! });
  }
  await stopWorkspaceDebuggers();
  for (const { project, pid } of results) { expect(() => process.kill(pid, 0)).toThrow(); expect((await performWorkspaceDebug({ root: project, action: 'state' })).cleanupPending).not.toBe(true); }
  console.info(JSON.stringify({ debugLiveLimitProof: { completedProjects: results, confirmedCleanup: true } }));
});

test('completion preserves descendant cleanup authority and Stop leaves an unrelated owned program alive', async () => {
  // This control is a separately held ChildProcess, never selected by the debug
  // tree receipt or by process enumeration based on a guessed executable name.
  const unrelated = spawn(process.execPath, ['-e', 'console.log("UNRELATED_READY");setInterval(() => {},1000)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' } });
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Unrelated positive control did not start.')), 5000); unrelated.stdout!.once('data', () => { clearTimeout(timer); resolve(); }); unrelated.once('error', error => { clearTimeout(timer); reject(error); }); });
    fs.writeFileSync(file, 'const { spawn } = require("child_process");\nconst descendant = spawn(process.execPath, ["-e", "setInterval(() => {},1000)"], { stdio: "ignore" });\ndescendant.unref();\nconsole.log("DESCENDANT", descendant.pid);\nsetTimeout(() => console.log("PARENT_FINISHED"), 150);\n');
    const started = await call('start', { file }); expect(started.success).toBe(true); await waitForPaused(); expect((await call('resume')).success).toBe(true);
    let ended = await call('state');
    for (let attempt = 0; ended.running && attempt < 200; attempt++) { await new Promise(resolve => setTimeout(resolve, 30)); ended = await call('state'); }
    expect(ended.running).toBe(false); expect(ended.output).toContain('PARENT_FINISHED');
    const match = /DESCENDANT (\d+)/.exec(ended.output || ''); expect(match).not.toBeNull(); const descendantPid = Number(match![1]);
    expect(descendantPid).toBeGreaterThan(0); expect(descendantPid).not.toBe(unrelated.pid);
    if (process.platform === 'win32') { expect(ended.cleanupPending).toBe(true); expect(() => process.kill(descendantPid, 0)).not.toThrow(); }
    const stopped = await call('stop'); expect(stopped.success).toBe(true); expect(stopped.cleanupPending).not.toBe(true);
    expect(() => process.kill(descendantPid, 0)).toThrow(); expect(unrelated.exitCode).toBeNull(); expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    console.info(JSON.stringify({ debugDescendantProof: { leaderPid: started.pid, descendantPid, descendantGone: true, unrelatedPid: unrelated.pid, unrelatedAlive: true, completionCleanup: process.platform === 'win32' ? 'retained Windows identities' : 'group cleanup at pre-exit boundary' } }));
  } finally {
    if (unrelated.exitCode === null && unrelated.signalCode === null) {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Owned unrelated control did not confirm cleanup.')), 5000); unrelated.once('close', () => { clearTimeout(timer); resolve(); }); unrelated.kill(); });
    }
  }
});
jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
