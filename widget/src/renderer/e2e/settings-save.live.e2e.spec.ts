import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { focusStudioWindow } from './helpers/focusStudioWindow';

test('built Simple Settings retains failed drafts, preserves policy, and retries through real IPC', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_SETTINGS_SAVE_LIVE !== '1', 'Opt-in disposable-profile Settings write-failure proof; no providers.');
  test.setTimeout(120_000);
  const entry = path.resolve('out/main/index.js');
  const built = fs.readFileSync(entry, 'utf8');
  // Fail on a stale build, or a captured/destructured writer that the precise
  // filesystem interception below could not reach.
  expect(built).toMatch(/const fs = require\(["']fs["']\)/);
  const saveStart = built.indexOf('function saveSettings(settings)');
  expect(saveStart).toBeGreaterThan(0);
  const writer = built.slice(saveStart, built.indexOf('function readIntegrationConfig', saveStart));
  expect(writer).toContain('fs.writeFileSync(pendingPath');
  expect(writer).toContain('fs.renameSync(pendingPath, settingsPath)');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-settings-live-'));
  const profile = path.join(home, 'profile');
  const config = path.join(profile, 'config', 'user-settings.json');
  const ap = path.join(home, 'ap-fixture');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.mkdirSync(ap, { recursive: true });
  fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# disposable isolation marker\n');
  // A fresh synthetic profile contains no account, credential or owner data.
  // Starting with Online allowed proves a failed off-save keeps the old policy.
  fs.writeFileSync(config, JSON.stringify({
    firstRun: false, useCustomLLM: true,
    alwaysOnTop: false, theme: 'dark', chatModel: 'fixture-local:latest',
    hardwareProfile: '4gb', morningBriefing: false, telemetryEnabled: false,
    ollamaUrl: 'http://127.0.0.1:1', n8nUrl: 'http://127.0.0.1:2',
  }));
  // Keep this Settings proof independent of optional default npx connectors.
  fs.writeFileSync(path.join(profile, 'config', 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  const bootstrap = path.join(home, 'offline-bootstrap.cjs');
  // Loaded before the actual main entry. Prevent startup from contacting or
  // launching the owner's Ollama. Only the startup inventory has a fixture;
  // actual transports are denied, with five positive controls.
  fs.writeFileSync(bootstrap, `
const state = globalThis.settingsAcceptanceNetwork = { controls: 0, blocked: [], inventoryFixtures: 0 };
let control = true;
function deny(channel) {
  if (control) state.controls++; else state.blocked.push(channel);
  throw new Error('Settings acceptance blocks actual network transport: ' + channel);
}
globalThis.fetch = () => deny('fetch');
for (const name of ['http', 'https']) {
  const transport = require(name);
  for (const method of ['get', 'request']) transport[method] = () => deny(name + '.' + method);
}
for (const invoke of [
  () => globalThis.fetch('https://settings-control.invalid'),
  () => require('http').get('http://settings-control.invalid'),
  () => require('http').request('http://settings-control.invalid'),
  () => require('https').get('https://settings-control.invalid'),
  () => require('https').request('https://settings-control.invalid'),
]) { try { invoke(); } catch {} }
control = false;
const createRequire = require('module').createRequire;
const widgetRequire = createRequire(${JSON.stringify(path.resolve('package.json'))});
const axios = widgetRequire('axios');
axios.get = async function(url) {
  if (String(url) === 'http://127.0.0.1:1/api/tags') {
    state.inventoryFixtures++;
    return { data: { models: [{ name: 'fixture-local:latest' }] }, status: 200 };
  }
  return deny('axios.get');
};
const cp = require('child_process');
const originalSpawn = cp.spawn;
cp.spawn = function(command, ...args) {
  if (/ollama/i.test(String(command))) throw new Error('Settings acceptance refuses an Ollama launch');
  return originalSpawn.call(this, command, ...args);
};
const electron = require('electron');
electron.app.whenReady().then(() => {
  electron.session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => { state.blocked.push('renderer'); callback({ cancel: true }); }
  );
});
`);
  // Keep Electron's app directory identical to launching the real entry.
  // This tiny own launch file loads the isolated guard before the unchanged
  // compiled app; it is not a replacement main/preload/IPC implementation.
  const shim = path.join(path.dirname(entry), `settings-proof-entry-${process.pid}.cjs`);
  fs.writeFileSync(shim, `require(${JSON.stringify(bootstrap)});\nrequire(${JSON.stringify(entry)});\n`, { flag: 'wx' });
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const env = {
    HOMEBOT_E2E: '1', HOMEBOT_DIRECT_OLLAMA: '1', HOMEBOT_E2E_BYPASS_MOCK: '1',
    NODE_ENV: 'test', HOMEBOT_E2E_USER_DATA_DIR: profile,
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
    ANCIENT_PATHWAYS_DIR: ap, HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'projects'),
  };
  const stage = (name: string) => {
    console.log('[SETTINGS-STAGE]', name);
    fs.appendFileSync(testInfo.outputPath('settings-stage.log'), `${new Date().toISOString()} ${name}\n`);
  };
  stage('launch');
  // Explicit entry execution is required: Electron may ignore NODE_OPTIONS.
  // The shim installs only transport guards, then requires the actual bundle.
  const launchEnv: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter((item): item is [string, string] => typeof item[1] === 'string'),
  );
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  delete launchEnv.NODE_OPTIONS;
  const app = await electron.launch({ executablePath: require('electron') as string, args: [shim], env: launchEnv });
  const page = await app.firstWindow();
  try {
    stage('ready');
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
    await focusStudioWindow(app, page);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
    expect(await app.evaluate(() => (globalThis as any).settingsAcceptanceNetwork.controls)).toBe(5);
    await expect(page.getByRole('button', { name: 'Settings', exact: true }).filter({ visible: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).filter({ visible: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Simple', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const online = dialog.getByTestId('privacy-switch');
    await expect(online).toBeChecked();
    await online.uncheck();
    await dialog.getByRole('button', { name: 'light theme' }).click();
    const previousHash = hash(config);
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).useCustomLLM).toBe(true);
    const armed = await app.evaluate(({ app }, fixture: { profile: string; config: string }) => {
      const fs = (process as any).getBuiltinModule('fs');
      const path = (process as any).getBuiltinModule('path');
      if (app.getPath('userData') !== fixture.profile || path.resolve(fixture.config) !== path.join(fixture.profile, 'config', 'user-settings.json')) {
        throw new Error('Refusing a write injection outside this disposable profile');
      }
      const state = globalThis as any;
      const original = fs.writeFileSync;
      const probe: any = { hits: 0, restored: false };
      const intercept = (file: any, data: any, options: any) => {
        if (typeof file === 'string' && file.startsWith(fixture.config + '.tmp-')
          && path.dirname(file) === path.dirname(fixture.config)) {
          probe.hits++;
          probe.filename = path.basename(file);
          // Restore the original BEFORE the injected error escapes. No other
          // write is ever intercepted, and production removes this own temp.
          fs.writeFileSync = original;
          probe.restored = true;
          original(file, '{partial', options);
          const error: any = new Error('Disposable settings write is read-only (acceptance fixture)');
          error.code = 'EACCES';
          throw error;
        }
        return original(file, data, options);
      };
      probe.restore = () => { if (fs.writeFileSync === intercept) fs.writeFileSync = original; };
      probe.isOriginal = () => fs.writeFileSync === original;
      state.settingsAcceptanceWrite = probe;
      fs.writeFileSync = intercept;
      return true;
    }, { profile, config });
    expect(armed).toBe(true);
    stage('injected-save');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Disposable settings write is read-only');
    await expect(dialog.getByRole('alert')).toContainText('previous settings are still active');
    await expect(online).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'light theme' })).toHaveClass(/active/);
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-theme', 'dark');
    expect(hash(config)).toBe(previousHash);
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).useCustomLLM).toBe(true);
    expect(fs.readdirSync(path.dirname(config)).filter(name => name.startsWith('user-settings.json.tmp-'))).toEqual([]);
    expect(await app.evaluate(() => {
      const probe = (globalThis as any).settingsAcceptanceWrite;
      return { hits: probe.hits, restored: probe.restored, original: probe.isOriginal() };
    })).toEqual({ hits: 1, restored: true, original: true });
    await dialog.screenshot({ path: testInfo.outputPath('settings-save-failed-draft.png'), animations: 'disabled' });

    stage('retry-save');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => JSON.parse(fs.readFileSync(config, 'utf8')).useCustomLLM).toBe(false);
    expect(hash(config)).not.toBe(previousHash);
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).theme).toBe('light');
    await page.getByRole('button', { name: 'Settings', exact: true }).filter({ visible: true }).click();
    stage('reopen');
    await expect(dialog).toBeVisible();
    await expect(online).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'light theme' })).toHaveClass(/active/);
    expect((await page.evaluate(() => window.electron.getSettings())).useCustomLLM).toBe(false);
    await dialog.screenshot({ path: testInfo.outputPath('settings-save-reopened.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('settings-save-evidence.json'), JSON.stringify({
      profile, entry, entryHash: hash(entry), previousHash, persistedHash: hash(config),
      oldPolicyPreservedOnFailure: true, onlineOffPersisted: true, sameDraftRetried: true,
      actualMainPreloadUi: true, writeHits: 1, writeRestoredImmediately: true,
      network: await app.evaluate(() => (globalThis as any).settingsAcceptanceNetwork),
    }, null, 2));
    stage('assertions-complete');
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath('settings-save-failure-surface.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally {
    stage('restore-writer');
    await app.evaluate(() => (globalThis as any).settingsAcceptanceWrite?.restore()).catch(() => {});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))).catch(() => {});
    stage('owned-exit-request');
    const owned = app.process();
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const exited = owned.exitCode !== null || owned.signalCode !== null ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      owned.once('exit', () => { if (exitTimer) clearTimeout(exitTimer); resolve(); });
      exitTimer = setTimeout(() => {
        // Only the process launched and returned by this test may be stopped.
        owned.kill();
        reject(new Error(`Settings proof owned Electron ${owned.pid} did not exit normally`));
      }, 15_000);
    });
    await app.evaluate(({ app }) => app.exit(0)).catch(() => { /* Expected CDP disconnect during exit. */ });
    await exited;
    stage('owned-exit-complete');
    fs.unlinkSync(shim); // Only this own launch file; real bundles are unchanged.
    // Preserve the exact disposable profile and artifacts for review.
  }
});
