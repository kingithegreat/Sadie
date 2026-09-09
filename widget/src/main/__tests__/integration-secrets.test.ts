/** @jest-environment node */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
jest.mock('electron', () => ({ app: { getPath: () => process.env.TEST_INTEGRATION_CONFIG }, safeStorage: {
  isEncryptionAvailable: jest.fn(() => true),
  encryptString: jest.fn((value: string) => Buffer.from('ENCRYPTED:' + value)),
  decryptString: jest.fn((value: Buffer) => { if (!value.toString().startsWith('ENCRYPTED:')) throw new Error(); return value.toString().slice(10); }),
} }));
import { safeStorage } from 'electron';
import { getSettings, saveSettings, getSettingsPath, loadIntegrationSecret, saveIntegrationSecret, invalidateSettingsCache } from '../config-manager';

describe('main-only integration secrets in the existing configuration store', () => {
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-integration-config-'));
    process.env.TEST_INTEGRATION_CONFIG = directory;
    invalidateSettingsCache(); (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
  });
  afterEach(() => { invalidateSettingsCache(); fs.rmSync(directory, { recursive: true, force: true }); delete process.env.TEST_INTEGRATION_CONFIG; });

  test('round-trips through OS storage but never joins a public settings snapshot', () => {
    const secret = JSON.stringify({ token: 'synthetic-refresh-token' });
    saveIntegrationSecret('youtube.desktop', secret);
    expect(fs.readFileSync(getSettingsPath(), 'utf8')).not.toContain('synthetic-refresh-token');
    expect(loadIntegrationSecret('youtube.desktop')).toBe(secret);
    expect((getSettings() as any)._integrationSecrets).toBeUndefined();
    const original = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'))._integrationSecrets;
    saveSettings({ ...getSettings(), theme: 'light', _integrationSecrets: { 'youtube.desktop': 'renderer-injection' } } as any);
    expect(JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'))._integrationSecrets).toEqual(original);
    expect(loadIntegrationSecret('youtube.desktop')).toBe(secret);
    expect((getSettings() as any)._integrationSecrets).toBeUndefined();
  });

  test('ordinary stale settings saves retain newer grants and removal cannot be undone by that snapshot', () => {
    const snapshot = getSettings();
    saveIntegrationSecret('youtube.desktop', 'first');
    saveIntegrationSecret('youtube.desktop', 'newer');
    saveSettings(snapshot);
    expect(loadIntegrationSecret('youtube.desktop')).toBe('newer');
    saveIntegrationSecret('youtube.desktop', undefined);
    saveSettings(snapshot);
    expect(loadIntegrationSecret('youtube.desktop')).toBeUndefined();
  });

  test('unavailable encryption fails closed and preserves existing configuration', () => {
    saveSettings({ ...getSettings(), theme: 'dark' });
    const before = fs.readFileSync(getSettingsPath(), 'utf8');
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
    expect(() => saveIntegrationSecret('youtube.desktop', 'synthetic-secret')).toThrow(/securely/);
    expect(fs.readFileSync(getSettingsPath(), 'utf8')).toBe(before);
    expect(loadIntegrationSecret('youtube.desktop')).toBeUndefined();
  });

  test('unreadable ciphertext fails closed; local removal remains possible', () => {
    saveIntegrationSecret('youtube.desktop', 'stored');
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
    expect(() => loadIntegrationSecret('youtube.desktop')).toThrow(/unlock/);
    saveIntegrationSecret('youtube.desktop', undefined);
    expect(loadIntegrationSecret('youtube.desktop')).toBeUndefined();
  });

  test('rejects oversized secrets and invalid scopes', () => {
    expect(() => saveIntegrationSecret('youtube.desktop', 'x'.repeat(32_001))).toThrow();
    expect(() => saveIntegrationSecret('__proto__', 'secret')).toThrow();
    expect(() => loadIntegrationSecret('../other')).toThrow();
  });
});
