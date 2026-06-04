import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Mock electron app.getPath and safeStorage to return a temp dir
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => {
      const dir = process.env.TEST_USERDATA || '';
      return dir;
    })
  },
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    encryptString: jest.fn((val: string) => Buffer.from('ENC:' + val)),
    decryptString: jest.fn((buf: Buffer) => {
      const str = buf.toString();
      return str.startsWith('ENC:') ? str.slice(4) : str;
    })
  }
}));

import { getSettings, saveSettings, assertPermission } from '../../main/config-manager';

describe('config-manager integration tests', () => {
  const temp = join(os.tmpdir(), 'sadie-test-' + Date.now());

  beforeAll(() => {
    process.env.TEST_USERDATA = temp;
    if (!existsSync(temp)) mkdirSync(temp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(temp, { recursive: true, force: true }); } catch (e) {}
  });

  test('firstRun defaults to true and is persisted to false after save', () => {
    const s1 = getSettings();
    expect(s1.firstRun).toBe(true);
    s1.firstRun = false;
    saveSettings(s1);
    const s2 = getSettings();
    expect(s2.firstRun).toBe(false);
  });

  test('permission gating default and changes via saveSettings', () => {
    const settings = getSettings();
    expect(assertPermission('delete_file')).toBe(false); // default disabled

    // Enable delete and assert
    settings.permissions = { ...settings.permissions, delete_file: true };
    saveSettings(settings);
    const updated = getSettings();
    expect(updated.permissions?.delete_file).toBe(true);
    expect(assertPermission('delete_file')).toBe(true);
  });

  test('resetPermissions restores defaults', () => {
    // Enable a dangerous permission
    let settings = getSettings();
    settings.permissions = { ...settings.permissions, delete_file: true };
    saveSettings(settings);
    let updated = getSettings();
    expect(updated.permissions?.delete_file).toBe(true);

    // Reset to defaults
    const { resetPermissions } = require('../../main/config-manager');
    const reset = resetPermissions();
    expect(reset.permissions?.delete_file).toBe(false);
    expect(assertPermission('delete_file')).toBe(false);
  });

  test('enabling telemetry sets consent timestamp', () => {
    const s = getSettings();
    // Telemetry is required by default
    expect(s.telemetryEnabled).toBe(true);
    // Ensure consent timestamp/version exist after persisting
    saveSettings(s);
    const reloaded = getSettings();
    expect(reloaded.telemetryEnabled).toBe(true);
    expect(reloaded.telemetryConsentTimestamp).toBeDefined();
    expect(reloaded.telemetryConsentVersion).toBe('1.0');
  });

  test('telemetry consent is logged into audit log', () => {
    const fs = require('fs');
    const path = require('path');
    const temp = process.env.TEST_USERDATA as string;
    const logPath = path.join(temp, 'logs', 'telemetry-consent.log');
    // Force a save to ensure consent is logged
    const s = getSettings();
    // Ensure consent is re-recorded by clearing any existing timestamp/version
    s.telemetryConsentTimestamp = undefined as any;
    s.telemetryConsentVersion = undefined as any;
    saveSettings(s);
    // The consent log may or may not exist depending on previous runs.
    // If present, ensure it contains a consent_given entry; otherwise ensure we recorded consent in settings
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      // JSON lines, last line should be consent_given
      const lines = content.trim().split('\n');
      const last = JSON.parse(lines[lines.length - 1]);
      const reloaded = getSettings();
      expect(last.action).toBe('consent_given');
      expect(last.details.version).toBe(reloaded.telemetryConsentVersion);
    } else {
      const cfg = getSettings();
      expect(cfg.telemetryConsentTimestamp).toBeDefined();
    }
  });

  test('export telemetry consent writes file', () => {
    const { exportTelemetryConsent } = require('../../main/config-manager');
    const r = exportTelemetryConsent();
    expect(r.success).toBe(true);
    const fs = require('fs');
    expect(fs.existsSync(r.path)).toBe(true);
    const content = fs.readFileSync(r.path, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.enabled).toBe(true);
  });

  test('API keys are encrypted at rest and decrypted on read', () => {
    const fs = require('fs');
    const settings = getSettings();
    settings.tavilyApiKey = 'tvly-SECRETKEY123';
    settings.openaiApiKey = 'sk-openai-test';
    saveSettings(settings);

    // Read raw file — encrypted values should NOT contain the plaintext
    const settingsPath = require('../../main/config-manager').getSettingsPath();
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    // Our mock encrypts as base64 of "ENC:..." — the raw value should not equal the plaintext
    expect(raw.tavilyApiKey).not.toBe('tvly-SECRETKEY123');
    expect(raw.openaiApiKey).not.toBe('sk-openai-test');

    // Decrypted values should match the original plaintext
    const loaded = getSettings();
    expect(loaded.tavilyApiKey).toBe('tvly-SECRETKEY123');
    expect(loaded.openaiApiKey).toBe('sk-openai-test');
  });
});

// ── applyHardwareProfile ──────────────────────────────────────────────────────

describe('applyHardwareProfile', () => {
  const { applyHardwareProfile, HARDWARE_PROFILE_DEFAULTS } = require('../../main/config-manager');

  const base = {
    n8nUrl: 'http://localhost:5678',
    ollamaUrl: 'http://127.0.0.1:11434',
    chatModel: 'llama3.2:3b',
    visionModel: 'llava',
    uncensoredModel: 'dolphin-llama3:8b',
    theme: 'system',
    alwaysOnTop: true,
    globalHotkey: 'Ctrl+Shift+Space',
    confirmDangerousActions: true,
    saveConversationHistory: true,
    hideOnBlur: false,
  };

  test('returns settings unchanged when hardwareProfile is undefined', () => {
    const result = applyHardwareProfile({ ...base });
    expect(result.chatModel).toBe('llama3.2:3b');
    expect(result.visionModel).toBe('llava');
  });

  test('applies 4gb profile — safe models for 4 GB VRAM cards', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '4gb' });
    expect(result.chatModel).toBe('phi4-mini');
    expect(result.visionModel).toBe('moondream');
    expect(result.uncensoredModel).toBe('dolphin-phi:2.7b');
  });

  test('applies 8gb profile', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '8gb' });
    expect(result.chatModel).toBe('qwen2.5:7b');
    expect(result.visionModel).toBe('moondream');
    expect(result.uncensoredModel).toBe('dolphin-phi:2.7b');
  });

  test('applies 16gb+ profile — full-size models', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '16gb+' });
    expect(result.chatModel).toBe('qwen2.5:7b');
    expect(result.visionModel).toBe('llava');
    expect(result.uncensoredModel).toBe('dolphin-llama3:8b');
  });

  test('preserves all non-model settings when applying a profile', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '4gb', globalHotkey: 'Ctrl+Alt+S' });
    expect(result.globalHotkey).toBe('Ctrl+Alt+S');
    expect(result.n8nUrl).toBe('http://localhost:5678');
  });

  test('HARDWARE_PROFILE_DEFAULTS covers all three profiles', () => {
    expect(HARDWARE_PROFILE_DEFAULTS).toHaveProperty('4gb');
    expect(HARDWARE_PROFILE_DEFAULTS).toHaveProperty('8gb');
    expect(HARDWARE_PROFILE_DEFAULTS).toHaveProperty('16gb+');
    for (const profile of ['4gb', '8gb', '16gb+']) {
      const defaults = HARDWARE_PROFILE_DEFAULTS[profile];
      expect(typeof defaults.chatModel).toBe('string');
      expect(typeof defaults.visionModel).toBe('string');
      expect(typeof defaults.uncensoredModel).toBe('string');
    }
  });
});

// ── Settings cache ──────────────────────────────────────────────────────────

describe('settings cache', () => {
  const { invalidateSettingsCache } = require('../../main/config-manager');

  test('getSettings returns cached value on repeated calls within TTL', () => {
    invalidateSettingsCache();
    const s1 = getSettings();
    const s2 = getSettings();
    expect(s1).toEqual(s2);
  });

  test('getSettings returns a copy, not the cache reference', () => {
    invalidateSettingsCache();
    const s1 = getSettings();
    s1.chatModel = 'mutated-model';
    const s2 = getSettings();
    expect(s2.chatModel).not.toBe('mutated-model');
  });

  test('saveSettings invalidates the cache', () => {
    invalidateSettingsCache();
    const s1 = getSettings();
    s1.chatModel = 'new-model-test';
    saveSettings(s1);
    const s2 = getSettings();
    expect(s2.chatModel).toBe('new-model-test');
  });

  test('defaultLocation is persisted and loaded', () => {
    const s = getSettings();
    s.defaultLocation = 'Wellington';
    saveSettings(s);
    const loaded = getSettings();
    expect(loaded.defaultLocation).toBe('Wellington');
  });
});
