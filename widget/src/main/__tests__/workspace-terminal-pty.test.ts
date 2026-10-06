jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn((_file, _args, _options, done) => done(null)) }));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspacePtySessions } from '../workspace-terminal-pty';
let folder: string;
beforeEach(() => { folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-pty-')); });
afterEach(() => { fs.rmSync(folder, { recursive: true, force: true }); });
function setup() {
  let data!: (text: string) => void; let exit!: (event: { exitCode: number }) => void;
  const disposeData = jest.fn(); const disposeExit = jest.fn();
  const pty = { pid: 12345, write: jest.fn(), resize: jest.fn(), kill: jest.fn(), onData: jest.fn(fn => { data = fn; return { dispose: disposeData }; }), onExit: jest.fn(fn => { exit = fn; return { dispose: disposeExit }; }) };
  const spawn = jest.fn(() => pty);
  const manager = new WorkspacePtySessions(spawn, () => [{ id: 'cmd', label: 'Command Prompt', executable: 'cmd.exe' }]);
  const events = jest.fn(); const session = manager.create(7, { projectDir: folder, profileId: 'cmd' }, events);
  return { pty, spawn, manager, session, events, data, exit, disposeData, disposeExit };
}
test('stdin, resize and interrupt route only to the owned real PTY interface', async () => {
  const app = setup();
  expect(app.spawn).toHaveBeenCalledWith('cmd.exe', ['/D'], expect.objectContaining({ cwd: folder, cols: 100, rows: 30 }));
  app.manager.write(7, app.session.sessionId, 'answer\r'); app.manager.interrupt(7, app.session.sessionId); app.manager.resize(7, app.session.sessionId, 120, 40);
  expect(app.pty.write.mock.calls).toEqual([['answer\r'], ['\x03']]); expect(app.pty.resize).toHaveBeenCalledWith(120, 40);
  expect(() => app.manager.write(8, app.session.sessionId, 'bad')).toThrow(/different window/);
  expect(() => app.manager.resize(7, app.session.sessionId, 10000, 0)).toThrow(/Terminal size/);
  await app.manager.close(7, app.session.sessionId);
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
