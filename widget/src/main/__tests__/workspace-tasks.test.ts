import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
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

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

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
  jest.advanceTimersByTime(3000);
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
