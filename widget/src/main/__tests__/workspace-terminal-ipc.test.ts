const handlers = new Map<string, Function>();
const frame = {}; const sender = { id: 7, mainFrame: frame, isDestroyed: () => false, send: jest.fn(), once: jest.fn() };
const manager = { create: jest.fn((_owner: number, _request: any, _notify: any) => ({ sessionId: 's1' })), write: jest.fn(), resize: jest.fn(), interrupt: jest.fn(), close: jest.fn(), closeOwner: jest.fn() };
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }) }));
jest.mock('../workspace-terminal-pty', () => ({ workspacePtySessions: manager, workspaceTerminalProfiles: () => [{ id: 'cmd' }] }));
import { registerWorkspaceTerminalIpc, WORKSPACE_TERMINAL_CHANNELS } from '../workspace-terminal-ipc';
const event = { sender, senderFrame: frame };
beforeEach(() => { jest.clearAllMocks(); registerWorkspaceTerminalIpc(); });
test('foreign windows and child frames cannot create, write, resize, interrupt or close terminals', async () => {
  for (const e of [{ sender: {}, senderFrame: {} }, { sender, senderFrame: {} }]) {
    for (const channel of [WORKSPACE_TERMINAL_CHANNELS.CREATE, WORKSPACE_TERMINAL_CHANNELS.WRITE, WORKSPACE_TERMINAL_CHANNELS.RESIZE, WORKSPACE_TERMINAL_CHANNELS.INTERRUPT, WORKSPACE_TERMINAL_CHANNELS.CLOSE]) {
      expect(await handlers.get(channel)!(e, { projectDir: 'x', sessionId: 's1', data: 'bad' })).toMatchObject({ success: false });
    }
  }
  expect(manager.create).not.toHaveBeenCalled(); expect(manager.write).not.toHaveBeenCalled(); expect(manager.close).not.toHaveBeenCalled();
});
test('create rejects a renderer command and binds session events/cleanup to its owner', async () => {
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', command: 'evil' })).toMatchObject({ success: false });
  expect(await handlers.get(WORKSPACE_TERMINAL_CHANNELS.CREATE)!(event, { projectDir: 'x', profileId: 'cmd' })).toMatchObject({ success: true, session: { sessionId: 's1' } });
  expect(manager.create).toHaveBeenCalledWith(7, { projectDir: 'x', profileId: 'cmd' }, expect.any(Function));
  const notify = manager.create.mock.calls[0][2] as any; notify({ sessionId: 's1', seq: 1, type: 'data', data: 'hello' });
  expect(sender.send).toHaveBeenCalledWith(WORKSPACE_TERMINAL_CHANNELS.EVENT, expect.objectContaining({ data: 'hello' }));
  sender.once.mock.calls[0][1](); expect(manager.closeOwner).toHaveBeenCalledWith(7);
});
