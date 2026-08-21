import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
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
      // Real DPAPI THROWS on data that is not its ciphertext. The old mock
      // returned the input unchanged, which made decrypt-until-stable
      // (legacy multi-wrap recovery) untestable — plaintext would "decrypt"
      // into garbage forever instead of stopping.
      if (!str.startsWith('ENC:')) throw new Error('not ciphertext');
      return str.slice(4);
    })
  }
}));

import { getSettings, saveSettings, assertPermission, getAndClearConfigRecovery, getSettingsPath } from '../../main/config-manager';

describe('config-manager integration tests', () => {
  const temp = join(os.tmpdir(), 'homebot-test-' + Date.now());

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
    // Telemetry is OPT-IN: off until the user explicitly consents
    // (DEFAULT_SETTINGS cites NZ Privacy Act 2020, IPP 3). This test asserted
    // the old opt-out default and was red on main — the code changed
    // deliberately; the test hadn't caught up.
    expect(s.telemetryEnabled).toBe(false);
    // The user consents: enabling + saving stamps timestamp and version.
    s.telemetryEnabled = true;
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
    // Opt-in: consent is only recorded when telemetry is explicitly enabled.
    const s = getSettings();
    s.telemetryEnabled = true;
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
    // Opt-in world: give consent first, then export reflects it.
    const s = getSettings();
    s.telemetryEnabled = true;
    saveSettings(s);
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
    chatModel: 'qwen2.5:7b',
    visionModel: 'moondream',
    uncensoredModel: 'dolphin-mistral:7b',
    theme: 'system',
    alwaysOnTop: true,
    globalHotkey: 'Ctrl+Shift+Space',
    confirmDangerousActions: true,
    saveConversationHistory: true,
    hideOnBlur: false,
  };

  test('returns settings unchanged when hardwareProfile is undefined', () => {
    const result = applyHardwareProfile({ ...base });
    expect(result.chatModel).toBe('qwen2.5:7b');
    expect(result.visionModel).toBe('moondream');
  });

  test('applies 4gb profile', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '4gb' });
    expect(result.chatModel).toBe('qwen2.5:7b');
    expect(result.visionModel).toBe('moondream');
    expect(result.uncensoredModel).toBe('dolphin-mistral:7b');
  });

  test('applies 8gb profile', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '8gb' });
    expect(result.chatModel).toBe('qwen2.5:7b');
    expect(result.visionModel).toBe('moondream');
    expect(result.uncensoredModel).toBe('dolphin-mistral:7b');
  });

  test('applies 16gb+ profile', () => {
    const result = applyHardwareProfile({ ...base, hardwareProfile: '16gb+' });
    expect(result.chatModel).toBe('qwen2.5:7b');
    expect(result.visionModel).toBe('moondream');
    expect(result.uncensoredModel).toBe('dolphin-mistral:7b');
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

  describe('corrupt settings file recovery', () => {
    const { invalidateSettingsCache } = require('../../main/config-manager');

    afterEach(() => {
      // Clean up any backup files this describe block created so they don't
      // leak into other tests' directory listings.
      invalidateSettingsCache();
      getAndClearConfigRecovery(); // drain in case a test didn't consume it
    });

    test('an existing-but-corrupt settings file resets to defaults and is backed up', () => {
      const settingsPath = getSettingsPath();
      const garbage = '{ this is not valid json ,,, }';
      writeFileSync(settingsPath, garbage, 'utf-8');
      invalidateSettingsCache();

      const settings = getSettings();
      // Falls back to defaults rather than throwing / crashing startup.
      expect(settings.firstRun).toBe(true);

      const recovery = getAndClearConfigRecovery();
      expect(recovery).not.toBeNull();
      expect(recovery!.reason).toMatch(/invalid/i);
      expect(recovery!.backupPath).toBeTruthy();

      // The original (corrupt) bytes must be preserved in the backup file —
      // this is the whole point of backing up before resetting to defaults.
      const backedUp = readFileSync(recovery!.backupPath as string, 'utf-8');
      expect(backedUp).toBe(garbage);

      rmSync(recovery!.backupPath as string, { force: true });
    });

    test('getAndClearConfigRecovery is one-shot', () => {
      const settingsPath = getSettingsPath();
      writeFileSync(settingsPath, 'not json at all', 'utf-8');
      invalidateSettingsCache();
      getSettings();

      const first = getAndClearConfigRecovery();
      expect(first).not.toBeNull();
      if (first?.backupPath) rmSync(first.backupPath, { force: true });

      const second = getAndClearConfigRecovery();
      expect(second).toBeNull();
    });

    test('a missing settings file does NOT trigger a recovery event', () => {
      const settingsPath = getSettingsPath();
      rmSync(settingsPath, { force: true });
      invalidateSettingsCache();

      getSettings();
      expect(getAndClearConfigRecovery()).toBeNull();
    });
  });
});

describe('settings corruption hardening (the 2026-08-10 incident)', () => {
  // One night produced: a BOM-corrupted file, a 42-file archive loop, a
  // reset that erased the user's keys via a stale renderer snapshot, and a
  // historical 180MB apiKey from non-idempotent encryption. Each rule here
  // maps to one of those.
  const fs = require('fs');

  const freshLoad = () => {
    jest.resetModules();
    return require('../../main/config-manager');
  };

  test('a UTF-8 BOM is not corruption — settings load intact', () => {
    const cm = freshLoad();
    const p = cm.getSettingsPath();
    const s = cm.getSettings();
    s.chatModel = 'bom-survivor:7b';
    cm.saveSettings(s);
    // Simulate PowerShell's Out-File: same JSON, BOM prepended.
    fs.writeFileSync(p, '\uFEFF' + fs.readFileSync(p, 'utf-8'), 'utf-8');

    const cm2 = freshLoad();
    expect(cm2.getSettings().chatModel).toBe('bom-survivor:7b');
    // And no corrupt-archive was produced for it.
    const dir = require('path').dirname(p);
    expect(fs.readdirSync(dir).filter((f: string) => f.includes('.corrupt-'))).toHaveLength(0);
  });

  test('a corrupt file is archived ONCE and repaired in place', () => {
    const cm = freshLoad();
    const p = cm.getSettingsPath();
    fs.writeFileSync(p, 'not json at all', 'utf-8');

    const cm2 = freshLoad();
    cm2.getSettings(); // triggers recovery
    // The file on disk must now parse — no loop fuel left behind.
    expect(() => JSON.parse(fs.readFileSync(p, 'utf-8'))).not.toThrow();

    const dir = require('path').dirname(p);
    const archivesAfterFirst = fs.readdirSync(dir).filter((f: string) => f.includes('.corrupt-')).length;
    expect(archivesAfterFirst).toBe(1);

    // A later cold read must NOT archive again.
    const cm3 = freshLoad();
    cm3.getSettings();
    const archivesAfterSecond = fs.readdirSync(dir).filter((f: string) => f.includes('.corrupt-')).length;
    expect(archivesAfterSecond).toBe(1);
  });

  test('encryption is idempotent — round-tripping a saved file cannot grow a key', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.geminiApiKey = 'AIza-plain-key';
    cm.saveSettings(s);

    const raw1 = JSON.parse(fs.readFileSync(cm.getSettingsPath(), 'utf-8'));
    // Simulate the growth loop: save the RAW (already-encrypted) file content
    // straight back, twice. Pre-marker, each pass wrapped the ciphertext again.
    cm.saveSettings(raw1);
    cm.saveSettings(JSON.parse(fs.readFileSync(cm.getSettingsPath(), 'utf-8')));

    const raw2 = JSON.parse(fs.readFileSync(cm.getSettingsPath(), 'utf-8'));
    expect(raw2.geminiApiKey.length).toBe(raw1.geminiApiKey.length);
    // And it still decrypts to the original.
    expect(cm.getSettings().geminiApiKey).toBe('AIza-plain-key');
  });

  test('legacy multiply-encrypted values recover to plaintext on load', () => {
    const cm = freshLoad();
    const p = cm.getSettingsPath();
    // Build a pre-marker triple-wrapped value the way the old bug did.
    const wrap = (v: string) => Buffer.from('ENC:' + v).toString('base64');
    const damaged = wrap(wrap(wrap('sk-original')));
    const onDisk = JSON.parse(fs.readFileSync(p, 'utf-8'));
    onDisk.openaiApiKey = damaged;
    fs.writeFileSync(p, JSON.stringify(onDisk), 'utf-8');

    const cm2 = freshLoad();
    expect(cm2.getSettings().openaiApiKey).toBe('sk-original');
  });

  test('a secret past the size cap is cleared, not persisted', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.tavilyApiKey = 'x'.repeat(20_000);
    cm.saveSettings(s);
    const raw = JSON.parse(fs.readFileSync(cm.getSettingsPath(), 'utf-8'));
    expect(raw.tavilyApiKey).toBe('');
  });

  test('a save that OMITS a secret keeps the one on disk; empty string clears', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.geminiApiKey = 'AIza-keep-me';
    cm.saveSettings(s);

    // Stale-snapshot save: the field is simply absent.
    const stale = cm.getSettings();
    delete (stale as any).geminiApiKey;
    cm.saveSettings(stale);
    expect(cm.getSettings().geminiApiKey).toBe('AIza-keep-me');

    // Explicit clear still works.
    const clearing = cm.getSettings();
    clearing.geminiApiKey = '';
    cm.saveSettings(clearing);
    expect(cm.getSettings().geminiApiKey || '').toBe('');
  });
});

/**
 * Per-provider API keys.
 *
 * The four named fields (anthropic/openai/gemini/moonshot) never covered the
 * other nine providers the picker offers, so groq, cerebras and friends shared
 * customLLM.apiKey and overwrote each other. These pin the map that replaced
 * it: encrypted at rest, merged on save, readable back.
 *
 * Its own temp userData, ASSERTED before anything is written. The first version
 * of this block was appended into a describe whose afterAll deletes its temp
 * dir, so a save landed in the repo's tracked widget/config/user-settings.json
 * and committed a test sentinel as real configuration. Isolation that is
 * assumed is isolation that is not there.
 */
describe('per-provider API keys', () => {
  const temp = join(os.tmpdir(), 'homebot-provider-keys-' + process.pid);

  const freshLoad = () => {
    jest.resetModules();
    return require('../../main/config-manager');
  };

  beforeEach(() => {
    process.env.TEST_USERDATA = temp;
    mkdirSync(temp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('writes land in the temp userData, never in the repo', () => {
    expect(freshLoad().getSettingsPath().startsWith(temp)).toBe(true);
  });

  test('provider keys survive a save/load round trip', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.providerApiKeys = { groq: 'gsk-groq', cerebras: 'csk-cerebras' };
    cm.saveSettings(s);

    const loaded = freshLoad().getSettings();
    expect(loaded.providerApiKeys.groq).toBe('gsk-groq');
    expect(loaded.providerApiKeys.cerebras).toBe('csk-cerebras');
  });

  test('provider keys are ENCRYPTED on disk, never plaintext', () => {
    const cm = freshLoad();
    expect(cm.getSettingsPath().startsWith(temp)).toBe(true);
    const s = cm.getSettings();
    s.providerApiKeys = { groq: 'gsk-PLAINTEXT-SENTINEL' };
    cm.saveSettings(s);

    const raw = readFileSync(cm.getSettingsPath(), 'utf-8');
    // Absence alone is not proof — a dropped map is also absent. Assert the
    // field is present AND is ciphertext.
    const onDisk = JSON.parse(raw).providerApiKeys;
    expect(onDisk).toBeDefined();
    expect(onDisk.groq).toBeDefined();
    expect(onDisk.groq).not.toBe('gsk-PLAINTEXT-SENTINEL');
    expect(onDisk.groq.startsWith('enc:v1:')).toBe(true);   // ENC_PREFIX
    expect(raw).not.toContain('gsk-PLAINTEXT-SENTINEL');
  });

  test('saving one provider does not wipe the others', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.providerApiKeys = { groq: 'gsk-groq', together: 'tog-key' };
    cm.saveSettings(s);

    // A panel that only knew about groq saves just that one.
    const partial = cm.getSettings();
    partial.providerApiKeys = { groq: 'gsk-groq-v2' };
    cm.saveSettings(partial);

    const loaded = freshLoad().getSettings();
    expect(loaded.providerApiKeys.groq).toBe('gsk-groq-v2');
    expect(loaded.providerApiKeys.together).toBe('tog-key');
  });

  test('omitting the map entirely keeps every provider key', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.providerApiKeys = { groq: 'gsk-keep' };
    cm.saveSettings(s);

    const stale = cm.getSettings();
    delete (stale as any).providerApiKeys;
    cm.saveSettings(stale);

    expect(freshLoad().getSettings().providerApiKeys.groq).toBe('gsk-keep');
  });

  test('an explicit empty string clears one provider and leaves the rest', () => {
    const cm = freshLoad();
    const s = cm.getSettings();
    s.providerApiKeys = { groq: 'gsk-bye', cerebras: 'csk-stay' };
    cm.saveSettings(s);

    const clearing = cm.getSettings();
    clearing.providerApiKeys = { groq: '' };
    cm.saveSettings(clearing);

    const loaded = freshLoad().getSettings();
    expect(loaded.providerApiKeys.groq).toBeUndefined();
    expect(loaded.providerApiKeys.cerebras).toBe('csk-stay');
  });
});
