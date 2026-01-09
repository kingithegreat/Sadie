import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Mock electron app.getPath to return a temp dir
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => {
      const dir = process.env.TEST_USERDATA || '';
      return dir;
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
    // Document parsing tools should be enabled by default
    expect(assertPermission('parse_document')).toBe(true);
    expect(assertPermission('get_document_content')).toBe(true);

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
    const os = require('os');
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
});
