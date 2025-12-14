import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `sadie-e2e-${Date.now()}`);
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  return base;
}

test.describe('First-run onboarding and config persistence', () => {
  test('fresh profile shows first-run modal with safe defaults and persists after finish', async () => {
    const tmp = makeTempProfile();
    // Launch electron with a clean profile
    const { app, page } = await launchElectronApp({ SADIE_E2E: '1', NODE_ENV: 'test' }, tmp);

    // FirstRun modal should be visible - check for telemetry label as a reliable indicator
    await expect(page.getByLabel(/Allow anonymous telemetry/i)).toBeVisible();

    // Telemetry toggle should be OFF
    const telemetryCheckbox = page.locator('input[type="checkbox"]').filter({ hasText: 'Telemetry' }).first();
    // More robust: select via label text
    const telemetryLabel = page.getByLabel(/Allow anonymous telemetry/i);
    await expect(telemetryLabel).toBeVisible();
    const telemetryIsChecked = await telemetryLabel.isChecked();
    expect(telemetryIsChecked).toBe(false);

    // The default NBA team should be 'GSW' - find an input with this value
    const teamInputValue = await page.locator('input[value="GSW"]').first();
    await expect(teamInputValue).toBeVisible();

    // Ensure some dangerous tool toggles (e.g., delete file) are present and OFF within the modal
    const modal = page.locator('div', { hasText: 'Welcome to SADIE' }).first();
    const deleteFileCheckbox = modal.getByLabel('delete file', { exact: true });
    await expect(deleteFileCheckbox).toBeVisible();
    await expect(deleteFileCheckbox).not.toBeChecked();

    // Click Finish setup
    await page.getByRole('button', { name: /Finish/i }).click();

    // After finish, config.json should exist in userData config path
    const configPath = path.join(tmp, 'config', 'user-settings.json');
    await expect(fs.existsSync(configPath)).toBeTruthy();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.firstRun).toBe(false);
    expect(config.telemetryEnabled).toBe(false);
    expect(config.permissions.delete_file).toBe(false);
    expect(config.defaultTeam).toBe('GSW');

    await app.close();
  });

  test('relaunch with same profile does not show first-run', async () => {
    const tmp = makeTempProfile();
    // Create config with firstRun:false to simulate post-onboarding
    const confDir = path.join(tmp, 'config');
    fs.mkdirSync(confDir, { recursive: true });
    const confPath = path.join(confDir, 'user-settings.json');
    const initial = {
      firstRun: false,
      telemetryEnabled: false,
      permissions: { delete_file: false },
      defaultTeam: 'GSW',
      n8nUrl: 'http://localhost:5678',
      widgetHotkey: 'Ctrl+Shift+Space',
      alwaysOnTop: true
    };
    fs.writeFileSync(confPath, JSON.stringify(initial, null, 2), 'utf-8');

    const { app, page } = await launchElectronApp({ SADIE_E2E: '1', NODE_ENV: 'test' }, tmp);
    // FirstRun modal should not be visible
    await expect(page.getByText('Welcome to SADIE')).toHaveCount(0);

    // The settings persisted should be accessible via menu or direct saved file - verify the values loaded
    const configPath = path.join(tmp, 'config', 'user-settings.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.firstRun).toBe(false);
    expect(config.telemetryEnabled).toBe(false);
    expect(config.defaultTeam).toBe('GSW');

    await app.close();
  });

  test('enable telemetry then decline consent will not write consent', async () => {
    const tmp = makeTempProfile();
    const { app, page } = await launchElectronApp({ SADIE_E2E: '1', NODE_ENV: 'test' }, tmp);

    // In fresh profile initial modal shows; open settings, toggle telemetry on
    await page.getByRole('button', { name: /Settings/i }).click();
    // The telemetry toggle is in SettingsPanel; toggle it on
    const settingsPanel = page.locator('.settings-panel');
    // Click to open the TelemetryConsentModal (the control only toggles after consent)
    await settingsPanel.getByLabel('🛡️ Telemetry (opt-in)', { exact: true }).click();

    // TelemetryConsentModal should be visible; click Decline
    await page.getByRole('button', { name: /Decline/i }).click();

    // Settings should still show telemetry disabled
    const closeBtn = page.getByRole('button', { name: /Close/i });
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
    const configPath = path.join(tmp, 'config', 'user-settings.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.telemetryEnabled).toBe(false);
    expect(config.telemetryConsentTimestamp).toBe(undefined);

    // The consent log should not contain a consent_given entry
    const consentLog = path.join(tmp, 'logs', 'telemetry-consent.log');
    if (fs.existsSync(consentLog)) {
      const contents = fs.readFileSync(consentLog, 'utf-8');
      expect(contents.includes('consent_given')).toBe(false);
    }

    await app.close();
  });
});
