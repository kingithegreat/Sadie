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

/**
 * Every locator here is scoped to `.first-run-modal`, never to the page.
 *
 * On a machine where a GPU is detected, App.tsx raises a 10-second toast:
 * "…HomeBot has set itself up to run well on this PC — nothing for you to do."
 * getByText is case-insensitive and substring-matching, so an unscoped
 * getByText('On this PC') matched BOTH the wizard's own path button and that
 * toast, and Playwright's strict mode failed on the ambiguity.
 *
 * It depended on timing, so these specs passed run on their own and failed in a
 * full suite — which is what "1 flaky" in the run summary had been for a while.
 * Scoping removes the race rather than retrying through it.
 */
async function completeFirstRunWizard(page: any, opts: { optInTelemetry?: boolean } = {}) {
  const modal = page.locator('.first-run-modal');
  await expect(modal.getByText('Welcome to HomeBot')).toBeVisible({ timeout: 15000 });
  // Choose the run-on-this-PC path
  await modal.getByRole('button', { name: /On this PC/i }).click();
  await expect(page.getByText('Local Setup')).toBeVisible({ timeout: 5000 });
  // Advance to done. The heading there is now HONEST: "You're all set!" only
  // when the local AI actually came up, "Ready when you are" otherwise — and
  // whether it comes up differs by platform on CI runners (the Windows E2E
  // stub reports it ready; linux/mac do not). This helper's job is reaching
  // and finishing the done step, not asserting which outcome the machine
  // earned, so it anchors on the telemetry consent control — present in both.
  await modal.getByRole('button', { name: /Next|Continue anyway/i }).click();
  await expect(modal.getByText(/You're all set!|Ready when you are/)).toBeVisible({ timeout: 5000 });
  await expect(modal.locator('.wizard-telemetry-consent')).toBeVisible({ timeout: 5000 });
  if (opts.optInTelemetry) {
    await modal.locator('.wizard-telemetry-consent input[type="checkbox"]').check();
  }
  await modal.getByRole('button', { name: /Get Started/i }).click();
}

test.describe('First-run onboarding and config persistence', () => {
  test('fresh Windows profile selects ChatGPT subscription and sends its first chat through Codex', async () => {
    test.skip(process.platform !== 'win32', 'The installed Windows CLI path is the acceptance target.');
    test.setTimeout(120_000);
    const tmp = makeTempProfile();
    const isolatedHome = path.join(tmp, 'home');
    const ancientPathways = path.join(isolatedHome, 'Ancient Pathways');
    fs.mkdirSync(ancientPathways, { recursive: true });
    fs.writeFileSync(path.join(ancientPathways, 'run_pipeline.py'), '# isolated acceptance fixture\n');
    const configDir = path.join(tmp, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'mcp-servers.json'), JSON.stringify({ servers: [] }));
    const cliDir = path.join(tmp, 'cli');
    fs.mkdirSync(cliDir);
    fs.writeFileSync(path.join(cliDir, 'codex.cmd'), [
      '@echo off',
      'if "%1"=="login" (',
      '  echo Logged in using ChatGPT',
      '  exit /b 0',
      ')',
      'if "%1"=="exec" (',
      '  echo {"type":"item.completed","item":{"type":"agent_message","text":"subscription fixture answered"}}',
      '  exit /b 0',
      ')',
      'exit /b 2',
    ].join('\r\n'));
    const { app, page } = await launchElectronApp({
      HOMEBOT_E2E: '1',
      HOMEBOT_E2E_BYPASS_MOCK: '1',
      HOMEBOT_DIRECT_OLLAMA: '1',
      NODE_ENV: 'test',
      USERPROFILE: isolatedHome,
      HOME: isolatedHome,
      ANCIENT_PATHWAYS_DIR: ancientPathways,
      HOMEBOT_MOVIE_PROJECTS_DIR: path.join(isolatedHome, 'movie-projects'),
      PATH: `${cliDir}${path.delimiter}${process.env.PATH || ''}`,
    }, tmp);
    const ownedProcess = app.process();
    expect(ownedProcess.pid).toBeGreaterThan(0);
    try {
      expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
      const modal = page.locator('.first-run-modal');
      await expect(modal.getByText('Welcome to HomeBot')).toBeVisible();
      await modal.getByRole('button', { name: 'Online' }).click();
      await modal.getByRole('button', { name: 'ChatGPT subscription' }).click();
      await modal.getByRole('button', { name: 'Check sign-in' }).click();
      await expect(modal.getByText('Subscription sign-in found. Ready to try a chat.')).toBeVisible();
      await modal.getByRole('button', { name: 'Next' }).click();
      await modal.getByRole('button', { name: 'Get Started' }).click();
      await expect(modal).toHaveCount(0);

      const config = JSON.parse(fs.readFileSync(path.join(tmp, 'config', 'user-settings.json'), 'utf8'));
      expect(config.firstRun).toBe(false);
      expect(config.useCustomLLM).toBe(true);
      expect(config.uncensoredMode).toBe(false);
      expect(config.customLLM).toMatchObject({ provider: 'codex', model: 'default', apiKey: '', enabled: true });

      const beforeCount = await page.locator('[data-role="assistant-message"]').count();
      await page.getByLabel('Message HomeBot').fill('Hello from a fresh profile');
      await page.locator('button.send-button').click();
      const assistant = page.locator('[data-role="assistant-message"]').nth(beforeCount);
      await expect(assistant).toContainText('subscription fixture answered', { timeout: 20000 });
      await expect(assistant).toHaveAttribute('data-state', 'finished');
      expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
    } finally {
      console.log(`[REL-1 E2E] closing owned Electron PID ${ownedProcess.pid}`);
      await app.close();
      expect(ownedProcess.exitCode !== null || ownedProcess.signalCode !== null).toBe(true);
      console.log(`[REL-1 E2E] owned Electron PID ${ownedProcess.pid} exited`);
    }
  });

  test('fresh profile shows first-run modal and persists after finish', async () => {
    const tmp = makeTempProfile();
    const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
    await waitForAppReady(page);

    // FirstRun wizard should be visible
    const modal = page.locator('.first-run-modal');
    await expect(modal.getByText('Welcome to HomeBot')).toBeVisible();

    // Path selection cards should be visible. The labels are deliberately
    // plain — "Local (Ollama)" named an implementation detail at a beginner on
    // the very first screen. If these ever revert to a product name, that is a
    // regression to fail on, not an assertion to quietly update.
    //
    // Scoped to the modal: unscoped, "On this PC" also matches the hardware
    // toast (see the helper above).
    await expect(modal.getByText('On this PC')).toBeVisible();
    await expect(modal.getByText('Online', { exact: true })).toBeVisible();

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
