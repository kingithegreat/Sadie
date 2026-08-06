import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-e2e-${Date.now()}`);
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  return base;
}

async function completeFirstRunWizard(page: any, opts: { optInTelemetry?: boolean } = {}) {
  await expect(page.getByText('Welcome to HomeBot')).toBeVisible({ timeout: 15000 });
  const modal = page.locator('.first-run-modal');
  // Choose Local path
  await modal.getByRole('button', { name: /Local \(Ollama\)/i }).click();
  await expect(page.getByText('Local Setup')).toBeVisible({ timeout: 5000 });
  // Advance to done
  await modal.getByRole('button', { name: /Next|Continue anyway/i }).click();
  await expect(page.getByText("You're all set!")).toBeVisible({ timeout: 5000 });
  if (opts.optInTelemetry) {
    await modal.locator('.wizard-telemetry-consent input[type="checkbox"]').check();
  }
  await modal.getByRole('button', { name: /Get Started/i }).click();
}

test.describe('First-run onboarding and config persistence', () => {
  test('fresh profile shows first-run modal and persists after finish', async () => {
    const tmp = makeTempProfile();
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // FirstRun wizard should be visible
    await expect(page.getByText('Welcome to HomeBot')).toBeVisible();

    // Path selection cards should be visible
    await expect(page.getByText('Local (Ollama)')).toBeVisible();
    await expect(page.getByText('Cloud API')).toBeVisible();

    // Complete via local path
    await completeFirstRunWizard(page);

    // After finish, config.json should exist in userData config path
    const configPath = path.join(tmp, 'config', 'user-settings.json');
    await expect(fs.existsSync(configPath)).toBeTruthy();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.firstRun).toBe(false);
    expect(config.telemetryEnabled).toBe(false);

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
      telemetryEnabled: true,
      permissions: { delete_file: false },
      defaultTeam: 'GSW',
      n8nUrl: 'http://localhost:5678',
      widgetHotkey: 'Ctrl+Shift+Space',
      alwaysOnTop: true
    };
    fs.writeFileSync(confPath, JSON.stringify(initial, null, 2), 'utf-8');

    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);
    // FirstRun modal should not be visible
    await expect(page.getByText('Welcome to HomeBot')).toHaveCount(0);

    const configPath = path.join(tmp, 'config', 'user-settings.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.firstRun).toBe(false);
    expect(config.telemetryEnabled).toBe(true);
    expect(config.defaultTeam).toBe('GSW');

    await app.close();
  });

  test('telemetry is opt-in: checking consent enables it and records a timestamp', async () => {
    const tmp = makeTempProfile();
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    await completeFirstRunWizard(page, { optInTelemetry: true });

    const configPath = path.join(tmp, 'config', 'user-settings.json');
    const waitForConfig = async () => {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (cfg.telemetryEnabled === true) return cfg;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      const runtime = await page.evaluate(async () => await (window as any).electron.getSettings());
      if (runtime && runtime.telemetryEnabled === true) return runtime;
      throw new Error('Timed out waiting for opted-in telemetryEnabled=true');
    };

    const config = await waitForConfig();
    expect(config.telemetryEnabled).toBe(true);
    expect(typeof config.telemetryConsentTimestamp).toBe('string');

    const consentLog = path.join(tmp, 'logs', 'telemetry-consent.log');
    if (fs.existsSync(consentLog)) {
      const contents = fs.readFileSync(consentLog, 'utf-8');
      expect(contents.includes('consent_given')).toBe(true);
    }

    await app.close();
  });

  test('skip setup still marks firstRun as false', async () => {
    const tmp = makeTempProfile();
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    await expect(page.getByText('Welcome to HomeBot')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Skip setup/i }).click();

    // Modal should close
    await expect(page.getByText('Welcome to HomeBot')).toHaveCount(0);

    const configPath = path.join(tmp, 'config', 'user-settings.json');
    const start = Date.now();
    while (Date.now() - start < 3000 && !fs.existsSync(configPath)) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.firstRun).toBe(false);
    }

    await app.close();
  });
});
