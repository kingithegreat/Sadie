const handlers = new Map<string, Function>();
const frame = {}; const sender = { id: 7, mainFrame: frame, isDestroyed: () => false, send: jest.fn(), once: jest.fn() };
const manager = { list: jest.fn(async (_owner: number, _root: string) => [{ sessionId: 's1', output: 'retained output' }]), create: jest.fn(async (_owner: number, _request: any, _notify: any, _validate?: () => void) => ({ sessionId: 's1' })), write: jest.fn(), resize: jest.fn(), interrupt: jest.fn(), close: jest.fn(async () => {}), closeOwner: jest.fn(async () => {}) };
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }) }));
jest.mock('../workspace-terminal-pty', () => ({ workspacePtySessions: manager, workspaceTerminalProfiles: () => [{ id: 'cmd' }] }));
import { registerWorkspaceTerminalIpc, WORKSPACE_TERMINAL_CHANNELS } from '../workspace-terminal-ipc';
const event = { sender, senderFrame: frame };
beforeEach(() => { jest.clearAllMocks(); registerWorkspaceTerminalIpc(); });
test('foreign windows and child frames cannot create, write, resize, interrupt or close terminals', async () => {
  for (const e of [{ sender: {}, senderFrame: {} }, { sender, senderFrame: {} }]) {
    for (const channel of [WORKSPACE_TERMINAL_CHANNELS.LIST, WORKSPACE_TERMINAL_CHANNELS.CREATE, WORKSPACE_TERMINAL_CHANNELS.WRITE, WORKSPACE_TERMINAL_CHANNELS.RESIZE, WORKSPACE_TERMINAL_CHANNELS.INTERRUPT, WORKSPACE_TERMINAL_CHANNELS.CLOSE]) {
      expect(await handlers.get(channel)!(e, { projectDir: 'x', sessionId: 's1', data: 'bad' })).toMatchObject({ success: false });
    }
  }
  expect(manager.list).not.toHaveBeenCalled(); expect(manager.create).not.toHaveBeenCalled(); expect(manager.write).not.toHaveBeenCalled(); expect(manager.close).not.toHaveBeenCalled();
});

test('recovery binds the root query to the trusted window and rejects unexpected arguments', async () => {
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.LIST)!(event, { projectDir: 'project', owner: 8 })).toMatchObject({ success: false });
  expect(manager.list).not.toHaveBeenCalled();
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.LIST)!(event, { projectDir: 'project' })).toMatchObject({ success: true, sessions: [{ sessionId: 's1', output: 'retained output' }] });
  expect(manager.list).toHaveBeenCalledWith(7, 'project');
});
test('create rejects a renderer command and binds session events/cleanup to its owner', async () => {
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', command: 'evil' })).toMatchObject({ success: false });
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', profileId: 'cmd' })).toMatchObject({ success: true, session: { sessionId: 's1' } });
  expect(manager.create).toHaveBeenCalledWith(7, { projectDir: 'x', profileId: 'cmd' }, expect.any(Function), expect.any(Function));
  const notify = manager.create.mock.calls[0][2] as any; notify({ sessionId: 's1', seq: 1, type: 'data', data: 'hello' });
  expect(sender.send).toHaveBeenCalledWith(WORKSPACE_TERMINAL_CHANNELS.EVENT, expect.objectContaining({ data: 'hello' }));
  sender.once.mock.calls[0][1](); expect(manager.closeOwner).toHaveBeenCalledWith(7);
});

test('destroyed owner cleanup catches bounded Close rejection without an unhandled promise', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  manager.closeOwner.mockRejectedValueOnce(Error('Process-tree exit remains unconfirmed'));
  try {
    await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', profileId: 'cmd' });
    sender.once.mock.calls[0][1](); await Promise.resolve();
    expect(manager.closeOwner).toHaveBeenCalledWith(7);
    expect(log).toHaveBeenCalledWith('[HomeBot-CATCH]', expect.objectContaining({ message: 'Process-tree exit remains unconfirmed' }));
  } finally { log.mockRestore(); }
});

test('create waits for native startup and returns the resolved session rather than a promise', async () => {
  let ready!: (session: { sessionId: string }) => void;
  manager.create.mockImplementationOnce(() => new Promise<{ sessionId: string }>(resolve => { ready = resolve; }));
  let settled = false;
  const response = handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', profileId: 'cmd' }).then((value: unknown) => { settled = true; return value; });
  await Promise.resolve(); await Promise.resolve();
  expect(settled).toBe(false);
  ready({ sessionId: 'native-ready' });
  expect(await response).toEqual({ success: true, session: { sessionId: 'native-ready' } });
});

test('native startup rejection is an IPC error instead of a successful promise-shaped session', async () => {
  manager.create.mockRejectedValueOnce(Error('Native terminal startup did not become ready'));
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', profileId: 'cmd' })).toEqual({ success: false, error: 'Native terminal startup did not become ready' });
});

test('the startup GO fence refuses the same WebContents after its main frame is replaced', async () => {
  manager.create.mockImplementationOnce(async (_owner, _request, _notify, validate) => {
    sender.mainFrame = {};
    validate?.(); return { sessionId: 'must-not-publish' };
  });
  try { expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x' })).toMatchObject({ success: false, error: expect.stringContaining('frame changed') }); }
  finally { sender.mainFrame = frame; }
});
