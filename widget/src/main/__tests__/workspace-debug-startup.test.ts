import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performWorkspaceDebug, stopWorkspaceDebuggers } from '../workspace-debug';
import { stopWorkspaceChild } from '../workspace-owned-process';
import { createWorkspaceWindowsJob } from '../workspace-windows-job';
import { workspacePtyLifecycle } from '../workspace-pty-identity';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../workspace-owned-process', () => ({ rememberWorkspaceChild: jest.fn(), stopWorkspaceChild: jest.fn(async (child: EventEmitter) => { child.emit('exit', 0); }) }));
jest.mock('../workspace-trust', () => ({ validateTrustedWorkspaceRoot: (root: string) => root, checkedTrustedWorkspacePath: (_root: string, file: string) => file }));
jest.mock('../workspace-pty-identity', () => ({ workspacePtyLifecycle: { capture: jest.fn(async () => ({ creation: '638953000000000000', parent: process.pid })) } }));
jest.mock('../workspace-windows-job', () => ({ createWorkspaceWindowsJob: jest.fn() }));
jest.setTimeout(15_000);

class ControlledSocket {
  static OPEN = 1;
  static instances: ControlledSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Array<{ fn: (event: any) => void; once?: boolean }>>();
  constructor(readonly url: string) { ControlledSocket.instances.push(this); }
  addEventListener(type: string, fn: (event: any) => void, options?: { once?: boolean }) { this.listeners.set(type, [...(this.listeners.get(type) || []), { fn, once: options?.once }]); }
  dispatch(type: string, event: any = {}) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter(entry => !entry.once));
    for (const entry of entries) entry.fn(event);
  }
  open() { this.readyState = ControlledSocket.OPEN; this.dispatch('open'); }
  send(text: string) { this.sent.push(text); const message = JSON.parse(text); queueMicrotask(() => this.dispatch('message', { data: JSON.stringify({ id: message.id, result: {} }) })); }
  close() { this.readyState = 3; this.dispatch('close'); }
}
let root: string; let file: string; let originalSocket: typeof WebSocket;
const originalPlatform = process.platform;
const children: Array<EventEmitter & { pid: number; stderr: EventEmitter; stdout: EventEmitter }> = [];
const jobs: Array<{ ready: Promise<void>; queryEmpty: jest.Mock; stop: jest.Mock }> = [];
const tick = () => new Promise(resolve => setImmediate(resolve));
const call = (action: 'start' | 'state' | 'stop' | 'breakpoint', extra = {}) => performWorkspaceDebug({ root, action, ...extra });
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  jest.clearAllMocks(); ControlledSocket.instances = []; children.length = 0; jobs.length = 0;
  (stopWorkspaceChild as jest.Mock).mockImplementation(async (child: EventEmitter) => { child.emit('exit', 0); });
  (workspacePtyLifecycle.capture as jest.Mock).mockResolvedValue({ creation: '638953000000000000', parent: process.pid });
  (createWorkspaceWindowsJob as jest.Mock).mockImplementation(pid => { const child = children.find(child => child.pid === pid)!; const job = { ready: Promise.resolve(), queryEmpty: jest.fn().mockResolvedValue(false), stop: jest.fn(async () => { await stopWorkspaceChild(child as any); }) }; jobs.push(job); return job; });
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-debug-startup-')); file = path.join(root, 'main.js'); fs.writeFileSync(file, 'console.log("fixture");\n');
  originalSocket = global.WebSocket; global.WebSocket = ControlledSocket as unknown as typeof WebSocket;
  (spawn as jest.Mock).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 42001 + children.length, stderr: new EventEmitter(), stdout: new EventEmitter() }); children.push(child); return child;
  });
});
afterEach(async () => { try { await stopWorkspaceDebuggers(); } finally { Object.defineProperty(process, 'platform', { value: originalPlatform }); global.WebSocket = originalSocket; fs.rmSync(root, { recursive: true, force: true }); } });

test('late open from an exited startup neither initializes nor stops the replacement connection', async () => {
  const first = call('start', { file }); expect(children).toHaveLength(1);
  children[0].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick();
  const oldSocket = ControlledSocket.instances[0]; expect(oldSocket).toBeDefined();
  children[0].emit('exit', 0);
  // Native exit settles the old startup and reservation without waiting for a
  // socket callback that might never arrive. Late open remains harmless.
  expect(await first).toEqual(expect.objectContaining({ success: false, error: expect.stringMatching(/session changed during startup/) }));
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, frames: [], breakpoints: [] }));
  const second = call('start', { file }); expect(children).toHaveLength(2);
  children[1].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40002/def-456\n'); await tick();
  const currentSocket = ControlledSocket.instances[1]; currentSocket.open();
  expect(await second).toEqual(expect.objectContaining({ success: true, running: true, pid: children[1].pid }));
  expect(currentSocket.sent.map(message => JSON.parse(message).method)).toEqual(['Runtime.enable', 'Debugger.enable', 'NodeRuntime.notifyWhenWaitingForDisconnect', 'Runtime.runIfWaitingForDebugger']);
  expect(JSON.parse(currentSocket.sent[2]).params).toEqual({ enabled: true });
  // A queued network callback from the former socket settles the former await.
  // It cannot issue commands on this session's new socket or invoke its Stop.
  oldSocket.dispatch('open');
  expect(await first).toEqual(expect.objectContaining({ success: false, error: expect.stringMatching(/session changed during startup/) }));
  expect(oldSocket.sent).toEqual([]); expect(currentSocket.sent).toHaveLength(4);
  expect(stopWorkspaceChild).not.toHaveBeenCalled();
  oldSocket.dispatch('message', { data: JSON.stringify({ method: 'Debugger.paused', params: { callFrames: [{ callFrameId: 'old-frame', location: { scriptId: 'old-script', lineNumber: 9, columnNumber: 0 } }] } }) });
  oldSocket.dispatch('close');
  oldSocket.dispatch('message', { data: JSON.stringify({ method: 'NodeRuntime.waitingForDisconnect' }) });
  expect(currentSocket.readyState).toBe(ControlledSocket.OPEN);
  expect(await call('state')).toEqual(expect.objectContaining({ success: true, running: true, paused: false, pid: children[1].pid, frames: [] }));
});

test('only owned inspector completion detaches, retaining running state and points until actual child exit', async () => {
  const starting = call('start', { file });
  const child = children[0]; child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick();
  const socket = ControlledSocket.instances[0]; socket.open(); expect((await starting).success).toBe(true);
  expect(JSON.parse(socket.sent[2])).toEqual(expect.objectContaining({ method: 'NodeRuntime.notifyWhenWaitingForDisconnect', params: { enabled: true } }));
  expect((await call('breakpoint', { file, line: 2 })).success).toBe(true);
  child.stderr.emit('data', 'Waiting for the debugger to disconnect...\n');
  child.stdout.emit('data', 'NodeRuntime.waitingForDisconnect\n');
  expect(socket.readyState).toBe(ControlledSocket.OPEN);
  expect(await call('state')).toEqual(expect.objectContaining({ running: true, pid: child.pid, breakpoints: [{ path: file, line: 2 }] }));
  socket.dispatch('message', { data: JSON.stringify({ method: 'NodeRuntime.waitingForDisconnect' }) });
  await tick();
  expect(socket.readyState).toBe(3);
  expect(stopWorkspaceChild).not.toHaveBeenCalled();
  expect(await call('state')).toEqual(expect.objectContaining({ running: true, pid: child.pid, breakpoints: [{ path: file, line: 2 }] }));
  child.emit('exit', 0);
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, paused: false, frames: [], breakpoints: [] }));
});

test('same-root replacement waits for delayed owned Stop and preserves its fresh breakpoint and session entry', async () => {
  const first = call('start', { file });
  children[0].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); ControlledSocket.instances[0].open(); expect((await first).success).toBe(true);
  let finishStop!: () => void;
  (stopWorkspaceChild as jest.Mock).mockImplementationOnce((child: EventEmitter) => {
    child.emit('exit', 0); // Actual exit precedes completion of tree/handle cleanup.
    return new Promise<void>(resolve => { finishStop = resolve; });
  });
  const oldStop = call('stop'); await tick(); expect(stopWorkspaceChild).toHaveBeenCalledWith(children[0]);
  const replacement = call('start', { file });
  await tick(); expect(children).toHaveLength(1); // Same-root startup joins the retained old tree.
  finishStop(); await oldStop; await tick();
  children[1].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40002/def-456\n'); await tick();
  const socket = ControlledSocket.instances[1]; socket.open(); expect((await replacement).success).toBe(true);
  socket.dispatch('message', { data: JSON.stringify({ method: 'Debugger.scriptParsed', params: { scriptId: 'new-script', url: file } }) });
  socket.dispatch('message', { data: JSON.stringify({ method: 'Debugger.paused', params: { callFrames: [{ callFrameId: 'new-frame', functionName: 'current', url: '', location: { scriptId: 'new-script', lineNumber: 3, columnNumber: 0 }, scopeChain: [] }] } }) });
  expect((await call('breakpoint', { file, line: 4 })).success).toBe(true);
  const current = await call('state');
  expect(current).toEqual(expect.objectContaining({ success: true, running: true, paused: true, pid: children[1].pid, breakpoints: [{ path: file, line: 4 }] }));
  expect(current.frames).toEqual([expect.objectContaining({ id: 'new-frame', path: file, line: 4 })]);
  expect(stopWorkspaceChild).toHaveBeenCalledTimes(1);
});

test('global debugger cleanup blocks new starts until its owned stop finishes, then permits a fresh session', async () => {
  const first = call('start', { file }); children[0].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); ControlledSocket.instances[0].open(); await first;
  let finishStop!: () => void;
  (stopWorkspaceChild as jest.Mock).mockImplementationOnce((child: EventEmitter) => { child.emit('exit', 0); return new Promise<void>(resolve => { finishStop = resolve; }); });
  const cleanup = stopWorkspaceDebuggers(); expect(stopWorkspaceDebuggers()).toBe(cleanup);
  await tick();
  expect(await call('start', { file })).toEqual(expect.objectContaining({ success: false, error: expect.stringMatching(/cleanup is in progress/) }));
  expect(children).toHaveLength(1);
  finishStop(); await cleanup;
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, breakpoints: [] }));
  const fresh = call('start', { file }); children[1].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40002/def-456\n'); await tick(); ControlledSocket.instances[1].open();
  expect(await fresh).toEqual(expect.objectContaining({ success: true, running: true, pid: children[1].pid }));
});

test('one refused global stop does not release admission while another owned stop remains pending', async () => {
  const first = call('start', { file }); children[0].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); ControlledSocket.instances[0].open(); await first;
  const otherRoot = path.join(root, 'other'); fs.mkdirSync(otherRoot); const otherFile = path.join(otherRoot, 'main.js'); fs.writeFileSync(otherFile, 'console.log("other");\n');
  const second = performWorkspaceDebug({ root: otherRoot, action: 'start', file: otherFile }); children[1].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40002/def-456\n'); await tick(); ControlledSocket.instances[1].open(); await second;
  let finishSecond!: () => void;
  (stopWorkspaceChild as jest.Mock)
    .mockImplementationOnce(async (child: EventEmitter) => { child.emit('exit', 0); throw new Error('First cleanup refused'); })
    .mockImplementationOnce((child: EventEmitter) => { child.emit('exit', 0); return new Promise<void>(resolve => { finishSecond = resolve; }); });
  let settled = false;
  const cleanup = stopWorkspaceDebuggers().then(() => { settled = true; return ''; }, error => { settled = true; return error.message; });
  await tick(); expect(settled).toBe(false);
  expect((await call('start', { file })).error).toMatch(/cleanup is in progress/); expect(children).toHaveLength(2);
  finishSecond(); expect(await cleanup).toBe('First cleanup refused');
  const fresh = call('start', { file }); await tick(); children[2].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40003/abc-456\n'); await tick(); ControlledSocket.instances[2].open();
  expect((await fresh).success).toBe(true);
});

test('completion checks the retained Job; leader exit and failed Stop preserve the same Job for descendant cleanup', async () => {
  const starting = call('start', { file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); const socket = ControlledSocket.instances[0]; socket.open(); await starting;
  const job = jobs[0]; let finishQuery!: (empty: boolean) => void;
  job.queryEmpty.mockImplementationOnce(() => new Promise(resolve => { finishQuery = resolve; }));
  socket.dispatch('message', { data: JSON.stringify({ method: 'NodeRuntime.waitingForDisconnect' }) }); await tick();
  expect(socket.readyState).toBe(ControlledSocket.OPEN);
  expect(await call('state')).toEqual(expect.objectContaining({ running: true, pid: child.pid }));
  finishQuery(false); await tick(); expect(socket.readyState).toBe(3);
  child.emit('exit', 0);
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, cleanupPending: true }));
  job.stop.mockRejectedValueOnce(new Error('Job still active; retry retained Job.'));
  expect((await call('stop')).error).toMatch(/Job still active/);
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, cleanupPending: true }));
  expect((await call('stop')).success).toBe(true);
  expect(job.stop).toHaveBeenCalledTimes(2);
  expect(createWorkspaceWindowsJob).toHaveBeenCalledTimes(1); // No root-gone recapture/reassignment.
  expect((await call('state')).cleanupPending).not.toBe(true);
});

test('ended cleanup records free the live cap while two active or starting roots still reserve it', async () => {
  const roots = [root, path.join(root, 'two'), path.join(root, 'three'), path.join(root, 'four')];
  for (let index = 1; index < roots.length; index++) fs.mkdirSync(roots[index]);
  const startAt = async (project: string) => {
    const entry = path.join(project, 'main.js'); fs.writeFileSync(entry, 'console.log("fixture");\n');
    const starting = performWorkspaceDebug({ root: project, action: 'start', file: entry });
    const child = children[children.length - 1]; child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick();
    const socket = ControlledSocket.instances[ControlledSocket.instances.length - 1]; socket.open(); expect((await starting).success).toBe(true); return { child, socket };
  };
  for (const project of roots.slice(0, 2)) {
    const { child, socket } = await startAt(project); socket.dispatch('message', { data: JSON.stringify({ method: 'NodeRuntime.waitingForDisconnect' }) }); await tick(); child.emit('exit', 0);
    expect(await performWorkspaceDebug({ root: project, action: 'state' })).toEqual(expect.objectContaining({ running: false, cleanupPending: true }));
  }
  await startAt(roots[2]); await startAt(roots[3]);
  const rejected = await call('start', { file }); expect(rejected.error).toMatch(/Close another project/); expect(children).toHaveLength(4);
  await stopWorkspaceDebuggers(); expect(jobs.every(job => job.stop.mock.calls.length === 1)).toBe(true);
});

test('abrupt executed exit retains assigned Job; helper loss refuses shutdown without recapturing the old PID', async () => {
  let isolated!: typeof import('../workspace-debug'); jest.isolateModules(() => { isolated = require('../workspace-debug'); });
  const starting = isolated.performWorkspaceDebug({ root, action: 'start', file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); ControlledSocket.instances[0].open(); await starting;
  const job = jobs[0]; job.stop.mockRejectedValue(new Error('Job helper ownership lost; cleanup is unverified.'));
  child.emit('exit', 9);
  expect(await isolated.performWorkspaceDebug({ root, action: 'state' })).toEqual(expect.objectContaining({ running: false, cleanupPending: true }));
  await expect(isolated.stopWorkspaceDebuggers()).rejects.toThrow(/ownership lost/);
  expect(createWorkspaceWindowsJob).toHaveBeenCalledTimes(1); expect(job.stop).toHaveBeenCalledTimes(1);
  expect((await isolated.performWorkspaceDebug({ root, action: 'stop' })).success).toBe(false);
});

test('unknown Windows creation identity does not release project code and cleans only the held startup ChildProcess', async () => {
  (workspacePtyLifecycle.capture as jest.Mock).mockResolvedValueOnce(undefined);
  const starting = call('start', { file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); const socket = ControlledSocket.instances[0]; socket.open();
  expect((await starting).error).toMatch(/No project code was run/);
  expect(socket.sent.map(text => JSON.parse(text).method)).not.toContain('Runtime.runIfWaitingForDebugger');
  expect(stopWorkspaceChild).toHaveBeenCalledWith(child); expect(createWorkspaceWindowsJob).not.toHaveBeenCalled();
  expect((await call('state')).cleanupPending).not.toBe(true);
});

test('failed spawn without a PID releases its reservation without waiting for a nonexistent exit event', async () => {
  const starting = call('start', { file }); const child = children[0]; Object.assign(child, { pid: undefined });
  child.emit('error', new Error('spawn ENOENT'));
  expect(await starting).toEqual(expect.objectContaining({ success: false, error: 'spawn ENOENT' }));
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, cleanupPending: false }));
  expect(stopWorkspaceChild).not.toHaveBeenCalled(); await stopWorkspaceDebuggers();
});

test('Windows Job assignment readiness gates project-code release while retaining synchronous ownership', async () => {
  let ready!: () => void;
  const job = { ready: new Promise<void>(resolve => { ready = resolve; }), queryEmpty: jest.fn().mockResolvedValue(false), stop: jest.fn(async () => { children[0].emit('exit', 0); }) };
  (createWorkspaceWindowsJob as jest.Mock).mockReturnValueOnce(job);
  const starting = call('start', { file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); const socket = ControlledSocket.instances[0]; socket.open(); await tick();
  expect(createWorkspaceWindowsJob).toHaveBeenCalledWith(child.pid, { creation: '638953000000000000', parent: process.pid });
  expect(socket.sent.map(text => JSON.parse(text).method)).not.toContain('Runtime.runIfWaitingForDebugger');
  expect((await call('start', { file })).error).toMatch(/Stop the current/); expect(children).toHaveLength(1);
  ready(); expect((await starting).success).toBe(true); expect(JSON.parse(socket.sent[socket.sent.length - 1]).method).toBe('Runtime.runIfWaitingForDebugger');
  await call('stop'); expect(job.stop).toHaveBeenCalledTimes(1);
});

test('assignment rejection never releases project code; failed cleanup retains the same Job for retry', async () => {
  let rejectReady!: (error: Error) => void;
  const job = { ready: new Promise<void>((_resolve, reject) => { rejectReady = reject; }), queryEmpty: jest.fn(), stop: jest.fn().mockRejectedValueOnce(new Error('Owned Job cleanup still pending.')) };
  (createWorkspaceWindowsJob as jest.Mock).mockReturnValueOnce(job);
  const starting = call('start', { file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); const socket = ControlledSocket.instances[0]; socket.open(); await tick();
  rejectReady(new Error('Birth-checked Job assignment failed.'));
  expect((await starting).error).toMatch(/Owned Job cleanup still pending/);
  expect(socket.sent.map(text => JSON.parse(text).method)).not.toContain('Runtime.runIfWaitingForDebugger');
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, cleanupPending: true }));
  expect(stopWorkspaceChild).toHaveBeenCalledWith(child); // Job refusal cannot strand gated startup.
  job.stop.mockImplementationOnce(async () => { child.emit('exit', 0); });
  expect((await call('stop')).success).toBe(true); expect(job.stop).toHaveBeenCalledTimes(2); expect(createWorkspaceWindowsJob).toHaveBeenCalledTimes(1);
});

test('uncertain retained Job query keeps the completed inspector attached until owned Stop proves cleanup', async () => {
  const starting = call('start', { file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); const socket = ControlledSocket.instances[0]; socket.open(); await starting;
  jobs[0].queryEmpty.mockRejectedValueOnce(new Error('Job helper query is uncertain.'));
  socket.dispatch('message', { data: JSON.stringify({ method: 'NodeRuntime.waitingForDisconnect' }) }); await tick();
  expect(socket.readyState).toBe(ControlledSocket.OPEN);
  expect(await call('state')).toEqual(expect.objectContaining({ running: true, cleanupPending: true, error: 'Job helper query is uncertain.' }));
  expect((await call('stop')).success).toBe(true); expect(jobs[0].stop).toHaveBeenCalledTimes(1);
});

test('per-project Stop fences pending assignment before either cleanup finishes, preventing project-code release', async () => {
  let ready!: () => void; let finishJob!: () => void; let finishChild!: () => void;
  const job = { ready: new Promise<void>(resolve => { ready = resolve; }), queryEmpty: jest.fn(), stop: jest.fn(() => new Promise<void>(resolve => { finishJob = resolve; })) };
  (createWorkspaceWindowsJob as jest.Mock).mockReturnValueOnce(job);
  const starting = call('start', { file }); const child = children[0];
  child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); const socket = ControlledSocket.instances[0]; socket.open(); await tick();
  (stopWorkspaceChild as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finishChild = () => { child.emit('exit', 0); resolve(); }; }));
  const stopping = call('stop'); await tick(); expect(job.stop).toHaveBeenCalledTimes(1); expect(stopWorkspaceChild).toHaveBeenCalledWith(child);
  ready(); await tick(); // Both cleanup operations still pending and child still owned/alive.
  expect(socket.sent.map(text => JSON.parse(text).method)).not.toContain('Runtime.runIfWaitingForDebugger');
  finishChild(); finishJob(); expect((await stopping).success).toBe(true);
  expect((await starting).error).toMatch(/startup was stopped.*No project code/);
  expect((await call('state')).cleanupPending).not.toBe(true); expect(job.stop).toHaveBeenCalledTimes(1);
});
