import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-backup-security-'));
fs.mkdirSync(path.join(testHome, 'Desktop'));
const handlers: Record<string, Function> = {};
const settings: Record<string, unknown> = {};

jest.setTimeout(15_000);
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => testHome }));
jest.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Function) => { handlers[channel] = fn; }, on: jest.fn() },
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  app: { isPackaged: false, getPath: () => testHome, getAppPath: () => testHome, getVersion: () => '1.1.0' },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));
jest.mock('../config-manager', () => ({
  ...jest.requireActual('../config-manager'), getSettings: () => settings,
}));
jest.mock('../memory-manager', () => ({
  ...jest.requireActual('../memory-manager'),
  MemoryManager: {
    ...jest.requireActual('../memory-manager').MemoryManager,
    loadConversationStore: () => ({ conversations: [{ id: 'backup-chat', title: 'A saved chat' }] }),
    loadPreferences: () => ({ language: 'en' }),
    loadToolStats: () => ({ calls: 2 }),
  },
}));

import { registerIpcHandlers } from '../ipc-handlers';

describe('Export Backup writes a credential-free file', () => {
  beforeAll(() => {
    (global as any).__homebot_ipc_registered = false;
    registerIpcHandlers();
  });
  afterAll(() => {
    // Only this freshly created fixture directory is removed; no junctions exist here.
    fs.rmSync(testHome, { recursive: true, force: true });
  });
  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key];
  });

  it('omits every configured credential without changing the live settings', async () => {
    const flatSecrets = [
      'tavilyApiKey', 'serperApiKey', 'anthropicApiKey', 'openaiApiKey',
      'geminiApiKey', 'moonshotApiKey', 'codeApiKey', 'stableHordeApiKey',
      'calendarIcsUrl', 'n8nApiKey',
    ];
    for (const key of flatSecrets) settings[key] = `DUMMY_SECRET_${key}`;
    Object.assign(settings, {
      theme: 'dark', permissions: { rag_index: false },
      n8nUrl: 'http://localhost:5678',
      providerApiKeys: { arbitraryProvider: 'DUMMY_SECRET_provider' },
      customLLM: { apiKey: 'DUMMY_SECRET_custom', apiUrl: 'https://example.invalid/v1', model: 'fixture' },
      _integrationSecrets: { grant: 'enc:v1:DUMMY_SECRET_private' },
    });
    const before = JSON.stringify(settings);
    const result = await handlers['homebot:export-settings'](null);
    expect(result.success).toBe(true);
    expect(path.dirname(result.path)).toBe(path.join(testHome, 'Desktop'));
    const raw = fs.readFileSync(result.path, 'utf8');
    expect(raw).not.toContain('DUMMY_SECRET_');
    const backup = JSON.parse(raw);
    for (const key of [...flatSecrets, 'providerApiKeys', '_integrationSecrets']) {
      expect(backup.settings).not.toHaveProperty(key);
    }
    expect(backup.settings.customLLM).toEqual({ apiUrl: 'https://example.invalid/v1', model: 'fixture' });
    expect(backup.settings.theme).toBe('dark');
    expect(backup.settings.permissions).toEqual({ rag_index: false });
    expect(backup.settings.n8nUrl).toBe('http://localhost:5678');
    expect(backup.conversations.conversations[0].id).toBe('backup-chat');
    expect(backup.preferences).toEqual({ language: 'en' });
    expect(backup.toolStats).toEqual({ calls: 2 });
    expect(JSON.stringify(settings)).toBe(before);
  });

  it('keeps an ordinary backup valid when no credentials are configured', async () => {
    Object.assign(settings, { theme: 'light', saveConversationHistory: true });
    const result = await handlers['homebot:export-settings'](null);
    expect(result.success).toBe(true);
    const backup = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(backup._homebot_backup).toBe(true);
    expect(backup.settings).toEqual(settings);
  });
});
