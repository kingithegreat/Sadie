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
const call = (action: 'start' | 'state', extra = {}) => performWorkspaceDebug({ root, action, ...extra });
beforeEach(() => {
  jest.clearAllMocks(); ControlledSocket.instances = []; children.length = 0;
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
