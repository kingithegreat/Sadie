import { test, expect, ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test.use({ trace: 'retain-on-failure' });

/** Only OS entry points and Google's transport are simulated; the shipped UI,
 * preload, module guard, OAuth callback, token handling and storage all run. */
async function installGoogleFixture(app: ElectronApplication, file: string, port: number) {
  return app.evaluate(({ dialog, shell, safeStorage }, fixture) => {
    const state = globalThis as any;
    state.youtubeFixture = { browser: [], transport: [] };
    const http = (process as any).getBuiltinModule('http');
    const https = (process as any).getBuiltinModule('https');
    const original = https.request;
    https.request = (options: any, callback: any) => {
      if (options.hostname === 'oauth2.googleapis.com' || options.hostname === 'www.googleapis.com') {
        state.youtubeFixture.transport.push({ hostname: options.hostname, method: options.method, path: options.path });
        return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', port: fixture.port }, callback);
      }
      return original.call(https, options, callback);
    };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture.file] });
    shell.openExternal = async (raw: string) => {
      const url = new URL(raw);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Unexpected external URL');
      state.youtubeFixture.browser.push(Object.fromEntries(url.searchParams));
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      if (callback.hostname !== '127.0.0.1') throw new Error('Callback must stay on loopback');
      callback.searchParams.set('state', url.searchParams.get('state')!);
      callback.searchParams.set('code', 'synthetic-auth-code');
      await new Promise<void>((resolve, reject) => {
        const request = http.get(callback, (response: any) => {
          response.resume(); response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error('Callback rejected')));
        });
        request.on('error', reject);
      });
    };
    return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  }, { file, port });
}

test('YouTube is reachable, honors OS storage and privacy, and retains a synthetic sign-in across restart', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const prefix = path.join(os.homedir(), '.homebot-youtube-e2e-');
  const fixture = fs.mkdtempSync(prefix);
  const profile = path.join(fixture, 'profile'); fs.mkdirSync(profile);
  const file = path.join(fixture, 'desktop.json');
  fs.writeFileSync(file, JSON.stringify({ installed: {
    client_id: '123-ui-fixture.apps.googleusercontent.com', client_secret: 'synthetic-client-secret',
    token_uri: 'https://must-never-be-used.invalid/token',
  } }));
  const calls: Array<{ method?: string; path?: string; authorization?: string; form: Record<string, string> }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      calls.push({ method: req.method, path: req.url, authorization: req.headers.authorization, form });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token' && req.method === 'POST') {
        res.end(JSON.stringify({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 30,
          ...(form.grant_type === 'authorization_code' ? { refresh_token: 'synthetic-refresh-token' } : {}) }));
      } else if (req.url?.startsWith('/youtube/v3/channels?') && req.method === 'GET') {
        res.end(JSON.stringify({ items: [{ id: 'UCabcdefghijklmnopqrstuv', snippet: { title: 'HomeBot test channel' } }] }));
      } else { res.statusCode = 500; res.end('{}'); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const env = { HOMEBOT_E2E: '1', NODE_ENV: 'test' };
  let running: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
  try {
    running = await launchElectronApp(env, profile);
    await waitForAppReady(running.page); expect(await dismissFirstRun(running.page)).toBe(true);
    const secure = await installGoogleFixture(running.app, file, port);
    if (process.platform === 'win32') expect(secure).toBe(true); // Real DPAPI required on the shipping platform.
    await running.page.locator('button.mode-btn', { hasText: 'Connect' }).click();
    let card = running.page.getByRole('region', { name: 'YouTube connection' });
    await expect(card.getByRole('button', { name: 'Choose Google JSON' })).toBeEnabled();
    await card.getByRole('button', { name: 'Choose Google JSON' }).click();
    const configPath = path.join(profile, 'config', 'user-settings.json');
    if (!secure) {
      // Linux CI can lack a keyring. Verify the real refusal, never substitute a
      // fake cipher or relax the shipping application's encryption requirement.
      await expect(card.getByRole('alert')).toContainText('securely');
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))._integrationSecrets).toBeUndefined();
      expect(calls).toEqual([]);
      await running.page.screenshot({ path: testInfo.outputPath('youtube-encryption-unavailable.png') });
      testInfo.annotations.push({ type: 'OS storage', description: 'No secure OS backend; verified fail-closed import. Full sign-in/restart runs on Windows DPAPI.' });
      return;
    }
    await expect(card).toContainText('Ready to sign in');
    const staleSettings = await running.page.evaluate(() => (window as any).electron.getSettings());
    expect(staleSettings).not.toHaveProperty('_integrationSecrets');
    expect(JSON.stringify(staleSettings)).not.toContain('synthetic-client-secret');
    await running.page.evaluate(async () => {
      const bridge = (window as any).electron;
      await bridge.saveSettings({ ...(await bridge.getSettings()), useCustomLLM: false });
    });
    await card.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('Online access enabled');
    expect(await running.app.evaluate(() => (globalThis as any).youtubeFixture)).toEqual({ browser: [], transport: [] });
    expect(calls).toEqual([]); // Positive online path below proves this transport trap actually matches.
    await running.page.evaluate(async () => {
      const bridge = (window as any).electron;
      await bridge.saveSettings({ ...(await bridge.getSettings()), useCustomLLM: true });
    });
    await card.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
    await expect(card.getByRole('link', { name: 'HomeBot test channel' })).toBeVisible();
    await expect(card).toContainText('Google sign-in and channel check completed.');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/token', form: {
      code: 'synthetic-auth-code', grant_type: 'authorization_code', client_id: '123-ui-fixture.apps.googleusercontent.com',
    } });
    expect(calls[0].form.code_verifier).toHaveLength(43);
    expect(calls[1]).toMatchObject({ method: 'GET', authorization: 'Bearer synthetic-access-token' });
    const transport = await running.app.evaluate(() => (globalThis as any).youtubeFixture);
    expect(transport.browser).toHaveLength(1);
    expect(transport.browser[0]).toMatchObject({ scope: 'https://www.googleapis.com/auth/youtube.readonly', code_challenge_method: 'S256' });
    expect(transport.transport.map((call: any) => call.hostname)).toEqual(['oauth2.googleapis.com', 'www.googleapis.com']);
    let raw = fs.readFileSync(configPath, 'utf8');
    expect(JSON.parse(raw)._integrationSecrets['youtube.desktop']).toMatch(/^enc:v1:/);
    for (const secret of ['synthetic-client-secret', 'synthetic-access-token', 'synthetic-refresh-token']) expect(raw).not.toContain(secret);
    await running.page.evaluate(async saved => { await (window as any).electron.saveSettings({ ...saved, useCustomLLM: true }); }, staleSettings);
    await running.page.screenshot({ path: testInfo.outputPath('youtube-connected.png') });
    await running.app.close(); running = undefined;

    running = await launchElectronApp(env, profile);
    await waitForAppReady(running.page); expect(await installGoogleFixture(running.app, file, port)).toBe(true);
    await running.page.locator('button.mode-btn', { hasText: 'Connect' }).click();
    card = running.page.getByRole('region', { name: 'YouTube connection' });
    await expect(card.getByRole('link', { name: 'HomeBot test channel' })).toBeVisible();
    await expect(card).toContainText('Last checked:');
    expect(calls).toHaveLength(2); // Restoring status is local and never silently refreshes tokens.
    await card.getByRole('button', { name: 'Check connection' }).click();
    await expect(card).toContainText('YouTube access checked successfully.');
    expect(calls).toHaveLength(4);
    expect(calls[2]).toMatchObject({ form: { grant_type: 'refresh_token', refresh_token: 'synthetic-refresh-token' } });
    const publicStatus = await running.page.evaluate(() => (window as any).electron.youtubeConnectionStatus());
    expect(publicStatus).toMatchObject({ ok: true, status: { signedIn: true, busy: false } });
    expect(JSON.stringify(publicStatus)).not.toContain('synthetic-');
    await running.page.evaluate(() => (window as any).electron.moduleSetEnabled('homebot.production-studio', false));
    expect(await running.page.evaluate(() => (window as any).electron.youtubeRefresh())).toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
    expect(calls).toHaveLength(4);
    await running.page.evaluate(() => (window as any).electron.moduleSetEnabled('homebot.production-studio', true));
    await card.getByRole('button', { name: 'Remove from HomeBot' }).click();
    await expect(card.getByRole('button', { name: 'Choose Google JSON' })).toBeEnabled();
    await expect(card.getByRole('link', { name: 'HomeBot test channel' })).toHaveCount(0);
    raw = fs.readFileSync(configPath, 'utf8'); expect(JSON.parse(raw)._integrationSecrets).toBeUndefined();
    expect(calls).toHaveLength(4);
    await running.page.screenshot({ path: testInfo.outputPath('youtube-removed.png') });
    // A moved/corrupt OS-encrypted grant must offer a reachable way to recover.
    fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(raw), _integrationSecrets: { 'youtube.desktop': 'enc:v1:invalid-ciphertext' } }));
    await running.page.locator('button.mode-btn', { hasText: 'Chat' }).click();
    await running.page.locator('button.mode-btn', { hasText: 'Connect' }).click();
    card = running.page.getByRole('region', { name: 'YouTube connection' });
    await expect(card.getByRole('alert')).toContainText('cannot read');
    await card.getByRole('button', { name: 'Remove saved connection' }).click();
    await expect(card.getByRole('button', { name: 'Choose Google JSON' })).toBeEnabled();
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))._integrationSecrets).toBeUndefined();
    expect(calls).toHaveLength(4);
  } finally {
    if (running) await running.app.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (!path.resolve(fixture).startsWith(prefix)) throw new Error('Unexpected fixture cleanup path');
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
