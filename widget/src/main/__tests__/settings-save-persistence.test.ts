const fs: typeof import('fs') = require('fs');
import { join } from 'path';
import os from 'os';

jest.setTimeout(15_000);
jest.mock('electron', () => ({
  app: { getPath: () => process.env.TEST_USERDATA },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));
import { getSettings, getSettingsPath, invalidateSettingsCache, saveSettings } from '../config-manager';

let temp: string;
let oldEnv: string | undefined;
beforeEach(() => {
  oldEnv = process.env.TEST_USERDATA;
  temp = fs.mkdtempSync(join(os.tmpdir(), 'homebot-settings-save-'));
  process.env.TEST_USERDATA = temp;
  invalidateSettingsCache();
  saveSettings({ ...getSettings(), firstRun: false, useCustomLLM: true });
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env.TEST_USERDATA = oldEnv;
  if (oldEnv === undefined) delete process.env.TEST_USERDATA;
  invalidateSettingsCache();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('a failed write preserves the old disk settings and active cache; retry persists and reloads', () => {
  const file = getSettingsPath();
  const oldBytes = fs.readFileSync(file, 'utf8');
  const realWrite = fs.writeFileSync;
  const write = jest.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
    // A write can fail after truncating/writing some bytes, e.g. a full disk.
    if (String(target).includes('user-settings.json')) {
      realWrite(target, '{partial', options);
      throw new Error('disk full');
    }
    return realWrite(target, data, options);
  });
  expect(() => saveSettings({ ...getSettings(), useCustomLLM: false })).toThrow('disk full');
  expect(fs.readFileSync(file, 'utf8')).toBe(oldBytes);
  expect(getSettings().useCustomLLM).toBe(true);
  expect(fs.readdirSync(join(temp, 'config'))).toEqual(['user-settings.json']);
  write.mockRestore();
  saveSettings({ ...getSettings(), useCustomLLM: false });
  invalidateSettingsCache();
  expect(getSettings().useCustomLLM).toBe(false);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).useCustomLLM).toBe(false);
});

test('failed replacement leaves previous settings and cleans the pending file', () => {
  const file = getSettingsPath();
  const oldBytes = fs.readFileSync(file, 'utf8');
  jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('destination read-only'); });
  expect(() => saveSettings({ ...getSettings(), useCustomLLM: false })).toThrow('destination read-only');
  expect(fs.readFileSync(file, 'utf8')).toBe(oldBytes);
  invalidateSettingsCache();
  expect(getSettings().useCustomLLM).toBe(true);
  expect(fs.readdirSync(join(temp, 'config'))).toEqual(['user-settings.json']);
});

test('encryption before a failed write does not mutate the caller or active nested settings', () => {
  saveSettings({ ...getSettings(), customLLM: { name: 'Fixture', apiUrl: 'https://fixture.invalid', apiKey: 'fixture-only', model: 'fixture', enabled: true, provider: 'openai' } });
  const next = { ...getSettings(), useCustomLLM: false };
  jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('disk read-only'); });
  expect(() => saveSettings(next)).toThrow('disk read-only');
  expect(next.customLLM?.apiKey).toBe('fixture-only');
  expect(getSettings().customLLM?.apiKey).toBe('fixture-only');
  expect(getSettings().useCustomLLM).toBe(true);
});
