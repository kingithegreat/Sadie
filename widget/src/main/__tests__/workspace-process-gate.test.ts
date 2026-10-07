import { EventEmitter } from 'events';
import * as vm from 'vm';
import { createWorkspaceProcessGate, snapshotWorkspaceLaunch, WORKSPACE_PROCESS_GATE_SOURCE } from '../workspace-process-gate';

function bootstrap() {
  const pipe = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn() });
  const child = Object.assign(new EventEmitter(), { pid: 91 });
  const spawn = jest.fn(() => child);
  const process = Object.assign(new EventEmitter(), {
    env: { HOMEBOT_IDE_GATE_PIPE: 'hbi-00000000-0000-0000-0000-000000000001', HOMEBOT_IDE_GATE_CAP: 'a'.repeat(64), NODE_OPTIONS: '' },
    exit: jest.fn((code: number) => { throw new Error(`exit:${code}`); }),
  });
  const timers: Array<() => void> = [];
  const connect = jest.fn(() => pipe);
  vm.runInNewContext(WORKSPACE_PROCESS_GATE_SOURCE, {
    require(name: string) { if (name === 'node:net') return { connect }; if (name === 'node:child_process') return { spawn }; throw new Error(`Unexpected non-core import: ${name}`); },
    process, setTimeout(callback: () => void) { timers.push(callback); return 1; }, clearTimeout: jest.fn(),
  });
  const go = (launch = { executable: 'approved-shell', args: ['/D'], env: { NODE_OPTIONS: '--require approved-after-job', HOMEBOT_IDE_GATE_CAP: 'must-be-removed' } }) => pipe.emit('data', Buffer.from(JSON.stringify(launch) + '\n'));
  const accept = () => pipe.emit('data', Buffer.from('accepted\n'));
  return { pipe, child, process, spawn, connect, timers, go, accept };
}

describe('fixed process bootstrap before Job assignment', () => {
  it('clears preloads and keeps the capability out of the executable arguments', () => {
    const gate = createWorkspaceProcessGate({ NODE_OPTIONS: '--require project-preload', ELECTRON_RUN_AS_NODE: '0' });
    expect(gate.env.NODE_OPTIONS).toBe(''); expect(gate.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(gate.capability).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(gate.args)).not.toContain(gate.capability);
  });
  it('imports only fixed core code and starts no shell/npm before an authorized GO', () => {
    const f = bootstrap(); expect(f.spawn).not.toHaveBeenCalled();
    expect(f.connect).toHaveBeenCalledWith('\\\\.\\pipe\\hbi-00000000-0000-0000-0000-000000000001');
    f.pipe.emit('connect'); expect(f.pipe.write).toHaveBeenCalledWith('a'.repeat(64) + '\n');
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.process.env).not.toHaveProperty('HOMEBOT_IDE_GATE_CAP');
  });
  it('restores only the snapshotted target environment after GO and preserves TTY stdio', () => {
    const f = bootstrap(); f.go();
    expect(f.spawn).toHaveBeenCalledWith('approved-shell', ['/D'], { env: { NODE_OPTIONS: '--require approved-after-job' }, stdio: 'inherit', shell: false, windowsHide: true });
    expect(f.pipe.end).not.toHaveBeenCalled(); f.child.emit('spawn');
    expect(f.pipe.write).toHaveBeenCalledWith('{"type":"spawn","pid":91}\n');
    expect(f.pipe.end).not.toHaveBeenCalled(); f.accept(); expect(f.pipe.end).toHaveBeenCalled();
    expect(f.process.exit).not.toHaveBeenCalled(); f.process.emit('SIGINT'); f.process.emit('SIGBREAK');
    expect(f.process.exit).not.toHaveBeenCalled();
  });
  it('uses one handoff and never reconnects or executes a second command', () => {
    const f = bootstrap(); f.go(); expect(() => f.go()).toThrow('exit:125'); expect(f.spawn).toHaveBeenCalledTimes(1); expect(f.connect).toHaveBeenCalledTimes(1);
  });
  it('surfaces actual child startup error without fabricating a positive PID', () => {
    const f = bootstrap(); f.go(); expect(() => f.child.emit('error', new Error('spawn failed'))).toThrow('exit:126');
    expect(f.pipe.end).not.toHaveBeenCalled();
  });
  it('rejects invalid child PID and propagates real target exit code', () => {
    const bad = bootstrap(); bad.go(); bad.child.pid = 0; expect(() => bad.child.emit('spawn')).toThrow('exit:126');
    const good = bootstrap(); good.go(); good.child.emit('spawn'); good.accept(); expect(() => good.child.emit('exit', 7)).toThrow('exit:7');
  });
  it('holds the verified wrapper alive until native acceptance of a fast completed task', () => {
    const f = bootstrap(); f.go(); f.child.emit('spawn'); f.child.emit('exit', 7);
    expect(f.process.exit).not.toHaveBeenCalled();
    expect(f.pipe.write).toHaveBeenCalledWith('{"type":"completed","pid":91,"exitCode":7}\n');
    expect(() => f.accept()).toThrow('exit:7');
  });
  it('bounds malformed and oversize input, startup waiting, and disconnected handoff', () => {
    const malformed = bootstrap(); expect(() => malformed.pipe.emit('data', Buffer.from('bad-json\n'))).toThrow('exit:125');
    expect(malformed.spawn).not.toHaveBeenCalled();
    const large = bootstrap(); expect(() => large.pipe.emit('data', Buffer.from('x'.repeat(131073)))).toThrow('exit:125');
    const timeout = bootstrap(); expect(() => timeout.timers[0]()).toThrow('exit:125');
    const disconnected = bootstrap(); expect(() => disconnected.pipe.emit('end')).toThrow('exit:125');
    expect(disconnected.connect).toHaveBeenCalledTimes(1);
  });
  it('copies approved argv/environment before awaits and removes private gate fields', () => {
    const args = ['run-script', 'test'], env = { NODE_OPTIONS: 'approved', HOMEBOT_IDE_GATE_CAP: 'private' };
    const launch = snapshotWorkspaceLaunch('approved-node', args, env); args[1] = 'other'; env.NODE_OPTIONS = 'changed';
    expect(launch).toEqual({ executable: 'approved-node', args: ['run-script', 'test'], env: { NODE_OPTIONS: 'approved' } });
  });
});
