jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn((_file, _args, _options, done) => done(null)) }));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspacePtySessions } from '../workspace-terminal-pty';
import type { WorkspacePtyStopResult } from '../workspace-pty-force-stop';
import type { WorkspacePtyIdentity } from '../workspace-pty-identity';
const windowsTest = process.platform === 'win32' ? test : test.skip;
jest.setTimeout(15_000);
let folder: string;
beforeEach(() => { folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-pty-')); });
afterEach(() => { fs.rmSync(folder, { recursive: true, force: true }); });
function setup(autoExit = true, confirmed = true, captured?: { original: WorkspacePtyIdentity | null | undefined }) {
  let data!: (text: string) => void; let exit!: (event: { exitCode: number }) => void;
  const disposeData = jest.fn(); const disposeExit = jest.fn();
  let hasExited = false;
  const pty = { pid: 12345, write: jest.fn(), resize: jest.fn(), kill: jest.fn(() => { if (autoExit && !hasExited) exit({ exitCode: 0 }); }), onData: jest.fn(fn => { data = fn; return { dispose: disposeData }; }), onExit: jest.fn(fn => { exit = event => { hasExited = true; fn(event); }; return { dispose: disposeExit }; }) };
  const spawn = jest.fn((_file: string, _args: string[], _options: any) => pty).mockImplementationOnce(() => pty);
  spawn.mockImplementation(() => {
    let ownedExit!: (event: { exitCode: number }) => void;
    return { ...pty, kill: jest.fn(() => ownedExit({ exitCode: 0 })), onExit: jest.fn(fn => { ownedExit = fn; return { dispose: jest.fn() }; }) };
  });
  const stopped = jest.fn(async () => confirmed);
  const force = jest.fn(async (_pid: number, _identity: unknown, _receipt?: unknown): Promise<WorkspacePtyStopResult> => ({ stopped: true, attempted: true, receipt: [{ pid: 12345, creation: '638953000000000000', parent: process.pid }] }));
  const capture = jest.fn(async () => captured ? captured.original : { creation: '638953000000000000', parent: process.pid });
  const manager = new WorkspacePtySessions(spawn, () => [{ id: 'cmd', label: 'Command Prompt', executable: 'cmd.exe' }], { capture, stopped }, force);
  const events = jest.fn(); const session = manager.create(7, { projectDir: folder, profileId: 'cmd' }, events);
  return { pty, spawn, manager, session, events, data, exit, disposeData, disposeExit, stopped, force, capture };
}
test('stdin, resize and interrupt route only to the owned real PTY interface', async () => {
  const app = setup();
  expect(app.spawn).toHaveBeenCalledWith('cmd.exe', ['/D'], expect.objectContaining({ cwd: folder, cols: 100, rows: 30 }));
  expect(app.spawn.mock.calls[0][2]).toMatchObject({ useConptyDll: false });
  app.manager.write(7, app.session.sessionId, 'answer\r'); app.manager.interrupt(7, app.session.sessionId); app.manager.resize(7, app.session.sessionId, 120, 40);
  expect(app.pty.write.mock.calls).toEqual([['answer\r'], ['\x03']]); expect(app.pty.resize).toHaveBeenCalledWith(120, 40);
  expect(() => app.manager.write(8, app.session.sessionId, 'bad')).toThrow(/different window/);
  expect(() => app.manager.resize(7, app.session.sessionId, 10000, 0)).toThrow(/Terminal size/);
  await app.manager.close(7, app.session.sessionId);
});

test('a delayed exit callback cannot claim Close succeeded or trigger a raw PID kill', async () => {
  jest.useFakeTimers();
  const app = setup(false, false);
  const refusal = expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/retained/);
  await jest.advanceTimersByTimeAsync(5500); await refusal;
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  expect(require('child_process').execFile).not.toHaveBeenCalledWith('taskkill.exe', expect.anything(), expect.anything(), expect.anything());
  expect(app.disposeExit).not.toHaveBeenCalled();
  app.stopped.mockResolvedValue(true); app.exit({ exitCode: 0 }); await app.manager.close(7, app.session.sessionId);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('an exit notification without native identity disappearance refuses Close and can be retried', async () => {
  const app = setup(true, false);
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/could not be confirmed/);
  app.stopped.mockResolvedValue(true);
  await app.manager.close(7, app.session.sessionId);
  expect(app.stopped).toHaveBeenCalledWith(12345, { creation: '638953000000000000', parent: process.pid });
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('recovery retains failed Close evidence and transcript, scoped to owner and original project', async () => {
  const app = setup(true, false);
  app.data('important terminal output\r\n');
  const other = fs.mkdtempSync(path.join(os.homedir(), 'homebot-pty-other-'));
  try {
    await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/could not be confirmed/);
    expect(await app.manager.list(8, folder)).toEqual([]);
    expect(await app.manager.list(7, other)).toEqual([]);
    const [retained] = await app.manager.list(7, folder);
    expect(retained).toMatchObject({ sessionId: app.session.sessionId, output: 'important terminal output\r\n', exited: true, exitCode: 0, closeError: expect.stringMatching(/could not be confirmed/) });
    retained.output = 'renderer changed clone';
    expect((await app.manager.list(7, folder))[0].output).toBe('important terminal output\r\n');
    app.stopped.mockResolvedValue(true); await app.manager.close(7, app.session.sessionId);
    expect(await app.manager.list(7, folder)).toEqual([]);
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
});

test('recovery waits for an in-flight Close before deciding whether a session was retained', async () => {
  const app = setup();
  let complete!: (value: boolean) => void;
  app.stopped.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const close = app.manager.close(7, app.session.sessionId);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(complete).toBeDefined();
  let recovered = false;
  const listing = app.manager.list(7, folder).then(result => { recovered = true; return result; });
  await Promise.resolve(); expect(recovered).toBe(false);
  complete(true); await close;
  expect(await listing).toEqual([]);
});

test('unproven force Stop keeps the live session and never reports successful Close', async () => {
  const app = setup(true, false); app.force.mockResolvedValue({ stopped: false, attempted: false });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/process-tree exit/);
  expect(app.pty.kill).not.toHaveBeenCalled();
  app.manager.write(7, app.session.sessionId, 'still available');
  expect(app.pty.write).toHaveBeenCalledWith('still available');
  app.force.mockResolvedValue({ stopped: true, attempted: false }); app.stopped.mockResolvedValue(true); await app.manager.close(7, app.session.sessionId);
});

windowsTest('unknown startup identity guides manual exit, stays writable and never recaptures a PID on Retry', async () => {
  const app = setup(false, false, { original: undefined });
  app.force.mockResolvedValue({ stopped: false, attempted: false });
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/identity could not be verified at startup.*Nothing was stopped.*type exit/i);
  }
  expect(app.capture).toHaveBeenCalledTimes(1);
  expect(app.force).toHaveBeenLastCalledWith(12345, undefined, undefined);
  expect(app.pty.kill).not.toHaveBeenCalled();
  app.manager.write(7, app.session.sessionId, 'exit\r');
  expect(app.pty.write).toHaveBeenCalledWith('exit\r');
  app.exit({ exitCode: 0 }); app.stopped.mockResolvedValue(true);
  const forceCalls = app.force.mock.calls.length;
  await app.manager.close(7, app.session.sessionId);
  expect(app.force).toHaveBeenCalledTimes(forceCalls);
  expect(app.capture).toHaveBeenCalledTimes(1);
  expect(app.pty.kill).toHaveBeenCalledTimes(1); // Release only the exited PTY/worker.
  expect(() => app.manager.write(7, app.session.sessionId, 'after close')).toThrow(/has closed/);
});

test('initially missing process can close after disappearance without unknown-capture guidance', async () => {
  const app = setup(true, true, { original: null });
  app.force.mockResolvedValue({ stopped: false, attempted: false });
  await app.manager.close(7, app.session.sessionId);
  expect(app.capture).toHaveBeenCalledTimes(1);
  expect(() => app.manager.write(7, app.session.sessionId, 'after close')).toThrow(/has closed/);
});

test('captured descendants remain recoverable after root exits during a partial Stop', async () => {
  const app = setup();
  const receipt = [{ pid: 12345, creation: '638953000000000000', parent: process.pid }, { pid: 23456, creation: '638953000000000100', parent: 12345 }];
  app.force.mockImplementationOnce(async () => { app.exit({ exitCode: 1 }); return { stopped: false, attempted: true, receipt }; });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/captured identities/);
  app.force.mockResolvedValue({ stopped: true, attempted: true, receipt });
  await app.manager.close(7, app.session.sessionId);
  expect(app.force).toHaveBeenLastCalledWith(12345, { creation: '638953000000000000', parent: process.pid }, receipt);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('natural root exit before any force effect does not create a permanent Close refusal', async () => {
  const app = setup();
  app.force.mockImplementationOnce(async () => { app.exit({ exitCode: 0 }); return { stopped: false, attempted: false }; });
  await app.manager.close(7, app.session.sessionId);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('corrupted force evidence cannot forget uncertainty after a later root exit', async () => {
  const app = setup(); app.force.mockResolvedValue({ stopped: false, attempted: true });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/Stop evidence was corrupted or lost/);
  app.exit({ exitCode: 1 });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/evidence was corrupted or lost/);
});
test('natural exit releases listeners/ConPTY exactly once; Close does not kill a reused PID', async () => {
  const app = setup(); app.data('ready'); app.exit({ exitCode: 0 });
  expect(app.events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'exit', exitCode: 0 }));
  expect(app.disposeData).toHaveBeenCalledTimes(1); expect(app.disposeExit).toHaveBeenCalledTimes(1);
  const kills = app.pty.kill.mock.calls.length;
  expect(kills).toBe(process.platform === 'win32' ? 1 : 0);
  expect(() => app.manager.write(7, app.session.sessionId, 'x')).toThrow(/exited/);
  await app.manager.close(7, app.session.sessionId);
  expect(app.pty.kill).toHaveBeenCalledTimes(kills); expect(app.disposeData).toHaveBeenCalledTimes(1);
});
test('profile selection and session/input/output bounds reject invalid requests', async () => {
  const app = setup();
  expect(() => app.manager.create(7, { projectDir: folder, profileId: 'renderer-supplied-command' }, jest.fn())).toThrow(/profile/);
  expect(() => app.manager.write(7, app.session.sessionId, 'x'.repeat(65537))).toThrow(/too large/);
  app.data('x'.repeat(50000));
  expect(app.events.mock.calls.filter(c => c[0].type === 'data')).toHaveLength(4);
  for (let i = 0; i < 3; i++) app.manager.create(7, { projectDir: folder }, jest.fn());
  expect(() => app.manager.create(7, { projectDir: folder }, jest.fn())).toThrow(/maximum four/);
  await app.manager.closeOwner(7);
});
