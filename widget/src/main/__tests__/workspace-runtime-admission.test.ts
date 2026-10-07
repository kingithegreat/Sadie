import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { setWorkspaceRuntimeClosing } from '../workspace-runtime-admission';
import { WorkspacePtySessions } from '../workspace-terminal-pty';
import { performWorkspaceDebug, stopWorkspaceDebuggers } from '../workspace-debug';
import { performWorkspaceTests, stopWorkspaceTestRuns } from '../workspace-tests';
import { executeWorkspacePackageTask, prepareWorkspacePackageTask } from '../workspace-tasks';

jest.mock('electron', () => ({ app: { getPath: () => require('os').tmpdir() } }));
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn(() => { throw new Error('Unexpected process spawn'); }) }));
jest.setTimeout(15_000);
let root: string;
beforeEach(() => {
  jest.clearAllMocks(); setWorkspaceRuntimeClosing(false);
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-admission-'));
  fs.writeFileSync(path.join(root, 'main.js'), 'console.log("debug fixture");\n');
  fs.writeFileSync(path.join(root, 'sample.test.js'), 'const { test } = require("node:test"); test("sample", () => {});\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node main.js' } }));
});
afterEach(async () => {
  setWorkspaceRuntimeClosing(false);
  await stopWorkspaceDebuggers(); await stopWorkspaceTestRuns();
  fs.rmSync(root, { recursive: true, force: true });
});

function terminalFixture() {
  let exited!: (event: { exitCode: number }) => void;
  const pty = { pid: 12345, write: jest.fn(), resize: jest.fn(), kill: jest.fn(() => exited({ exitCode: 0 })), onData: jest.fn(() => ({ dispose: jest.fn() })), onExit: jest.fn(callback => { exited = callback; return { dispose: jest.fn() }; }) };
  const create = jest.fn(() => pty);
  const sessions = new WorkspacePtySessions(create, () => [{ id: 'cmd', label: 'Fixture shell', executable: 'cmd.exe' }], { capture: async () => ({ creation: '638953000000000000', parent: process.pid }), stopped: async () => true });
  return { create, sessions, pty };
}

test('whole-quit admission rejects valid new runtime requests before any process spawner is reached', async () => {
  const terminal = terminalFixture(); const taskSpawner = jest.fn();
  const snapshot = prepareWorkspacePackageTask(root, 'check');
  expect((await performWorkspaceTests({ root, action: 'list' })).tests).toHaveLength(1);
  setWorkspaceRuntimeClosing(true);
  expect(() => terminal.sessions.create(7, { projectDir: root, profileId: 'cmd' }, jest.fn())).toThrow(/HomeBot is closing/);
  expect(await performWorkspaceDebug({ root, action: 'start', file: path.join(root, 'main.js') })).toMatchObject({ success: false, error: expect.stringMatching(/HomeBot is closing/) });
  expect(await performWorkspaceTests({ root, action: 'run', file: path.join(root, 'sample.test.js') })).toMatchObject({ success: false, error: expect.stringMatching(/HomeBot is closing/) });
  expect(await executeWorkspacePackageTask(snapshot, { spawnProcess: taskSpawner })).toMatchObject({ success: false, error: expect.stringMatching(/HomeBot is closing/) });
  expect(terminal.create).not.toHaveBeenCalled(); expect(taskSpawner).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  // Inspection remains reachable while starts are paused.
  expect((await performWorkspaceTests({ root, action: 'list' })).tests).toHaveLength(1);
  expect((await performWorkspaceDebug({ root, action: 'state' })).running).toBe(false);
});

test('existing runtime cleanup still works while closing and refusal can admit a fresh terminal', async () => {
  const terminal = terminalFixture();
  const first = terminal.sessions.create(7, { projectDir: root, profileId: 'cmd' }, jest.fn());
  setWorkspaceRuntimeClosing(true);
  await terminal.sessions.close(7, first.id);
  expect(terminal.pty.kill).toHaveBeenCalledTimes(1);
  expect(() => terminal.sessions.create(7, { projectDir: root, profileId: 'cmd' }, jest.fn())).toThrow(/HomeBot is closing/);
  setWorkspaceRuntimeClosing(false);
  const second = terminal.sessions.create(7, { projectDir: root, profileId: 'cmd' }, jest.fn());
  expect(terminal.create).toHaveBeenCalledTimes(2);
  await terminal.sessions.close(7, second.id);
});
