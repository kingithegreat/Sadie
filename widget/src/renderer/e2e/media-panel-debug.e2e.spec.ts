/** Real Studio failure handling and passive native-quit diagnostics. No model/provider is used. */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import type { ChildProcess } from 'child_process';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

const diagnostics = new Map<string, { evidence: any; receipt: string; milestones: string }>();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const snapshot = (file: string) => fs.existsSync(file)
  ? { exists: true, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
  : { exists: false };

// File-only recovery retains later passive events if unchanged app.close()
// consumes the test budget. No Electron operation, timeout extension or kill.
test.afterEach(async ({}, testInfo) => {
  const record = diagnostics.get(`${testInfo.testId}:${testInfo.retry}`);
  if (!record) return;
  record.evidence.testStatus = testInfo.status;
  try { fs.writeFileSync(record.receipt, JSON.stringify(record.evidence, null, 2)); }
  catch (error) {
    if (testInfo.status === 'passed') throw error;
    console.error('Secondary Studio receipt error:', errorText(error));
  }
  for (const [name, file, contentType] of [
    ['studio-latest-diagnostics', record.receipt, 'application/json'],
    ['studio-native-milestones', record.milestones, 'application/x-ndjson'],
  ]) {
    if (!fs.existsSync(file)) continue;
    try { await testInfo.attach(name, { path: file, contentType }); }
    catch (error) {
      if (testInfo.status === 'passed') throw error;
      console.error('Secondary Studio attachment error:', errorText(error));
    }
  }
  diagnostics.delete(`${testInfo.testId}:${testInfo.retry}`);
});

test('the Studio panel does what its buttons say', async ({}, testInfo) => {
  test.skip(process.env.GITHUB_ACTIONS !== 'true', 'Hosted-only: eager dev RAG import reads the CI workspace outside fixture stores.');
  test.setTimeout(180_000);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-media-debug-'));
  const home = path.join(base, 'home');
  const profile = path.join(home, 'profile');
  const stores = {
    HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
    TEMP: path.join(home, 'temp'), TMP: path.join(home, 'temp'), CODEX_HOME: path.join(home, '.codex'),
    ANCIENT_PATHWAYS_DIR: path.join(home, 'ap-fixture'), HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'projects'),
  };
  for (const dir of [profile, ...Object.values(stores)]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(profile, 'config'));
  fs.writeFileSync(path.join(profile, 'config', 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  fs.writeFileSync(path.join(stores.ANCIENT_PATHWAYS_DIR, 'run_pipeline.py'), '# disposable fixture; never executed\n');
  const model = 'fixture-studio-model';
  const title = 'Debug: One-Minute Bible';
  const requests: any[] = [];
  let releaseGeneration: (() => void) | undefined;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let payload: unknown;
      try { payload = body ? JSON.parse(body) : null; }
      catch { response.writeHead(400); response.end('Invalid fixture JSON'); return; }
      requests.push({ method: request.method, path: request.url, body: payload });
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST' && request.url === '/api/generate') {
        releaseGeneration = () => { response.writeHead(503); response.end(JSON.stringify({ error: 'Fixture model unavailable' })); };
        return;
      }
      if (request.method === 'GET' && request.url === '/api/tags') {
        // Healthy transport prevents real startup code from starting Ollama.
        response.end(JSON.stringify({ models: [{ name: model }] }));
      } else if (request.method === 'GET' && request.url === '/api/ps') {
        response.end(JSON.stringify({ models: [] }));
      } else { response.writeHead(404); response.end('{}'); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fs.writeFileSync(path.join(profile, 'config', 'user-settings.json'), JSON.stringify({
    firstRun: false, telemetryEnabled: false, theme: 'dark', morningBriefing: false,
    ollamaUrl: origin, n8nUrl: origin, ollamaModel: model, chatModel: model,
    useCustomLLM: false, customLLM: { enabled: false }, mediaPublishingEnabled: false,
  }));
  const entry = path.resolve('out/main/index.js');
  const renderer = path.resolve('out/renderer/index.html');
  // tools/rag.ts dev mode eagerly reads four ancestors of compiled main.
  const legacyRagPath = path.resolve(path.dirname(entry), '../../../../memory/rag-index.json');
  const receipt = testInfo.outputPath('studio-diagnostics.json');
  const milestones = testInfo.outputPath('studio-native-milestones.jsonl');
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  const evidence: any = {
    status: 'running', ciCommit: process.env.GITHUB_SHA, retry: testInfo.retry,
    configuredVideo: testInfo.project.use.video, requests, consoleErrors: [], pageErrors: [],
    scope: 'Real compiled Studio/preload/media persistence; owned HTTP refusal fixture; postlaunch transport controls only; CI-workspace RAG import read exception.',
    legacyRag: { path: legacyRagPath, before: snapshot(legacyRagPath) }, origin,
  };
  diagnostics.set(`${testInfo.testId}:${testInfo.retry}`, { evidence, receipt, milestones });
  const save = () => fs.writeFileSync(receipt, JSON.stringify(evidence, null, 2));
  const attach = async (name: string, file: string, contentType: string) => {
    try { await testInfo.attach(name, { path: file, contentType }); }
    catch (error) {
      if (!evidence.proofError && !evidence.cleanupError) throw error;
      console.error('Secondary Studio attachment error:', errorText(error));
    }
  };
  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
  let ownedChild: ChildProcess | undefined;
  let primaryError: unknown;
  try {
    expect(fs.existsSync(entry)).toBe(true);
    expect(fs.existsSync(renderer)).toBe(true);
    launched = await launchElectronApp({
      ...stores, HOMEBOT_E2E: '1', HOMEBOT_DIRECT_OLLAMA: '1', NODE_ENV: 'test',
      OLLAMA_URL: origin, COMFY_ENDPOINT: origin, HOMEBOT_ENABLE_AUTO_UPDATE: '0',
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*',
    }, profile);
    const { app, page } = launched;
    const child = app.process();
    ownedChild = child;
    evidence.native = { pid: child.pid, exitCode: child.exitCode, signal: child.signalCode };
    child.once('exit', (code, signal) => {
      evidence.native = { pid: child.pid, exitCode: code, signal };
      try { save(); } catch (error) { evidence.nativeReceiptError = errorText(error); }
    });
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
      evidence[name] = '';
      stream?.on('data', chunk => { evidence[name] = (evidence[name] + String(chunk)).slice(-32_768); });
    }
    app.on('console', message => { evidence.mainConsole = [...(evidence.mainConsole || []), message.text()].slice(-80); });
    page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    evidence.launch = await app.evaluate(({ app }, expected) => {
      const nodeFs = (process as any).getBuiltinModule('fs');
      const stamp = (event: string, detail: any = {}) => {
        const row = { event, at: Date.now(), pid: process.pid, ...detail,
          transport: (globalThis as any).studioDiagnosticTransport || null };
        try { nodeFs.appendFileSync(expected.milestones, `${JSON.stringify(row)}\n`); }
        catch (error) { console.error('[STUDIO-QUIT] Observer write failed:', String(error)); }
        console.log('[STUDIO-QUIT]', JSON.stringify(row));
      };
      app.on('before-quit', event => stamp('before-quit', { defaultPrevented: event.defaultPrevented }));
      app.on('will-quit', event => stamp('will-quit', { defaultPrevented: event.defaultPrevented }));
      app.on('quit', (_event, code) => stamp('quit', { code }));
      process.on('exit', code => stamp('process-exit', { code }));
      stamp('observer-installed');
      return {
        argv: [...process.argv], appPath: app.getAppPath(), userData: app.getPath('userData'),
        nodeHome: (process as any).getBuiltinModule('os').homedir(),
        stores: Object.fromEntries(Object.keys(expected.stores).map(key => [key, process.env[key]])),
        ollamaUrl: process.env.OLLAMA_URL, comfyEndpoint: process.env.COMFY_ENDPOINT,
      };
    }, { milestones, stores });
    expect(evidence.launch.argv.filter((arg: string) => path.isAbsolute(arg)).map((arg: string) => path.resolve(arg)).filter((arg: string) => arg === entry)).toEqual([entry]);
    expect(path.resolve(evidence.launch.appPath)).toBe(path.dirname(entry));
    expect(evidence.launch.userData).toBe(profile);
    expect(evidence.launch.nodeHome).toBe(home);
    expect(evidence.launch.stores).toEqual(stores);
    expect(evidence.launch.ollamaUrl).toBe(origin);
    expect(evidence.launch.comfyEndpoint).toBe(origin);
    expect(fileURLToPath(page.url())).toBe(renderer);
    await waitForAppReady(page);
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
    evidence.launch.compiledModule = await app.evaluate(({ app }) => {
      const nodePath = (process as any).getBuiltinModule('path');
      const applicationEntry = nodePath.join(app.getAppPath(), 'index.js');
      const loaded = (process as any).getBuiltinModule('module').createRequire(applicationEntry).cache[applicationEntry];
      return { filename: loaded?.filename ?? null, loaded: loaded?.loaded ?? false };
    });
    expect(evidence.launch.compiledModule).toEqual({ filename: entry, loaded: true });
    expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
    const ap = await page.evaluate(() => window.electron.mediaAncientPathwaysStatus!());
    expect(ap).toMatchObject({ ok: true, available: true, dir: stores.ANCIENT_PATHWAYS_DIR });

    // Allow only this server's named endpoints; retain original transport calls.
    // No product IPC, generation, persistence or quit handler is replaced.
    evidence.transportControls = await app.evaluate(({ session }, allowedOrigin) => {
      const state: any = { blocked: [], controls: [] };
      const target = (value: any, rawOptions: any = {}) => {
        const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
        const urlValue = typeof value === 'string' || value instanceof URL || value?.url;
        const url = urlValue ? new URL(String(value?.url || value))
          : new URL(`${value.protocol || 'http:'}//${value.hostname || value.host}${value.port ? `:${value.port}` : ''}${value.path || '/'}`);
        // Node URL-plus-options overloads may override the actual destination.
        if (options.protocol) url.protocol = options.protocol;
        if (options.hostname) url.hostname = options.hostname;
        else if (options.host) url.host = options.host;
        if (options.port !== undefined) url.port = String(options.port);
        if (options.path) {
          const overridden = new URL(options.path, url.origin);
          url.pathname = overridden.pathname; url.search = overridden.search;
        }
        return { url, method: String(options.method || value?.method || 'GET').toUpperCase() };
      };
      const check = (channel: string, value: any, options?: any) => {
        const { url, method } = target(value, options);
        const allowed = url.origin === allowedOrigin && !url.search && !url.username && !url.password && (
          (method === 'GET' && ['/', '/api/tags', '/api/ps', '/system_stats', '/healthz'].includes(url.pathname)) ||
          (method === 'POST' && ['/api/generate', '/webhook/homebot/media-research'].includes(url.pathname))
        );
        if (allowed) return;
        const row = { channel, target: url.href, method };
        (url.hostname === 'studio-control.invalid' ? state.controls : state.blocked).push(row);
        throw new Error('Studio fixture denies unknown postlaunch transport');
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((value: any, options: any) => { check('fetch', value, options); return originalFetch(value, options); }) as any;
      for (const name of ['http', 'https']) {
        const module = (process as any).getBuiltinModule(name);
        for (const method of ['get', 'request']) {
          const original = module[method];
          module[method] = (...args: any[]) => { check(`${name}.${method}`, args[0], args[1]); return original.apply(module, args); };
        }
      }
      for (const invoke of [
        () => globalThis.fetch('https://studio-control.invalid'),
        ...['http', 'https'].flatMap(name => ['get', 'request'].map(method => () => (process as any).getBuiltinModule(name)[method](
          allowedOrigin, { hostname: 'studio-control.invalid' }))),
      ]) { try { invoke(); } catch { /* Five actual denial controls are counted below. */ } }
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        try { check('chromium-session', details.url, { method: details.method }); callback({}); }
        catch { callback({ cancel: true }); }
      });
      (globalThis as any).studioDiagnosticTransport = state;
      return state.controls.length;
    }, origin);
    expect(evidence.transportControls).toBe(5);
    await app.evaluate(({ net, session }) => new Promise<void>((resolve, reject) => {
      const request = net.request({ url: 'https://studio-control.invalid', session: session.defaultSession });
      const timer = setTimeout(() => {
        reject(new Error('Studio session denial control timed out')); request.abort();
      }, 5000);
      request.on('error', () => { clearTimeout(timer); resolve(); });
      request.on('response', () => { clearTimeout(timer); request.abort(); reject(new Error('Studio session control unexpectedly connected')); });
      request.end();
    }));
    expect(await app.evaluate(() => (globalThis as any).studioDiagnosticTransport.controls.length)).toBe(6);

    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    evidence.preload = await page.evaluate(() => ['mediaList', 'mediaCreate', 'mediaAdvance', 'mediaRun', 'mediaApprove', 'mediaReject']
      .map(key => [key, typeof (window.electron as any)[key]]));
    expect(evidence.preload.every(([, type]: string[]) => type === 'function')).toBe(true);
    await page.locator('.ms-input').fill(title);
    await page.locator('.ms-btn--primary', { hasText: 'Add video' }).click();
    const row = page.locator('.ms-job').filter({ has: page.locator('.ms-job-title', { hasText: title }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ms-job-title')).toHaveText(title);
    const jobId = await row.getAttribute('data-job-id');
    expect(jobId).toBeTruthy();
    const capture = async (name: string) => {
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file });
      await attach(name, file, 'image/png');
    };
    await expect(row.getByRole('button', { name: 'Write script', exact: true })).toBeEnabled();
    await row.scrollIntoViewIfNeeded();
    await capture('studio-created');
    await row.getByRole('button', { name: 'Write script', exact: true }).click();
    await expect(row.locator('.ms-working')).toBeVisible();
    await expect.poll(() => requests.filter(request => request.method === 'POST' && request.path === '/api/generate').length).toBe(1);
    const generation = requests.find(request => request.path === '/api/generate');
    expect(generation.body).toMatchObject({ model, stream: false });
    expect(generation.body.prompt).toContain(title);
    expect(requests.some(request => request.method === 'POST' && request.path === '/webhook/homebot/media-research')).toBe(true);
    const exportStatus = row.locator('.ms-export-status strong');
    evidence.scriptExportStatus = await exportStatus.innerText();
    await expect(exportStatus).toHaveText('No movie selected');
    await row.scrollIntoViewIfNeeded();
    await capture('studio-working');
    releaseGeneration!(); releaseGeneration = undefined;
    await expect(page.locator('.ms-error')).toContainText('503');
    await expect(row.locator('.ms-working')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Write script', exact: true })).toBeEnabled();
    evidence.outcome = { error: await page.locator('.ms-error').innerText(), jobId };
    const jobs = JSON.parse(fs.readFileSync(path.join(profile, 'media-jobs.json'), 'utf8'));
    const savedJob = jobs.find((job: any) => job.id === jobId);
    expect(savedJob).toMatchObject({ id: jobId, title, state: 'idea' });
    expect(savedJob.script || '').toBe('');
    evidence.persistedJob = { id: savedJob.id, title: savedJob.title, state: savedJob.state, script: savedJob.script || '' };
    await page.locator('.ms-error').scrollIntoViewIfNeeded();
    await capture('studio-failed-generation');
    expect(evidence.pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
    evidence.functionalStagesPassed = true;
  } catch (error) {
    primaryError = error; evidence.proofError = errorText(error); throw error;
  } finally {
    let cleanupError: unknown;
    try { releaseGeneration?.(); }
    catch (error) { cleanupError = error; evidence.cleanupError = errorText(error); }
    if (launched) {
      evidence.closeStartedAt = Date.now();
      try { save(); await attach('studio-before-close', receipt, 'application/json'); }
      catch (error) { cleanupError = error; evidence.cleanupError = errorText(error); }
      // Playwright awaits video recording before app.quit. No observer changes
      // that implementation; absent before-quit is not a recorder diagnosis.
      try {
        await launched.app.close();
        evidence.closeResolvedAt = Date.now();
        // Playwright disposes its application handle when close resolves.
        // Inspect the exact native child captured while the handle was live.
        const child = ownedChild;
        if (!child) throw new Error('Owned native child was not captured before close');
        if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => child.once('exit', () => resolve()));
        evidence.native = { pid: child.pid, exitCode: child.exitCode, signal: child.signalCode };
        evidence.legacyRag.after = snapshot(legacyRagPath);
        expect(evidence.legacyRag.after).toEqual(evidence.legacyRag.before);
        expect(evidence.native).toMatchObject({ exitCode: 0, signal: null });
        evidence.milestones = fs.readFileSync(milestones, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        for (const event of ['before-quit', 'will-quit', 'quit', 'process-exit']) {
          expect(evidence.milestones.some((row: any) => row.event === event && row.pid === child.pid)).toBe(true);
        }
        evidence.transport = evidence.milestones.filter((row: any) => row.event === 'process-exit').slice(-1)[0]?.transport;
        expect(evidence.transport?.controls).toHaveLength(6);
        expect(evidence.transport?.blocked).toEqual([]);
      } catch (error) { cleanupError ||= error; evidence.cleanupError ||= errorText(error); }
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    evidence.status = primaryError || cleanupError ? 'failed' : 'passed';
    try { save(); await attach('studio-final-diagnostics', receipt, 'application/json'); }
    catch (error) {
      if (!primaryError && !cleanupError) throw error;
      console.error('Secondary Studio final evidence error:', errorText(error));
    }
    if (!primaryError && cleanupError) throw cleanupError;
  }
});
