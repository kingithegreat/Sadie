/**
 * "Save my conversations to this PC" has to actually decide something.
 *
 * `saveConversationHistory` was declared in the main-process Settings,
 * defaulted to true, merged into every getSettings() result, shipped to the
 * renderer over IPC and written back to disk on every save — and no branch
 * anywhere read it. Someone who set it to false in user-settings.json still had
 * every message written to conversation-history.json verbatim.
 *
 * That transport is exactly why a casual grep made it look alive: the identifier
 * appears in plenty of places, and none of them is a decision.
 *
 * These assert the decision, at the one handler that does the writing.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-history-'));

const handlers: Record<string, Function> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function) => { handlers[channel] = fn; },
    on: jest.fn(),
  },
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  app: { isPackaged: false, getPath: () => userData, getAppPath: () => userData },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

const saveConversation = jest.fn((_conversation: any) => true);
jest.mock('../memory-manager', () => {
  const actual = jest.requireActual('../memory-manager');
  return {
    ...actual,
    MemoryManager: {
      ...actual.MemoryManager,
      saveConversation: (conversation: any) => saveConversation(conversation),
      loadConversationStore: jest.fn(() => ({ conversations: [] })),
      getConversation: jest.fn(() => null),
    },
  };
});

const settings: Record<string, unknown> = {};
jest.mock('../config-manager', () => {
  const actual = jest.requireActual('../config-manager');
  return { ...actual, getSettings: () => settings };
});

import { registerIpcHandlers } from '../ipc-handlers';

const CONVERSATION = {
  id: 'c1',
  title: 'A chat',
  messages: [{ role: 'user', content: 'something private' }],
} as any;

describe('saveConversationHistory decides whether chats are written', () => {
  beforeAll(() => {
    (global as any).__homebot_ipc_registered = false;
    registerIpcHandlers();
  });

  beforeEach(() => {
    saveConversation.mockClear();
    for (const k of Object.keys(settings)) delete settings[k];
  });

  const save = (c: any) => handlers['homebot:save-conversation'](null, c);

  it('writes the conversation when the setting is on', async () => {
    settings.saveConversationHistory = true;

    const res = await save(CONVERSATION);

    expect(saveConversation).toHaveBeenCalledWith(CONVERSATION);
    expect(res.success).toBe(true);
  });

  it('writes nothing when the setting is off', async () => {
    settings.saveConversationHistory = false;

    const res = await save(CONVERSATION);

    // The whole point. Before this existed, the call went through regardless.
    expect(saveConversation).not.toHaveBeenCalled();
    // Reported as handled rather than failed — the renderer asked for a save and
    // the user's own preference answered it, which is not an error to surface.
    expect(res.success).toBe(true);
    expect(res.skipped).toBe('history-disabled');
  });

  it('writes when the setting is absent, so an existing install is unchanged', async () => {
    // Only an explicit false turns it off: `undefined` on an older profile must
    // keep behaving exactly as it did before this setting was honoured.
    const res = await save(CONVERSATION);

    expect(saveConversation).toHaveBeenCalledWith(CONVERSATION);
    expect(res.success).toBe(true);
  });
});
