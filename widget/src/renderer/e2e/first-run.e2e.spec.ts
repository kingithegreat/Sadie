import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
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
  test('built Windows Online setup ignores the old provider check and saves the current key and model', async ({}, testInfo) => {
    test.skip(process.platform !== 'win32', 'Compiled Windows Electron regression; no provider requests.');
    test.skip(process.env.GITHUB_ACTIONS !== 'true', 'Hosted-only: legacy dev RAG import reads the CI workspace outside fixture stores.');
    test.setTimeout(120_000);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-first-run-race-'));
    const profile = path.join(base, 'profile');
    const home = path.join(base, 'home');
    const stores = {
      HOME: home, USERPROFILE: home,
      APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
      TEMP: path.join(base, 'temp'), TMP: path.join(base, 'temp'),
      CODEX_HOME: path.join(home, '.codex'),
      ANCIENT_PATHWAYS_DIR: path.join(home, 'ap-fixture'),
      HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'movie-projects'),
    };
    for (const dir of [profile, ...Object.values(stores)]) fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(profile, 'config'));
    fs.writeFileSync(path.join(profile, 'config', 'mcp-servers.json'), JSON.stringify({ servers: [] }));
    fs.writeFileSync(path.join(stores.ANCIENT_PATHWAYS_DIR, 'run_pipeline.py'), '# disposable fixture\n');
    const entry = path.resolve('out/main/index.js');
    const renderer = path.resolve('out/renderer/index.html');
    expect(fs.existsSync(entry)).toBe(true);
    expect(fs.existsSync(renderer)).toBe(true);
    // tools/rag.ts resolves four ancestors of the compiled main directory in
    // dev mode. HOME/userData do not isolate that eager import. This hosted-only
    // test records the exact CI-workspace read exception and proves no write.
    const legacyRagPath = path.resolve(path.dirname(entry), '../../../../memory/rag-index.json');
    const ragSnapshot = () => fs.existsSync(legacyRagPath)
      ? { exists: true, sha256: createHash('sha256').update(fs.readFileSync(legacyRagPath)).digest('hex') }
      : { exists: false };
    const ragBefore = ragSnapshot();
    const { app, page } = await launchElectronApp({
      ...stores, HOMEBOT_E2E: '1', HOMEBOT_DIRECT_OLLAMA: '1', NODE_ENV: 'test',
      HOMEBOT_ENABLE_AUTO_UPDATE: '0',
    }, profile);
    const child = app.process();
    const evidence: Record<string, any> = {
      scope: 'Compiled UI and real settings persistence; fixture stores with legacy CI-workspace RAG import read exception; transport coverage starts after launch',
      ciCommit: process.env.GITHUB_SHA,
      legacyRag: { path: legacyRagPath, before: ragBefore },
    };
    const boundedCleanup = async <T,>(operation: Promise<T>, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    };
    try {
      evidence.launch = await app.evaluate(({ app }, expected) => ({
        argv: [...process.argv], appPath: app.getAppPath(), userData: app.getPath('userData'),
        stores: Object.fromEntries(Object.keys(expected).map(key => [key, process.env[key]])),
      }), stores);
      // Playwright prepends inspector flags. Verify the actual supplied entry
      // across argv, and Electron's independently resolved application path.
      expect(evidence.launch.argv.filter((arg: string) => path.isAbsolute(arg))
        .map((arg: string) => path.resolve(arg)).filter((arg: string) => arg === entry)).toEqual([entry]);
      expect(path.resolve(evidence.launch.appPath)).toBe(path.dirname(entry));
      expect(evidence.launch.userData).toBe(profile);
      expect(evidence.launch.stores).toEqual(stores);
      expect(fileURLToPath(page.url())).toBe(renderer);
      await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
      // The compiled main is CommonJS, imported by Electron's default loader.
      // Read the real loaded-module cache after hydration; process.mainModule
      // need not be assigned by that dynamic-import bootstrap.
      evidence.launch.compiledModule = await app.evaluate(({ app }) => {
        const nodePath = (process as any).getBuiltinModule('path');
        const nodeModule = (process as any).getBuiltinModule('module');
        const applicationEntry = nodePath.join(app.getAppPath(), 'index.js');
        const loaded = nodeModule.createRequire(applicationEntry).cache[applicationEntry];
        return { filename: loaded?.filename ?? null, loaded: loaded?.loaded ?? false };
      });
      expect(evidence.launch.compiledModule.filename).toBe(entry);
      expect(evidence.launch.compiledModule.loaded).toBe(true);
      expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);

      // Use the existing acceptance IPC seam. removeHandler + handle would be
      // ignored by the production duplicate-registration patch. Only discovery
      // is replaced; the actual preload, React component and save/load stay real.
      const installed = await app.evaluate(({ ipcMain, session }) => {
        const handlers = (ipcMain as any)._invokeHandlers;
        const channel = 'homebot:list-custom-llm-models';
        const original = handlers?.get(channel);
        if (typeof original !== 'function') throw new Error('Missing original model discovery handler');
        const state: any = { original, requests: [], completed: [], blocked: [], controls: [] };
        state.fixture = (_event: unknown, payload: unknown) => {
          const request: any = { payload, settled: false };
          state.requests.push(request);
          if (state.requests.length > 2) {
            request.settled = true;
            return { success: true, models: [{ id: 'fixture-current-model' }] };
          }
          return new Promise(resolve => { request.resolve = resolve; }).then(result => {
            request.settled = true;
            state.completed.push(state.requests.indexOf(request));
            return result;
          });
        };
        handlers.set(channel, state.fixture);
        if (handlers.get(channel) !== state.fixture) throw new Error('Model fixture not installed');
        // Same five main-process transport controls as the existing speech
        // helper, widened here to all postlaunch destinations. Session covers
        // renderer HTTP(S). This does not claim startup or other transports.
        const destination = (value: any) => String(value?.url || value?.hostname || value?.host || value);
        const deny = (transport: string, value: unknown) => {
          const attempt = { transport, destination: destination(value) };
          (attempt.destination.includes('first-run-control.invalid') ? state.controls : state.blocked).push(attempt);
          throw new Error('First-run fixture denies postlaunch transport');
        };
        globalThis.fetch = ((value: unknown) => deny('fetch', value)) as any;
        for (const name of ['http', 'https']) {
          const module = (process as any).getBuiltinModule(name);
          for (const method of ['get', 'request']) module[method] = (value: unknown) => deny(`${name}.${method}`, value);
        }
        for (const invoke of [
          () => globalThis.fetch('https://first-run-control.invalid'),
          ...['http', 'https'].flatMap(name => ['get', 'request'].map(method =>
            () => (process as any).getBuiltinModule(name)[method]('https://first-run-control.invalid'))),
        ]) { try { invoke(); } catch { /* All five controls must be recorded. */ } }
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
          const attempt = { transport: 'chromium-session', destination: details.url };
          (details.url.includes('first-run-control.invalid') ? state.controls : state.blocked).push(attempt);
          callback({ cancel: true });
        });
        (globalThis as any).firstRunRaceFixture = state;
        return { originalCallable: true, active: handlers.get(channel) === state.fixture, mainControls: state.controls.length };
      });
      expect(installed).toEqual({ originalCallable: true, active: true, mainControls: 5 });
      // The real renderer CSP forbids cross-origin fetch before webRequest.
      // Exercise the same session guard through Electron net instead of
      // weakening CSP or falsely treating a CSP refusal as a transport hit.
      await app.evaluate(({ net, session }) => new Promise<void>((resolve, reject) => {
        const request = net.request({ url: 'https://first-run-control.invalid', session: session.defaultSession });
        const timer = setTimeout(() => { request.abort(); reject(new Error('Session denial control timed out')); }, 5000);
        request.on('error', () => { clearTimeout(timer); resolve(); });
        request.on('response', () => { clearTimeout(timer); request.abort(); reject(new Error('Session control unexpectedly connected')); });
        request.end();
      }));
      expect(await app.evaluate(() => (globalThis as any).firstRunRaceFixture.controls.length)).toBe(6);

      const modal = page.locator('.first-run-modal');
      await modal.getByRole('button', { name: 'Online', exact: true }).click();
      const key = modal.getByPlaceholder('Paste the key from your account page');
      await key.fill('fixture-key-A');
      await modal.getByRole('button', { name: 'Test Connection', exact: true }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as any).firstRunRaceFixture.requests.length)).toBe(1);
      await modal.getByRole('button', { name: 'OpenAI', exact: true }).click();
      await key.fill('fixture-key-B');
      await key.press('Enter');
      await expect.poll(() => app.evaluate(() => (globalThis as any).firstRunRaceFixture.requests.length)).toBe(2);
      evidence.requests = await app.evaluate(() => (globalThis as any).firstRunRaceFixture.requests.map((r: any) => r.payload));
      expect(evidence.requests).toEqual([
        { provider: 'groq', apiKey: 'fixture-key-A', apiUrl: 'https://api.groq.com/openai/v1' },
        { provider: 'openai', apiKey: 'fixture-key-B', apiUrl: 'https://api.openai.com/v1' },
      ]);
      await app.evaluate(() => (globalThis as any).firstRunRaceFixture.requests[0].resolve({ success: true, models: [{ id: 'fixture-stale-model' }] }));
      await expect.poll(() => app.evaluate(() => (globalThis as any).firstRunRaceFixture.completed)).toEqual([0]);
      // Flush browser rendering after the old IPC reply, rather than checking
      // absence immediately while that reply is still pending.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(modal.getByRole('button', { name: 'Checking...', exact: true })).toBeDisabled();
      await expect(modal.getByText('Connected! Ready to chat.', { exact: true })).toHaveCount(0);
      await expect(modal.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      const pendingScreenshot = testInfo.outputPath('old-reply-current-check-pending.png');
      await modal.screenshot({ path: pendingScreenshot });
      await testInfo.attach('old-reply-current-check-pending', { path: pendingScreenshot, contentType: 'image/png' });
      await app.evaluate(() => (globalThis as any).firstRunRaceFixture.requests[1].resolve({ success: true, models: [{ id: 'fixture-current-model' }] }));
      await expect(modal.getByText('Connected! Ready to chat.', { exact: true })).toBeVisible();
      const connectedScreenshot = testInfo.outputPath('current-check-connected.png');
      await modal.screenshot({ path: connectedScreenshot });
      await testInfo.attach('current-check-connected', { path: connectedScreenshot, contentType: 'image/png' });
      await modal.getByRole('button', { name: 'Next', exact: true }).click();
      await modal.getByRole('button', { name: 'Get Started', exact: true }).click();
      await expect(modal).toHaveCount(0);
      const configPath = path.join(profile, 'config', 'user-settings.json');
      const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(persisted).toMatchObject({ firstRun: false, useCustomLLM: true, uncensoredMode: false,
        customLLM: { provider: 'openai', model: 'fixture-current-model', enabled: true } });
      const encryptionAvailable = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
      if (encryptionAvailable) {
        expect(persisted.customLLM.apiKey).toMatch(/^enc:v1:/);
        expect(persisted.customLLM.apiKey).not.toBe('fixture-key-B');
      } else expect(persisted.customLLM.apiKey).toBe('fixture-key-B');
      const loaded = await page.evaluate(() => window.electron.getSettings());
      expect(loaded.customLLM).toMatchObject({ provider: 'openai', model: 'fixture-current-model', apiKey: 'fixture-key-B' });
      evidence.persistence = { provider: persisted.customLLM.provider, model: persisted.customLLM.model, encryptionAvailable, loadedDummyKeyMatches: loaded.customLLM?.apiKey === 'fixture-key-B' };
      evidence.fixture = await app.evaluate(({ ipcMain }) => {
        const state = (globalThis as any).firstRunRaceFixture;
        return { active: (ipcMain as any)._invokeHandlers.get('homebot:list-custom-llm-models') === state.fixture,
          requests: state.requests.map((r: any) => ({ payload: r.payload, settled: r.settled })), completed: state.completed, controls: state.controls, blocked: state.blocked };
      });
      expect(evidence.fixture.active).toBe(true);
      expect(evidence.fixture.completed).toEqual([0, 1]);
      expect(evidence.fixture.blocked.filter((r: any) => /api\.openai\.com|api\.groq\.com/.test(r.destination))).toEqual([]);
      evidence.proofCompleted = true;
    } catch (error) {
      evidence.proofError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      try {
        const restoration = await boundedCleanup(app.evaluate(({ ipcMain }) => {
          const state = (globalThis as any).firstRunRaceFixture;
          if (!state) return { restored: false };
          const handlers = (ipcMain as any)._invokeHandlers;
          if (handlers.get('homebot:list-custom-llm-models') !== state.fixture) throw new Error('Model fixture changed before restoration');
          handlers.set('homebot:list-custom-llm-models', state.original);
          return { restored: handlers.get('homebot:list-custom-llm-models') === state.original,
            requests: state.requests.map((r: any) => ({ payload: r.payload, settled: r.settled })),
            completed: state.completed, controls: state.controls, blocked: state.blocked };
        }), 'Model handler restoration');
        evidence.restored = restoration.restored;
        evidence.finalFixture = restoration;
      } catch (error) {
        evidence.restorationError = error instanceof Error ? error.message : String(error);
      } finally {
        // Always initiate normal close, even if restoration fails. Process-local
        // transport denial stays active until this owned child terminates.
        try { await boundedCleanup(app.close(), 'Owned Electron normal close'); }
        catch (error) { evidence.closeError = error instanceof Error ? error.message : String(error); }
      }
      if (child.exitCode === null && child.signalCode === null) {
        try { await boundedCleanup(new Promise<void>(resolve => child.once('exit', () => resolve())), 'Owned Electron termination'); }
        catch (error) { evidence.terminationError = error instanceof Error ? error.message : String(error); }
      }
      evidence.exit = { pid: child.pid, code: child.exitCode, signal: child.signalCode };
      try {
        evidence.legacyRag.after = ragSnapshot();
        evidence.legacyRag.unchanged = JSON.stringify(evidence.legacyRag.before) === JSON.stringify(evidence.legacyRag.after);
      } catch (error) {
        evidence.legacyRag.verificationError = error instanceof Error ? error.message : String(error);
        evidence.legacyRag.unchanged = false;
      }
      evidence.status = evidence.proofCompleted && evidence.restored && !evidence.closeError && !evidence.terminationError && evidence.legacyRag.unchanged
        && child.exitCode === 0 && child.signalCode === null ? 'passed' : 'failed';
      const evidencePath = testInfo.outputPath('first-run-race-evidence.json');
      fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      // Preserve the original assertion error; teardown diagnostics stay in its
      // evidence. A successful proof still fails if normal teardown failed.
      try {
        if (!evidence.proofError) {
          expect(evidence.restored).toBe(true);
          expect(evidence.closeError).toBeUndefined();
          expect(evidence.terminationError).toBeUndefined();
          expect(evidence.legacyRag.unchanged).toBe(true);
          expect(child.exitCode).toBe(0);
          expect(child.signalCode).toBeNull();
        }
      } finally {
        try {
          await testInfo.attach('first-run-race-evidence', { path: evidencePath, contentType: 'application/json' });
        } catch (error) {
          // Do not replace an existing proof/teardown failure with a reporter
          // failure. A successful proof still fails if evidence cannot attach.
          if (evidence.proofError || evidence.status === 'failed') console.error('First-run evidence attachment failed:', error);
          else throw error;
        }
      }
    }
  });

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
      await expect(page.locator('.uncensored-toggle')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.model-lock-hint')).toHaveCount(0);

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
