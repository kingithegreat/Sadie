import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const mockHandlers = new Map<string, (...args: any[]) => Promise<any>>();
let mockUserData: string, mockWindow: any, mockSaveHistory = true;
jest.mock('electron', () => ({ app: { getPath: () => mockUserData }, ipcMain: { handle: (channel: string, handler: any) => mockHandlers.set(channel, handler), removeHandler: (channel: string) => mockHandlers.delete(channel) } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => mockWindow }));
jest.mock('../user-paths', () => ({ homeDir: () => require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ saveConversationHistory: mockSaveHistory }) }));
jest.mock('../mcp-client', () => ({ getMcpStatus: () => [], loadMcpConfig: () => ({ servers: [] }) }));
jest.mock('../workspace-completion', () => ({ completeWorkspaceCode: jest.fn() }));
import { registerWorkspaceAiHandlers, WORKSPACE_AI_CHANNELS as channels } from '../workspace-ai-ipc';

describe('AI IPC trust and persistent history effects', () => {
  let directory: string, rootA: string, rootB: string, event: any;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ai-ipc-')); rootA = path.join(directory, 'a'); rootB = path.join(directory, 'b');
    fs.mkdirSync(rootA); fs.mkdirSync(rootB); mockUserData = path.join(directory, 'profile'); mockSaveHistory = true;
    const sender = { id: 1, mainFrame: {} }; mockWindow = { isDestroyed: () => false, webContents: sender }; event = { sender, senderFrame: sender.mainFrame };
    registerWorkspaceAiHandlers();
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  test('wrong window/frame cannot prepare approval, save history or restore a checkpoint', async () => {
    const wrongWindow = { sender: { id: 2 }, senderFrame: event.senderFrame }, wrongFrame = { sender: event.sender, senderFrame: {} };
    for (const hostile of [wrongWindow, wrongFrame]) {
      expect(await mockHandlers.get(channels.PREPARE_PLAN)!(hostile, rootA, 'edit')).toMatchObject({ success: false });
      expect(await mockHandlers.get(channels.SAVE_SESSION)!(hostile, rootA, [{ id: 'x', role: 'user', text: 'private' }])).toMatchObject({ success: false });
      expect(await mockHandlers.get(channels.RESTORE)!(hostile, rootA, 'fake')).toMatchObject({ success: false });
    }
    expect(fs.existsSync(mockUserData)).toBe(false);
    const plan = await mockHandlers.get(channels.PREPARE_PLAN)!(event, rootA, 'edit'); expect(plan.success).toBe(true);
    expect(await mockHandlers.get(channels.APPROVE_PLAN)!(wrongFrame, rootA, plan.id)).toMatchObject({ success: false });
    expect(await mockHandlers.get(channels.APPROVE_PLAN)!(event, rootA, plan.id)).toMatchObject({ success: true });
  });
  test('re-registration restores root-specific JSON and the history opt-out prevents disk writes/readback', async () => {
    const turns = [{ id: 'saved', role: 'assistant', text: 'Persisted answer' }];
    expect(await mockHandlers.get(channels.SAVE_SESSION)!(event, rootA, turns)).toMatchObject({ success: true });
    registerWorkspaceAiHandlers();
    expect(await mockHandlers.get(channels.SESSION)!(event, rootA)).toMatchObject({ success: true, turns: [expect.objectContaining({ text: 'Persisted answer' })] });
    expect(await mockHandlers.get(channels.SESSION)!(event, rootB)).toMatchObject({ success: true, turns: [] });
    mockSaveHistory = false;
    expect(await mockHandlers.get(channels.SAVE_SESSION)!(event, rootA, [{ id: 'disabled', role: 'user', text: 'Do not persist' }])).toMatchObject({ success: true, persistent: false });
    expect(await mockHandlers.get(channels.SESSION)!(event, rootA)).toMatchObject({ turns: [], persistent: false });
    mockSaveHistory = true;
    expect(await mockHandlers.get(channels.SESSION)!(event, rootA)).toMatchObject({ turns: [expect.objectContaining({ text: 'Persisted answer' })] });
  });
  test('clear removes only this root saved bytes even while history saving is disabled', async () => {
    const privateTurns = [{ id: 'private', role: 'user', text: 'A private transcript' }], otherTurns = [{ id: 'other', role: 'user', text: 'Other project transcript' }];
    await mockHandlers.get(channels.SAVE_SESSION)!(event, rootA, privateTurns);
    await mockHandlers.get(channels.SAVE_SESSION)!(event, rootB, otherTurns);
    const folder = path.join(mockUserData, 'ide-conversations'); expect(fs.readdirSync(folder)).toHaveLength(2);
    mockSaveHistory = false;
    expect(await mockHandlers.get(channels.SAVE_SESSION)!(event, rootA, [])).toMatchObject({ success: true });
    expect(fs.readdirSync(folder)).toHaveLength(1);
    expect(fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), 'utf8')).not.toContain('A private transcript');
    mockSaveHistory = true; registerWorkspaceAiHandlers();
    expect(await mockHandlers.get(channels.SESSION)!(event, rootA)).toMatchObject({ turns: [] });
    expect(await mockHandlers.get(channels.SESSION)!(event, rootB)).toMatchObject({ turns: [expect.objectContaining({ text: 'Other project transcript' })] });
  });
  test('failed transcript removal is reported and preserves its recovery bytes', async () => {
    await mockHandlers.get(channels.SAVE_SESSION)!(event, rootA, [{ id: 'saved', role: 'user', text: 'retain until deletion succeeds' }]);
    const folder = path.join(mockUserData, 'ide-conversations'), file = path.join(folder, fs.readdirSync(folder)[0]), before = fs.readFileSync(file);
    const unlink = jest.spyOn(require('node:fs'), 'unlinkSync').mockImplementation(() => { throw new Error('Deletion locked'); });
    try { expect(await mockHandlers.get(channels.SAVE_SESSION)!(event, rootA, [])).toMatchObject({ success: false, error: 'Deletion locked' }); }
    finally { unlink.mockRestore(); }
    expect(fs.readFileSync(file)).toEqual(before);
  });
});
