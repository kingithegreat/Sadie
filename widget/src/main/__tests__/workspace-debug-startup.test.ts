import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performWorkspaceDebug, stopWorkspaceDebuggers } from '../workspace-debug';
import { stopWorkspaceChild } from '../workspace-owned-process';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../workspace-owned-process', () => ({ rememberWorkspaceChild: jest.fn(), stopWorkspaceChild: jest.fn(async (child: EventEmitter) => { child.emit('exit', 0); }) }));
jest.mock('../workspace-trust', () => ({ validateTrustedWorkspaceRoot: (root: string) => root, checkedTrustedWorkspacePath: (_root: string, file: string) => file }));
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
const children: Array<EventEmitter & { pid: number; stderr: EventEmitter; stdout: EventEmitter }> = [];
const tick = () => new Promise(resolve => setImmediate(resolve));
const call = (action: 'start' | 'state' | 'stop' | 'breakpoint', extra = {}) => performWorkspaceDebug({ root, action, ...extra });
beforeEach(() => {
  jest.clearAllMocks(); ControlledSocket.instances = []; children.length = 0;
  (stopWorkspaceChild as jest.Mock).mockImplementation(async (child: EventEmitter) => { child.emit('exit', 0); });
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-debug-startup-')); file = path.join(root, 'main.js'); fs.writeFileSync(file, 'console.log("fixture");\n');
  originalSocket = global.WebSocket; global.WebSocket = ControlledSocket as unknown as typeof WebSocket;
  (spawn as jest.Mock).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 42001 + children.length, stderr: new EventEmitter(), stdout: new EventEmitter() }); children.push(child); return child;
  });
});
afterEach(async () => { await stopWorkspaceDebuggers(); global.WebSocket = originalSocket; fs.rmSync(root, { recursive: true, force: true }); });

test('late open from an exited startup neither initializes nor stops the replacement connection', async () => {
  const first = call('start', { file }); expect(children).toHaveLength(1);
  children[0].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick();
  const oldSocket = ControlledSocket.instances[0]; expect(oldSocket).toBeDefined();
  children[0].emit('exit', 0);
  expect(await call('state')).toEqual(expect.objectContaining({ running: false, frames: [], breakpoints: [] }));
  const second = call('start', { file }); expect(children).toHaveLength(2);
  children[1].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40002/def-456\n'); await tick();
  const currentSocket = ControlledSocket.instances[1]; currentSocket.open();
  expect(await second).toEqual(expect.objectContaining({ success: true, running: true, pid: children[1].pid }));
  expect(currentSocket.sent.map(message => JSON.parse(message).method)).toEqual(['Runtime.enable', 'Debugger.enable', 'Runtime.runIfWaitingForDebugger']);
  // A queued network callback from the former socket settles the former await.
  // It cannot issue commands on this session's new socket or invoke its Stop.
  oldSocket.dispatch('open');
  expect(await first).toEqual(expect.objectContaining({ success: false, error: expect.stringMatching(/session changed during startup/) }));
  expect(oldSocket.sent).toEqual([]); expect(currentSocket.sent).toHaveLength(3);
  expect(stopWorkspaceChild).not.toHaveBeenCalled();
  oldSocket.dispatch('message', { data: JSON.stringify({ method: 'Debugger.paused', params: { callFrames: [{ callFrameId: 'old-frame', location: { scriptId: 'old-script', lineNumber: 9, columnNumber: 0 } }] } }) });
  oldSocket.dispatch('close');
  expect(await call('state')).toEqual(expect.objectContaining({ success: true, running: true, paused: false, pid: children[1].pid, frames: [] }));
});

test('delayed owned Stop preserves a replacement paused connection, fresh breakpoint and session entry', async () => {
  const first = call('start', { file });
  children[0].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40001/abc-123\n'); await tick(); ControlledSocket.instances[0].open(); expect((await first).success).toBe(true);
  let finishStop!: () => void;
  (stopWorkspaceChild as jest.Mock).mockImplementationOnce((child: EventEmitter) => {
    child.emit('exit', 0); // Actual exit precedes completion of tree/handle cleanup.
    return new Promise<void>(resolve => { finishStop = resolve; });
  });
  const oldStop = call('stop'); expect(stopWorkspaceChild).toHaveBeenCalledWith(children[0]);
  const replacement = call('start', { file });
  children[1].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40002/def-456\n'); await tick();
  const socket = ControlledSocket.instances[1]; socket.open(); expect((await replacement).success).toBe(true);
  socket.dispatch('message', { data: JSON.stringify({ method: 'Debugger.scriptParsed', params: { scriptId: 'new-script', url: file } }) });
  socket.dispatch('message', { data: JSON.stringify({ method: 'Debugger.paused', params: { callFrames: [{ callFrameId: 'new-frame', functionName: 'current', url: '', location: { scriptId: 'new-script', lineNumber: 3, columnNumber: 0 }, scopeChain: [] }] } }) });
  expect((await call('breakpoint', { file, line: 4 })).success).toBe(true);
  finishStop(); const completedOldStop = await oldStop;
  expect(completedOldStop).toEqual(expect.objectContaining({ success: true, running: true, paused: true, pid: children[1].pid, breakpoints: [{ path: file, line: 4 }] }));
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
  const fresh = call('start', { file }); children[2].stderr.emit('data', 'Debugger listening on ws://127.0.0.1:40003/abc-456\n'); await tick(); ControlledSocket.instances[2].open();
  expect((await fresh).success).toBe(true);
});
