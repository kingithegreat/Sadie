const mockHandlers: Record<string, Function> = {};
const mockFrame = {};
const mockContents = { mainFrame: mockFrame };
const mockController = { list: jest.fn(() => ({ ok: true, modules: [] })), setEnabled: jest.fn(async () => ({ ok: true })) };
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: Function) => { mockHandlers[name] = handler; } } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: mockContents }) }));
jest.mock('../modules/bundled', () => ({ initializeBundledModules: jest.fn(), bundledModuleController: mockController, onBundledModulesChanged: jest.fn(() => jest.fn()) }));
import { registerModuleControlIpc } from '../modules/module-ipc';

beforeEach(() => { jest.clearAllMocks(); registerModuleControlIpc(); });
const event = { sender: mockContents, senderFrame: mockFrame };

test.each([
  {},
  { sender: {}, senderFrame: mockFrame },
  { sender: mockContents, senderFrame: {} },
])('rejects foreign windows and subframes before dispatch', async sender => {
  expect(await mockHandlers['homebot:modules:set-enabled'](sender, 'homebot.production-studio', false)).toMatchObject({ ok: false, code: 'INVALID_SENDER' });
  expect(await mockHandlers['homebot:modules:list'](sender)).toMatchObject({ ok: false, code: 'INVALID_SENDER' });
  expect(mockController.setEnabled).not.toHaveBeenCalled();
  expect(mockController.list).not.toHaveBeenCalled();
});

test.each([
  [], ['homebot.production-studio', 'false'], [{ id: 'homebot.production-studio', granted: true }, true],
  ['homebot.production-studio', false, { permissions: ['*'] }],
])('rejects malformed payloads without changing a module', async (...args) => {
  expect(await mockHandlers['homebot:modules:set-enabled'](event, ...args)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  expect(mockController.setEnabled).not.toHaveBeenCalled();
});

test('passes only the validated identity and boolean to the Core controller', async () => {
  expect(await mockHandlers['homebot:modules:list'](event)).toEqual({ ok: true, modules: [] });
  expect(await mockHandlers['homebot:modules:set-enabled'](event, 'homebot.production-studio', false)).toEqual({ ok: true });
  expect(mockController.setEnabled).toHaveBeenCalledWith('homebot.production-studio', false);
  expect(await mockHandlers['homebot:modules:list'](event, { install: true })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
});
