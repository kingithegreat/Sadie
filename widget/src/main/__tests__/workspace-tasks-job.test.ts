import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workspacePtyLifecycle } from '../workspace-pty-identity';
import type { WorkspaceApprovedLaunch } from '../workspace-windows-job';
jest.mock('../user-paths', () => ({ homeDir: () => process.env.HOMEBOT_JOB_TASK_HOME! }));
jest.mock('electron', () => ({ app: { getPath: () => process.env.HOMEBOT_JOB_TASK_PROFILE! } }));
import { executeWorkspacePackageTask, prepareWorkspacePackageTask, stopWorkspaceTask, closeAllWorkspaceTasks } from '../workspace-tasks';

let home: string, project: string;
const owned: Array<{ job: { stop: jest.Mock }; finish: () => void }> = [];
const original = { creation: '639269357577651780', parent: process.pid };
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-job-task-')); process.env.HOMEBOT_JOB_TASK_HOME = home;
  process.env.HOMEBOT_JOB_TASK_PROFILE = path.join(home, 'profile');
  project = path.join(home, 'project'); fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { check: 'echo approved' } }));
  jest.spyOn(workspacePtyLifecycle, 'capture').mockResolvedValue(original);
});
afterEach(async () => {
  for (const entry of owned.splice(0)) { entry.job.stop.mockResolvedValue(undefined); entry.finish(); }
  await closeAllWorkspaceTasks(); jest.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true });
});
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: 4501, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess;
  let ended = false;
  const finish = () => { if (!ended) { ended = true; child.emit('close', 0); } };
  child.kill = jest.fn(() => { finish(); return true; });
  const job = { listening: Promise.resolve(), ready: Promise.resolve(), attach: jest.fn(async () => {}),
    authorize: jest.fn(async (_launch: WorkspaceApprovedLaunch, validate?: () => void) => { validate?.(); return 4502; }),
    queryEmpty: jest.fn(async () => true), stop: jest.fn(async () => { finish(); }) };
  const spawn = jest.fn(() => child), factory = jest.fn(() => job);
  const run = (id = 'owner:task', validateAuthority?: () => void) => executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
    taskId: id, platform: 'win32', runner: { command: 'approved-node.exe', argsPrefix: ['approved-npm.js'] },
    spawnProcess: spawn, createWindowsJob: factory, longRunning: true, validateAuthority,
  });
  const value = { child, finish, job, spawn, factory, run }; owned.push(value); return value;
}

test('Windows executes only a fixed bootstrap, then main-approved target after identity and Job assignment', async () => {
  const app = fixture(); const run = app.run(); await settle();
  expect(app.spawn).toHaveBeenCalledWith(process.execPath, ['-e', expect.stringContaining("require('node:net')")], expect.objectContaining({ cwd: fs.realpathSync.native(project), env: expect.objectContaining({ NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1' }) }));
  expect(app.job.attach).toHaveBeenCalledWith(4501, original);
  expect(app.job.authorize).toHaveBeenCalledWith(expect.objectContaining({ executable: 'approved-node.exe', args: ['approved-npm.js', 'run-script', 'check'], kind: 'task' }), expect.any(Function));
  app.finish(); await expect(run).resolves.toMatchObject({ success: true, cleanupPending: false, exitCode: 0 });
});
test('a partial UTF8 environment overlay inherits npm discovery PATH and reaches the approved target', async () => {
  const bin = path.join(home, 'fixed-node-bin'), npmCli = path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(npmCli), { recursive: true });
  fs.writeFileSync(path.join(bin, 'node.exe'), 'unused mocked executable'); fs.writeFileSync(npmCli, '// unused mocked CLI');
  const saved = { PATH: process.env.PATH, Path: process.env.Path, ProgramFiles: process.env.ProgramFiles };
  process.env.PATH = bin; process.env.Path = bin; delete process.env.ProgramFiles;
  try {
    const app = fixture(), canary = '\u4e00\ud83d\udd27\u00e9';
    const run = executeWorkspacePackageTask(prepareWorkspacePackageTask(project, 'check'), {
      taskId: 'owner:env-overlay', platform: 'win32', env: { HOMEBOT_UTF8_JOB_CANARY: canary },
      spawnProcess: app.spawn, createWindowsJob: app.factory, longRunning: true,
    });
    await settle();
    expect(app.job.authorize).toHaveBeenCalledTimes(1);
    const launch = app.job.authorize.mock.calls[0][0];
    expect({ executable: launch.executable, args: launch.args, inheritedPath: launch.env.Path || launch.env.PATH, canary: launch.env.HOMEBOT_UTF8_JOB_CANARY }).toEqual({
      executable: fs.realpathSync.native(path.join(bin, 'node.exe')),
      args: [fs.realpathSync.native(npmCli), 'run-script', 'check'],
      inheritedPath: bin, canary,
    });
    expect(app.spawn).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({ env: expect.objectContaining({ NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1' }) }));
    app.finish(); await expect(run).resolves.toMatchObject({ success: true, exitCode: 0, cleanupPending: false });
  } finally {
    for (const key of ['PATH', 'Path', 'ProgramFiles'] as const) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('a completed launcher retains background ownership and exact-task Stop retry survives root exit', async () => {
  const app = fixture(); app.job.queryEmpty.mockResolvedValue(false);
  const run = app.run('owner:old'); await settle(); app.finish();
  await expect(run).resolves.toMatchObject({ success: true, cleanupPending: true });
  expect(app.job.stop).not.toHaveBeenCalled();
  app.job.stop.mockRejectedValueOnce(new Error('unverified Job'));
  expect(await stopWorkspaceTask('owner:old')).toBe(false); expect(await stopWorkspaceTask('owner:old')).toBe(true);
  expect(app.factory).toHaveBeenCalledTimes(1); expect(workspacePtyLifecycle.capture).toHaveBeenCalledTimes(1);
  const replacement = fixture(); const replacementRun = replacement.run('owner:new'); await settle();
  expect(await stopWorkspaceTask('owner:old')).toBe(true); expect(replacement.job.stop).not.toHaveBeenCalled();
  replacement.finish(); await replacementRun;
});

test('unknown accounting retains cleanup rather than treating root exit as tree-empty', async () => {
  const app = fixture(); app.job.queryEmpty.mockRejectedValue(new Error('query failed'));
  const run = app.run(); await settle(); app.finish();
  await expect(run).resolves.toMatchObject({ cleanupPending: true, error: expect.stringContaining('unverified') });
  expect(app.job.stop).not.toHaveBeenCalled(); expect(await stopWorkspaceTask('owner:task')).toBe(true);
});

test('changed manifest at the final GO fence refuses execution and joins retained bootstrap cleanup', async () => {
  const app = fixture(); app.job.authorize.mockImplementationOnce(async (_launch: WorkspaceApprovedLaunch, validate?: () => void) => {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { check: 'changed after readiness' } }));
    validate?.(); return 4502;
  });
  await expect(app.run()).resolves.toMatchObject({ success: false, cleanupPending: false, error: expect.stringContaining('changed before execution') });
  expect(app.job.stop).toHaveBeenCalledTimes(1);
});

test('a replaced originating frame is checked after readiness before target execution', async () => {
  const app = fixture();
  await expect(app.run('owner:frame', () => { throw new Error('frame authority changed'); })).resolves.toMatchObject({ success: false, error: 'frame authority changed', cleanupPending: false });
  expect(app.job.stop).toHaveBeenCalledTimes(1);
});

test('quit joins pending assignment, fences its later GO, and waits for Job cleanup proof', async () => {
  const app = fixture(); let assigned!: () => void;
  app.job.attach.mockImplementationOnce(() => new Promise<void>(resolve => { assigned = resolve; }));
  const run = app.run(); await settle(); let complete = false;
  const closing = closeAllWorkspaceTasks().then(() => { complete = true; });
  await settle(); expect(complete).toBe(false); assigned();
  await closing; await expect(run).resolves.toMatchObject({ success: false, cancelled: true, cleanupPending: false });
  expect(app.job.authorize).not.toHaveBeenCalled(); expect(app.job.stop).toHaveBeenCalledTimes(1);
  expect(app.child.kill).toHaveBeenCalledTimes(1);
});

test('failed assignment joins its exact unreleased launcher even while Job cleanup remains uncertain', async () => {
  const app = fixture(); app.job.attach.mockRejectedValueOnce(new Error('assignment failed'));
  app.job.stop.mockRejectedValueOnce(new Error('Job unverified'));
  await expect(app.run()).resolves.toMatchObject({ success: false, cleanupPending: true, error: 'assignment failed' });
  expect(app.child.kill).toHaveBeenCalledTimes(1); expect(app.job.authorize).not.toHaveBeenCalled();
  expect(await stopWorkspaceTask('owner:task')).toBe(true);
});
