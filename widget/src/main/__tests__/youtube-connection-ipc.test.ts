/** @jest-environment node */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleContractError } from '../../shared/modules/contracts';

const mockHandlers: Record<string, Function> = {};
const mockFrame = {};
const mockContents = { mainFrame: mockFrame };
const mockPicker = jest.fn();
const mockSave = jest.fn();
const mockLoad = jest.fn(() => undefined);
const mockOpen = jest.fn();
let mockEnabled = true;
const mockAssert = () => { if (!mockEnabled) throw new ModuleContractError('MODULE_UNAVAILABLE', 'Enable Production Studio.'); };
const mockTempRoot = os.tmpdir();
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => mockTempRoot }));
jest.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: Function) => { mockHandlers[name] = handler; } },
  dialog: { showOpenDialog: (...args: any[]) => mockPicker(...args) }, shell: { openExternal: mockOpen },
}));
jest.mock('../window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: mockContents }) }));
jest.mock('../message-router', () => ({ requestConfirmationFrom: jest.fn() }));
jest.mock('../tools/registry', () => ({ getTool: jest.fn(), getToolOwner: jest.fn() }));
jest.mock('../config-manager', () => ({ loadIntegrationSecret: mockLoad, saveIntegrationSecret: mockSave }));
jest.mock('../utils/provider-network-policy', () => ({ assertProviderOnlineAccess: jest.fn(), requestProviderEndpoint: jest.fn() }));
jest.mock('../modules/bundled/studio', () => ({ STUDIO_MODULE_ID: 'homebot.production-studio' }));
jest.mock('../modules/bundled', () => ({
  initializeBundledModules: jest.fn(), bundledModuleHost: {
    assertEnabled: () => mockAssert(), invoke: async (_id: string, callback: Function) => { mockAssert(); return callback(); },
  },
}));
import { registerBundledStudioIpc } from '../modules/bundled/studio-gateway';

const event = { sender: mockContents, senderFrame: mockFrame };
const channels = ['status', 'import', 'connect', 'refresh', 'cancel', 'remove'];
const invoke = (name: string, sender: any = event, ...args: any[]) => mockHandlers[`homebot:media:youtube:${name}`](sender, ...args);
let fixture: string;
beforeEach(() => {
  jest.clearAllMocks(); mockEnabled = true;
  fixture = fs.mkdtempSync(path.join(mockTempRoot, 'homebot-youtube-ipc-'));
  registerBundledStudioIpc();
});
afterEach(() => { fs.rmSync(fixture, { recursive: true, force: true }); });

test.each(channels)('%s requires the main frame, zero arguments and an enabled Studio before any side effect', async name => {
  for (const sender of [{}, { sender: {}, senderFrame: mockFrame }, { sender: mockContents, senderFrame: {} }]) {
    expect(await invoke(name, sender)).toMatchObject({ ok: false, code: 'INVALID_SENDER' });
  }
  expect(await invoke(name, event, { file: 'arbitrary.json', module: 'core', allowCloud: true }))
    .toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  mockEnabled = false;
  expect(await invoke(name)).toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
  expect(mockLoad).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
  expect(mockPicker).not.toHaveBeenCalled(); expect(mockOpen).not.toHaveBeenCalled();
});

test('native import reaches the real parser and persists only the scoped desktop client', async () => {
  const file = path.join(fixture, 'desktop.json');
  fs.writeFileSync(file, JSON.stringify({ installed: { client_id: '123-fixture.apps.googleusercontent.com', client_secret: 'synthetic-client-secret', token_uri: 'https://untrusted.invalid' } }));
  mockPicker.mockResolvedValue({ canceled: false, filePaths: [file] });
  expect(await invoke('import')).toMatchObject({ ok: true });
  expect(mockSave).toHaveBeenCalledWith('youtube.desktop', JSON.stringify({ version: 1, client: { id: '123-fixture.apps.googleusercontent.com', secret: 'synthetic-client-secret' } }));
  expect(mockOpen).not.toHaveBeenCalled();
});

test('cancelling the picker or disabling Studio while it is open cannot save a client', async () => {
  mockPicker.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  expect(await invoke('import')).toMatchObject({ ok: true, cancelled: true });
  mockPicker.mockImplementationOnce(async () => { mockEnabled = false; return { canceled: false, filePaths: [path.join(fixture, 'missing.json')] }; });
  expect(await invoke('import')).toMatchObject({ ok: false });
  expect(mockSave).not.toHaveBeenCalled();
});

test('oversize files and file-system errors return safe messages without writing', async () => {
  const file = path.join(fixture, 'large.json'); fs.writeFileSync(file, 'x'.repeat(65_537));
  mockPicker.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
  expect(await invoke('import')).toMatchObject({ ok: false, error: expect.stringContaining('small Desktop app JSON') });
  const privatePath = path.join(fixture, 'private-filename.json');
  mockPicker.mockResolvedValueOnce({ canceled: false, filePaths: [privatePath] });
  const result = await invoke('import');
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(privatePath);
  expect(mockSave).not.toHaveBeenCalled();
});
