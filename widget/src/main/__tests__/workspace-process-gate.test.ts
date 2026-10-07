import { EventEmitter } from 'events';
import * as vm from 'vm';
import { StringDecoder } from 'string_decoder';
import { createWorkspaceProcessGate, snapshotWorkspaceLaunch, WORKSPACE_PROCESS_GATE_SOURCE } from '../workspace-process-gate';
import type { WorkspaceApprovedLaunch } from '../workspace-windows-job';

function bootstrap(adapterPath?: string) {
  const pipe = Object.assign(new EventEmitter(), { write: jest.fn((_line: string, done?: () => void) => { done?.(); return true; }), end: jest.fn(), setEncoding: jest.fn() });
  const child = Object.assign(new EventEmitter(), { pid: 91 });
  const spawn = jest.fn(() => child);
  let nextConsoleFd = 40;
  const consoleFs = { openSync: jest.fn((_device: string, _mode: string) => ++nextConsoleFd), closeSync: jest.fn((_fd: number) => {}) };
  const crossSpawn = jest.fn((_exe: string, _argv: string[], _opts: { env: NodeJS.ProcessEnv }) => child), imports: string[] = [];
  const process = Object.assign(new EventEmitter(), {
    env: { HOMEBOT_IDE_GATE_PIPE: 'hbi-00000000-0000-0000-0000-000000000001', HOMEBOT_IDE_GATE_CAP: 'a'.repeat(64), NODE_OPTIONS: '' },
    exit: jest.fn((code: number) => { throw new Error(`exit:${code}`); }),
  });
  const timers: Array<() => void> = [];
  const connect = jest.fn(() => pipe);
  vm.runInNewContext(WORKSPACE_PROCESS_GATE_SOURCE, {
    require(name: string) { imports.push(name); if (name === 'node:net') return { connect }; if (name === 'node:child_process') return { spawn }; if (name === 'node:fs') return consoleFs; if (name === adapterPath) return crossSpawn; throw new Error(`Unexpected non-core import: ${name}`); },
    process, setTimeout(callback: () => void) { timers.push(callback); return 1; }, clearTimeout: jest.fn(),
  });
  const go = (launch: WorkspaceApprovedLaunch = { executable: 'approved-shell', args: ['/D'], env: { NODE_OPTIONS: '--require approved-after-job', HOMEBOT_IDE_GATE_CAP: 'must-be-removed' } }) => pipe.emit('data', Buffer.from(JSON.stringify(launch) + '\n'));
  const accept = () => pipe.emit('data', Buffer.from('accepted\n'));
  return { pipe, child, process, spawn, crossSpawn, consoleFs, imports, connect, timers, go, accept };
}

describe('fixed process bootstrap before Job assignment', () => {
  it('echoes exactly one fresh identity challenge without consuming GO or importing project code', () => {
    const f = bootstrap('approved-adapter'); const challenge = 'b'.repeat(64);
    f.pipe.emit('data', Buffer.from(JSON.stringify({ type: 'identity-challenge', challenge }) + '\n'));
    expect(f.pipe.write).toHaveBeenCalledWith(JSON.stringify({ type: 'identity-response', challenge, capability: 'a'.repeat(64) }) + '\n');
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.imports).toEqual(['node:net', 'node:child_process']);
    f.go(); expect(f.spawn).toHaveBeenCalledTimes(1); f.child.emit('spawn'); f.accept();
  });
  it('rejects malformed, extra-field and replayed challenges before any GO', () => {
    for (const packet of [{ type: 'identity-challenge', challenge: 'wrong' }, { type: 'identity-challenge', challenge: 'b'.repeat(64), extra: true }]) {
      const f = bootstrap(); expect(() => f.pipe.emit('data', Buffer.from(JSON.stringify(packet) + '\n'))).toThrow('exit:125');
      expect(f.spawn).not.toHaveBeenCalled();
    }
    const f = bootstrap(), packet = Buffer.from(JSON.stringify({ type: 'identity-challenge', challenge: 'b'.repeat(64) }) + '\n');
    f.pipe.emit('data', packet); expect(() => f.pipe.emit('data', packet)).toThrow('exit:125'); expect(f.spawn).not.toHaveBeenCalled();
  });
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
  it('restores only the snapshotted target environment after GO and preserves inherited service streams', () => {
    const f = bootstrap(); f.go();
    expect(f.spawn).toHaveBeenCalledWith('approved-shell', ['/D'], { env: { NODE_OPTIONS: '--require approved-after-job' }, stdio: 'inherit', shell: false, windowsHide: true });
    expect(f.pipe.end).not.toHaveBeenCalled(); f.child.emit('spawn');
    expect(f.pipe.write).toHaveBeenCalledWith('{"type":"spawn","pid":91}\n');
    expect(f.pipe.end).not.toHaveBeenCalled(); f.accept(); expect(f.pipe.end).toHaveBeenCalled();
    expect(f.process.exit).not.toHaveBeenCalled(); f.process.emit('SIGINT'); f.process.emit('SIGBREAK');
    expect(f.process.exit).not.toHaveBeenCalled();
  });
  it('reopens only attached console devices after GO and closes parent copies after spawn', () => {
    const f = bootstrap();
    expect(f.consoleFs.openSync).not.toHaveBeenCalled(); expect(f.imports).not.toContain('node:fs');
    const launch = snapshotWorkspaceLaunch('approved-shell', ['/D'], { TERM: 'xterm-256color' }, { console: 'attached' });
    f.spawn.mockImplementationOnce(() => {
      expect(f.consoleFs.closeSync).not.toHaveBeenCalled(); return f.child;
    });
    f.go(launch);
    expect(f.consoleFs.openSync.mock.calls).toEqual([['\\\\.\\CONIN$', 'r+'], ['\\\\.\\CONOUT$', 'r+']]);
    expect(f.spawn).toHaveBeenCalledWith('approved-shell', ['/D'], { env: { TERM: 'xterm-256color' }, stdio: [41, 42, 42], shell: false, windowsHide: true });
    expect(f.consoleFs.closeSync.mock.calls).toEqual([[41], [42]]);
    f.child.emit('spawn'); f.accept();
    expect(f.pipe.write).toHaveBeenCalledWith('{"type":"spawn","pid":91}\n');
    expect(f.process.exit).not.toHaveBeenCalled();
  });
  it('keeps task and service streams inherited without opening a console', () => {
    for (const kind of [undefined, 'task'] as const) {
      const f = bootstrap(); f.go({ executable: 'approved-command', args: [], env: {}, ...(kind ? { kind } : {}) });
      expect(f.spawn).toHaveBeenCalledWith('approved-command', [], expect.objectContaining({ stdio: 'inherit' }));
      expect(f.consoleFs.openSync).not.toHaveBeenCalled(); expect(f.consoleFs.closeSync).not.toHaveBeenCalled();
    }
  });
  it('fails closed when attached console input is unavailable without starting a shell', () => {
    const f = bootstrap(); f.consoleFs.openSync.mockImplementationOnce(() => { throw new Error('no attached console'); });
    expect(() => f.go({ executable: 'approved-shell', args: [], env: {}, console: 'attached' })).toThrow('exit:126');
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.consoleFs.closeSync).not.toHaveBeenCalled();
    expect(f.pipe.write).toHaveBeenCalledWith('{"type":"launch-error","stage":"console-input","code":"UNKNOWN"}\n', expect.any(Function));
  });
  it('closes a partially opened console if output cannot be opened', () => {
    const f = bootstrap(); f.consoleFs.openSync.mockImplementationOnce(() => 41).mockImplementationOnce(() => { throw new Error('output unavailable'); });
    expect(() => f.go({ executable: 'approved-shell', args: [], env: {}, console: 'attached' })).toThrow('exit:126');
    expect(f.consoleFs.closeSync.mock.calls).toEqual([[41]]); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('closes both parent console copies on synchronous spawn or close failure', () => {
    const spawnFailure = bootstrap(); spawnFailure.spawn.mockImplementationOnce(() => { throw new Error('spawn refused'); });
    expect(() => spawnFailure.go({ executable: 'approved-shell', args: [], env: {}, console: 'attached' })).toThrow('exit:126');
    expect(spawnFailure.consoleFs.closeSync.mock.calls).toEqual([[41], [42]]);
    const closeFailure = bootstrap(); closeFailure.consoleFs.closeSync.mockImplementationOnce(() => { throw new Error('close refused'); });
    expect(() => closeFailure.go({ executable: 'approved-shell', args: [], env: {}, console: 'attached' })).toThrow('exit:126');
    expect(closeFailure.consoleFs.closeSync.mock.calls).toEqual([[41], [42]]);
    expect(closeFailure.pipe.write).toHaveBeenCalledWith('{"type":"launch-error","stage":"console-close","code":"UNKNOWN"}\n', expect.any(Function));
  });
  it('reports only finite first-error stage/errno and never copies error paths, env, arguments or capabilities', () => {
    const f = bootstrap();
    f.consoleFs.openSync.mockImplementationOnce(() => 41).mockImplementationOnce(() => { throw Object.assign(new Error('PRIVATE_ENV_PATH_ARG_CAP_CANARY'), { code: 'ENOENT' }); });
    f.consoleFs.closeSync.mockImplementationOnce(() => { throw Object.assign(new Error('cleanup must not replace first error'), { code: 'EBADF' }); });
    expect(() => f.go({ executable: 'approved-shell', args: [], env: {}, console: 'attached' })).toThrow('exit:126');
    expect(f.pipe.write).toHaveBeenCalledWith('{"type":"launch-error","stage":"console-output","code":"ENOENT"}\n', expect.any(Function));
    expect(JSON.stringify(f.pipe.write.mock.calls)).not.toContain('PRIVATE_');
    const unknown = bootstrap(); unknown.spawn.mockImplementationOnce(() => { throw Object.assign(new Error('PRIVATE_ERROR'), { code: 'PRIVATE_CAP_CANARY' }); });
    expect(() => unknown.go()).toThrow('exit:126');
    expect(unknown.pipe.write).toHaveBeenCalledWith('{"type":"launch-error","stage":"spawn","code":"UNKNOWN"}\n', expect.any(Function));
  });
  it('retains the original waiting deadline if a failed-launch diagnostic cannot flush', () => {
    const f = bootstrap(); f.pipe.write.mockImplementation(() => true);
    f.consoleFs.openSync.mockImplementationOnce(() => { throw Object.assign(new Error('unavailable'), { code: 'EACCES' }); });
    f.go({ executable: 'approved-shell', args: [], env: {}, console: 'attached' });
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.pipe.end).not.toHaveBeenCalled();
    expect(f.process.exit).not.toHaveBeenCalled(); expect(() => f.timers[0]()).toThrow('exit:125');
  });
  it('rejects arbitrary console modes and task/adapter console combinations before any device open', () => {
    for (const fields of [{ console: 'arbitrary-path' }, { console: 'attached', kind: 'task' }, { console: 'attached', adapter: { kind: 'cross-spawn', modulePath: 'untrusted', comspec: 'untrusted' } }]) {
      const f = bootstrap();
      expect(() => f.go({ executable: 'approved-shell', args: [], env: {}, ...fields } as WorkspaceApprovedLaunch)).toThrow('exit:125');
      expect(f.spawn).not.toHaveBeenCalled(); expect(f.consoleFs.openSync).not.toHaveBeenCalled();
    }
    expect(() => snapshotWorkspaceLaunch('shell', [], {}, { console: 'attached', adapter: 'cross-spawn' })).toThrow(/console mode/);
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
  it('accepts the exact token with Windows CRLF, including a split CR/LF packet', () => {
    const f = bootstrap(); f.go(); f.child.emit('spawn');
    f.pipe.emit('data', Buffer.from('accepted\r')); expect(f.pipe.end).not.toHaveBeenCalled();
    f.pipe.emit('data', Buffer.from('\n')); expect(f.pipe.end).toHaveBeenCalledTimes(1);
    expect(f.process.exit).not.toHaveBeenCalled();
    expect(() => f.child.emit('exit', 7)).toThrow('exit:7');
  });
  it.each([' accepted\r\n', 'accepted \r\n', 'accepted\r\r\n', 'accepted-other\r\n'])('rejects a modified acceptance token %j', token => {
    const f = bootstrap(); f.go(); f.child.emit('spawn');
    expect(() => f.pipe.emit('data', Buffer.from(token))).toThrow('exit:125');
    expect(f.pipe.end).not.toHaveBeenCalled();
  });
  it('bounds malformed and oversize input, startup waiting, and disconnected handoff', () => {
    const malformed = bootstrap(); expect(() => malformed.pipe.emit('data', Buffer.from('bad-json\n'))).toThrow('exit:125');
    expect(malformed.spawn).not.toHaveBeenCalled();
    const large = bootstrap(); expect(() => large.pipe.emit('data', Buffer.from('x'.repeat(131073)))).toThrow('exit:125');
    const timeout = bootstrap(); expect(() => timeout.timers[0]()).toThrow('exit:125');
    const unaccepted = bootstrap(); unaccepted.go(); unaccepted.child.emit('spawn'); expect(() => unaccepted.timers[0]()).toThrow('exit:125');
    const disconnected = bootstrap(); expect(() => disconnected.pipe.emit('end')).toThrow('exit:125');
    expect(disconnected.connect).toHaveBeenCalledTimes(1);
  });
  it('copies approved argv/environment before awaits and removes private gate fields', () => {
    const args = ['run-script', 'test'], env = { NODE_OPTIONS: 'approved', HOMEBOT_IDE_GATE_CAP: 'private' };
    const launch = snapshotWorkspaceLaunch('approved-node', args, env); args[1] = 'other'; env.NODE_OPTIONS = 'changed';
    expect(launch).toEqual({ executable: 'approved-node', args: ['run-script', 'test'], env: { NODE_OPTIONS: 'approved' } });
  });
  it('resolves the application adapter in main, imports it only after GO, and preserves service cwd/SDK environment', () => {
    const old = process.env.comspec; process.env.comspec = 'C:\\Windows\\System32\\cmd.exe';
    try {
      const env = { SDK_CANARY: 'copied', NODE_OPTIONS: 'target-only', ELECTRON_RUN_AS_NODE: '0' };
      const launch = snapshotWorkspaceLaunch('approved-service.cmd', ['argument'], env, { cwd: process.cwd(), adapter: 'cross-spawn' });
      expect(launch.kind).toBeUndefined(); expect(launch.adapter?.modulePath).toBe(require.resolve('cross-spawn'));
      const f = bootstrap(launch.adapter!.modulePath);
      expect(f.imports).toEqual(['node:net', 'node:child_process']); env.SDK_CANARY = 'changed';
      f.go(launch);
      expect(f.imports.at(-1)).toBe(launch.adapter!.modulePath); expect(f.spawn).not.toHaveBeenCalled();
      expect(f.crossSpawn).toHaveBeenCalledWith('approved-service.cmd', ['argument'], expect.objectContaining({ cwd: process.cwd(), env: { SDK_CANARY: 'copied', NODE_OPTIONS: 'target-only', ELECTRON_RUN_AS_NODE: '0' }, stdio: 'inherit', shell: false }));
      expect((f.process.env as Record<string, string>).comspec).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(f.crossSpawn.mock.calls[0][2].env).not.toHaveProperty('comspec');
    } finally { if (old === undefined) delete process.env.comspec; else process.env.comspec = old; }
  });
  it('selects streaming UTF-8 and preserves a multibyte argument split across received packets', () => {
    const f = bootstrap(); expect(f.pipe.setEncoding).toHaveBeenCalledWith('utf8');
    const launch = { executable: 'approved-shell', args: ['nested/一🔧é.cmd'], env: { RULE: 'préserver🔧' } };
    const bytes = Buffer.from(JSON.stringify(launch) + '\n'), split = bytes.indexOf(Buffer.from('🔧')) + 1;
    const decoder = new StringDecoder('utf8');
    f.pipe.emit('data', decoder.write(bytes.subarray(0, split))); expect(f.spawn).not.toHaveBeenCalled();
    f.pipe.emit('data', decoder.write(bytes.subarray(split)));
    expect(f.spawn).toHaveBeenCalledWith(launch.executable, launch.args, expect.objectContaining({ env: launch.env }));
  });
});
