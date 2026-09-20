import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../user-paths', () => ({ homeDir: () => process.env.HOMEBOT_TASK_TEST_HOME! }));

import {
  WorkspaceTaskDiagnosticParser,
  executeWorkspacePackageTask,
  listWorkspacePackageTasks,
  prepareWorkspacePackageTask,
  workspaceTaskConfirmationMessage,
} from '../workspace-tasks';

let home: string;
let project: string;

function manifest(scripts: Record<string, unknown>) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts }));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-task-home-'));
  process.env.HOMEBOT_TASK_TEST_HOME = home;
  project = path.join(home, 'fixture');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'broken.ts'), 'const answer: string = 42;\n');
  manifest({ precheck: 'echo pre', check: 'tsc --noEmit', postcheck: 'echo post' });
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

test('lists only bounded string scripts from a canonical in-home project', () => {
  manifest({ check: 'tsc', ignored: 12 });
  expect(listWorkspacePackageTasks(project)).toMatchObject({
    success: true,
    projectDir: fs.realpathSync.native(project),
    tasks: [{ name: 'check', command: 'tsc' }],
  });
  expect(listWorkspacePackageTasks(path.dirname(home))).toMatchObject({ success: false });
  expect(listWorkspacePackageTasks(path.join(project, '..', '..'))).toMatchObject({ success: false });
});

test('consent snapshot exposes npm lifecycle commands', () => {
  const snapshot = prepareWorkspacePackageTask(project, 'check');
  expect(snapshot.lifecycle).toEqual([
    { name: 'precheck', command: 'echo pre' },
    { name: 'check', command: 'tsc --noEmit' },
    { name: 'postcheck', command: 'echo post' },
  ]);
  expect(workspaceTaskConfirmationMessage(snapshot)).toContain('postcheck: echo post');
});

test('fails closed on over-limit manifests and option-like script names', () => {
  const tooMany = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`task${index}`, 'echo ok']));
  manifest(tooMany);
  expect(listWorkspacePackageTasks(project)).toMatchObject({ success: false, error: expect.stringContaining('500') });
  manifest({ '-evil': 'echo no' });
  expect(() => prepareWorkspacePackageTask(project, '-evil')).toThrow('valid package script');
});

test('fails closed when a valid main script has an oversized lifecycle name', () => {
  const name = 'x'.repeat(198);
  manifest({ [name]: 'echo main', [`pre${name}`]: 'echo hidden pre' });
  expect(listWorkspacePackageTasks(project)).toMatchObject({ success: false, error: expect.stringContaining('200') });
  expect(() => prepareWorkspacePackageTask(project, name)).toThrow('200');
});

test('canonical project validation rejects a junction that escapes home', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-task-outside-'));
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ scripts: { check: 'echo no' } }));
  const link = path.join(home, 'escape');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  expect(listWorkspacePackageTasks(link)).toMatchObject({ success: false, error: expect.stringContaining('home') });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('parses chunked ANSI TypeScript and ESLint output but rejects outside files', () => {
  const parser = new WorkspaceTaskDiagnosticParser(fs.realpathSync.native(project));
  parser.push('stdout', '\u001b[31mbroken.ts(1,7): err');
  parser.push('stdout', 'or TS2322: Wrong type\u001b[0m\n');
  parser.push('stderr', `${path.join(project, 'broken.ts')}\n  1:7  warning  Avoid this  no-test\n`);
  parser.push('stderr', `${path.join(path.dirname(home), 'secret.ts')}(1,1): error TS1: no\n`);
  expect(parser.finish()).toEqual([
    expect.objectContaining({ file: 'broken.ts', line: 1, column: 7, source: 'typescript', code: 'TS2322' }),
    expect.objectContaining({ file: 'broken.ts', line: 1, column: 7, source: 'eslint', code: 'no-test' }),
    expect.objectContaining({ path: '', clickable: false, source: 'typescript', code: 'TS1' }),
  ]);
});

test('keeps missing/outside ESLint stylish diagnostics visible and never reuses a stale header', () => {
  const parser = new WorkspaceTaskDiagnosticParser(fs.realpathSync.native(project));
  const missing = path.join(project, 'missing.ts');
  const outside = path.join(path.dirname(home), 'outside.ts');
  parser.push('stdout', `${missing}\n  2:4  error  Missing file issue  missing-rule\n`);
  parser.push('stdout', `${outside}\n  3:5  warning  Outside issue  outside-rule\n`);
  parser.push('stdout', 'npm banner interrupts the stylish block\n  9:1  error  Must not use outside.ts  stale-rule\n');
  expect(parser.finish()).toEqual([
    expect.objectContaining({ path: '', file: missing, clickable: false, line: 2, code: 'missing-rule' }),
    expect.objectContaining({ path: '', file: outside, clickable: false, line: 3, code: 'outside-rule' }),
  ]);
});

test('rejects pre/post-only changes after consent', async () => {
  const snapshot = prepareWorkspacePackageTask(project, 'check');
  manifest({ precheck: 'changed pre', check: 'tsc --noEmit', postcheck: 'echo post' });
  const spawn = jest.fn();
  await expect(executeWorkspacePackageTask(snapshot, { runner: { command: 'node', argsPrefix: [] }, spawnProcess: spawn })).resolves.toMatchObject({ success: false, error: expect.stringContaining('changed') });
  expect(spawn).not.toHaveBeenCalled();
});

function fakeChild(output: string, closeDelay = 0): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 4242, stdout: new PassThrough(), stderr: new PassThrough() });
  setTimeout(() => {
    (child.stdout as PassThrough).end(output);
    child.emit('close', 2);
  }, closeDelay);
  return child;
}

test('runs exact npm argv without a shell and returns parsed problems', async () => {
  const snapshot = prepareWorkspacePackageTask(project, 'check');
  const spawn = jest.fn(() => fakeChild('broken.ts(1,7): error TS2322: Wrong type\n'));
  const result = await executeWorkspacePackageTask(snapshot, {
    runner: { command: 'node.exe', argsPrefix: ['npm-cli.js'] },
    spawnProcess: spawn,
  });
  expect(spawn).toHaveBeenCalledWith('node.exe', ['npm-cli.js', 'run-script', 'check'], expect.objectContaining({ cwd: fs.realpathSync.native(project), shell: false }));
  expect(result).toMatchObject({ success: true, exitCode: 2, problems: [expect.objectContaining({ line: 1, code: 'TS2322' })] });
});

test('rejects a changed script after consent without spawning', async () => {
  const snapshot = prepareWorkspacePackageTask(project, 'check');
  manifest({ check: 'changed command' });
  const spawn = jest.fn();
  await expect(executeWorkspacePackageTask(snapshot, { runner: { command: 'node', argsPrefix: [] }, spawnProcess: spawn })).resolves.toMatchObject({ success: false, error: expect.stringContaining('changed') });
  expect(spawn).not.toHaveBeenCalled();
});

test('an already-aborted request cannot spawn', async () => {
  const controller = new AbortController();
  controller.abort();
  const spawn = jest.fn();
  await expect(executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
    signal: controller.signal, runner: { command: 'node', argsPrefix: [] }, spawnProcess: spawn,
  })).resolves.toMatchObject({ success: false, cancelled: true });
  expect(spawn).not.toHaveBeenCalled();
});

test('timeout terminates the process tree and does not report success', async () => {
  jest.useFakeTimers();
  const child = fakeChild('', 1500);
  const terminate = jest.fn(() => child.emit('close', null));
  const promise = executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
    runner: { command: 'node', argsPrefix: [] }, spawnProcess: () => child,
    timeoutMs: 1000, terminateProcessTree: terminate,
  });
  jest.advanceTimersByTime(1000);
  await expect(promise).resolves.toMatchObject({ success: false, timedOut: true });
  expect(terminate).toHaveBeenCalledWith(child, process.platform);
  jest.useRealTimers();
});

test('timeout settles even when termination never produces close', async () => {
  jest.useFakeTimers();
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 4243, stdout: new PassThrough(), stderr: new PassThrough() });
  const promise = executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
    runner: { command: 'node', argsPrefix: [] }, spawnProcess: () => child,
    timeoutMs: 1000, terminateProcessTree: jest.fn(),
  });
  await jest.advanceTimersByTimeAsync(1500);
  await expect(promise).resolves.toMatchObject({ success: false, timedOut: true });
  jest.useRealTimers();
});

test('global concurrency cap refuses a fourth project task', async () => {
  const children: ChildProcess[] = [];
  const pending: Array<Promise<unknown>> = [];
  for (let index = 0; index < 4; index++) {
    const dir = path.join(home, `project-${index}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'echo ok' } }));
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { pid: 5000 + index, stdout: new PassThrough(), stderr: new PassThrough() });
    children.push(child);
    const run = executeWorkspacePackageTask(prepareWorkspacePackageTask(dir, 'check'), {
      runner: { command: 'node', argsPrefix: [] }, spawnProcess: () => child,
    });
    if (index < 3) pending.push(run);
    else await expect(run).resolves.toMatchObject({ success: false, error: expect.stringContaining('Too many') });
  }
  children.slice(0, 3).forEach(child => child.emit('close', 0));
  await Promise.all(pending);
});

test('a failed tree termination is visible even if the root process closes', async () => {
  jest.useFakeTimers();
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 6001, stdout: new PassThrough(), stderr: new PassThrough() });
  const promise = executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
    runner: { command: 'node', argsPrefix: [] }, spawnProcess: () => child,
    timeoutMs: 1000, terminateProcessTree: () => false,
  });
  await jest.advanceTimersByTimeAsync(1000);
  child.emit('close', null);
  await expect(promise).resolves.toMatchObject({
    success: false,
    timedOut: true,
    error: expect.stringContaining('could not prove'),
  });
  jest.useRealTimers();
});

const liveTreeTest = process.env.HOMEBOT_LIVE_TASK_TREE === '1' ? test : test.skip;
liveTreeTest('real npm cancellation terminates its disposable parent and grandchild on Windows', async () => {
  if (process.platform !== 'win32') return;
  const pidFile = path.join(project, 'pids.json');
  fs.writeFileSync(path.join(project, 'spawn-tree.cjs'), [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.pid, parentOfParent: process.ppid, child: child.pid }));`,
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  manifest({ check: 'node spawn-tree.cjs' });
  const controller = new AbortController();
  let npmPid: number | undefined;
  let pids: { parent: number; parentOfParent: number; child: number } | undefined;
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  try {
    const running = executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
      signal: controller.signal,
      spawnProcess: (command, args, options) => {
        const child = spawn(command, args, options);
        npmPid = child.pid;
        return child;
      },
    });
    for (let attempt = 0; attempt < 100 && !fs.existsSync(pidFile); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(fs.existsSync(pidFile)).toBe(true);
    pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    expect(npmPid).toBeTruthy();
    expect(new Set([npmPid, pids!.parent, pids!.parentOfParent, pids!.child]).size).toBe(4);
    expect(alive(npmPid!)).toBe(true);
    expect(alive(pids!.parentOfParent)).toBe(true);
    expect(alive(pids!.parent)).toBe(true);
    expect(alive(pids!.child)).toBe(true);

    controller.abort();
    await expect(running).resolves.toMatchObject({ success: false, cancelled: true });
    const treePids = [npmPid!, pids!.parentOfParent, pids!.parent, pids!.child];
    for (let attempt = 0; attempt < 50 && treePids.some(alive); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const pid of treePids) expect(alive(pid)).toBe(false);
  } finally {
    if (!pids && fs.existsSync(pidFile)) pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    const targets = [npmPid, pids?.parentOfParent, pids?.parent, pids?.child].filter((pid): pid is number => !!pid);
    for (const pid of targets) {
      if (alive(pid)) {
        try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* root runner reports exact survivor */ }
      }
    }
  }
}, 30_000);
