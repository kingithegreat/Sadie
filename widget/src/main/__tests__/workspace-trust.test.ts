// Real filesystem fixtures use the repository's explicit I/O budget.
jest.setTimeout(15_000);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockHome: string, mockProfile: string, mockWindow: any;
const mockPicker = jest.fn();
jest.mock('electron', () => ({ app: { getPath: () => mockProfile }, dialog: { showOpenDialog: (...args: any[]) => mockPicker(...args) } }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome }));
jest.mock('../window-manager', () => ({ getMainWindow: () => mockWindow }));
import { checkedAnyTrustedWorkspacePath, checkedTrustedWorkspacePath, chooseTrustedWorkspaceFolder, revokeTrustedWorkspaceFolder, validateTrustedWorkspaceRoot } from '../workspace-trust';

describe('native-picked project trust outside HOME', () => {
  let directory: string, external: string, event: any;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-project-trust-'));
    mockHome = path.join(directory, 'home'); mockProfile = path.join(mockHome, 'profile'); external = path.join(directory, 'external');
    fs.mkdirSync(mockHome); fs.mkdirSync(external); fs.mkdirSync(mockProfile);
    const sender = { id: 1, mainFrame: {} }; mockWindow = { webContents: sender, isDestroyed: () => false }; event = { sender, senderFrame: sender.mainFrame };
    mockPicker.mockReset(); mockPicker.mockResolvedValue({ canceled: false, filePaths: [external] });
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  test('arbitrary renderer paths fail; native choice permits only that canonical subtree and persists', async () => {
    expect(() => validateTrustedWorkspaceRoot(external)).toThrow('picker');
    expect(() => checkedAnyTrustedWorkspacePath(path.join(external, 'code.ts'))).toThrow('not in');
    expect(await chooseTrustedWorkspaceFolder(event)).toEqual({ cancelled: false, root: fs.realpathSync(external) });
    expect(validateTrustedWorkspaceRoot(external)).toBe(fs.realpathSync(external));
    expect(checkedTrustedWorkspacePath(external, 'code.ts')).toBe(path.join(external, 'code.ts'));
    expect(checkedAnyTrustedWorkspacePath(path.join(external, 'code.ts'))).toBe(path.join(external, 'code.ts'));
    expect(() => checkedTrustedWorkspacePath(external, path.join(directory, 'other.ts'))).toThrow('outside');
    const disk = JSON.parse(fs.readFileSync(path.join(mockProfile, 'ide-trusted-folders.json'), 'utf8'));
    expect(disk.roots).toEqual([fs.realpathSync(external)]);
    expect(() => revokeTrustedWorkspaceFolder({ sender: { id: 2 }, senderFrame: event.senderFrame }, external)).toThrow('HomeBot');
    expect(validateTrustedWorkspaceRoot(external)).toBe(fs.realpathSync(external));
    revokeTrustedWorkspaceFolder(event, external);
    expect(() => validateTrustedWorkspaceRoot(external)).toThrow('picker');
  });
  test('wrong window/frame or a window changed while native picker is open cannot grant access', async () => {
    await expect(chooseTrustedWorkspaceFolder({ sender: { id: 2 }, senderFrame: event.senderFrame })).rejects.toThrow('HomeBot');
    await expect(chooseTrustedWorkspaceFolder({ sender: event.sender, senderFrame: {} })).rejects.toThrow('HomeBot');
    expect(mockPicker).not.toHaveBeenCalled();
    let release!: (value: any) => void; mockPicker.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = chooseTrustedWorkspaceFolder(event); mockWindow.webContents.mainFrame = {};
    release({ canceled: false, filePaths: [external] }); await expect(pending).rejects.toThrow('closed');
    expect(fs.existsSync(path.join(mockProfile, 'ide-trusted-folders.json'))).toBe(false);
    expect(() => validateTrustedWorkspaceRoot(external)).toThrow('picker');
  });
  test('changed junctions and revoked metadata do not retain outside-home authority', async () => {
    await chooseTrustedWorkspaceFolder(event);
    const moved = path.join(directory, 'moved'), untrusted = path.join(directory, 'untrusted'); fs.mkdirSync(untrusted);
    fs.renameSync(external, moved); fs.symlinkSync(untrusted, external, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => validateTrustedWorkspaceRoot(external)).toThrow('picker');
    expect(() => checkedAnyTrustedWorkspacePath(path.join(external, 'code.ts'))).toThrow('not in');
    fs.writeFileSync(path.join(mockProfile, 'ide-trusted-folders.json'), JSON.stringify({ roots: [] }));
    expect(() => validateTrustedWorkspaceRoot(moved)).toThrow('picker');
  });
  test('home remains usable but drive roots and application profile destinations are protected', async () => {
    expect(validateTrustedWorkspaceRoot(mockHome)).toBe(fs.realpathSync(mockHome));
    expect(checkedAnyTrustedWorkspacePath(path.join(mockHome, 'code.ts'))).toBe(path.join(mockHome, 'code.ts'));
    expect(() => validateTrustedWorkspaceRoot(path.parse(directory).root)).toThrow('System');
    expect(() => validateTrustedWorkspaceRoot(mockProfile)).toThrow('System');
    expect(() => checkedTrustedWorkspacePath(mockHome, path.join(mockProfile, 'settings.json'))).toThrow('protected');
    mockPicker.mockResolvedValue({ canceled: false, filePaths: [mockProfile] });
    await expect(chooseTrustedWorkspaceFolder(event)).rejects.toThrow('protected');
  });
});
