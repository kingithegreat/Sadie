import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { focusStudioWindow } from './helpers/focusStudioWindow';

type Event = { event: string; at: number; pid: number; parent?: number; phase?: string; code?: number };
type Identity = { ProcessId: number; ParentProcessId: number; Name: string; CreationDate: string };
function readEvents(file: string): Event[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function identity(pid: number): Identity | null {
  if (!Number.isInteger(pid) || pid < 2) throw new Error('Invalid owned process PID');
  const value = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress`],
  { windowsHide: true, timeout: 8000, encoding: 'utf8' }).trim();
  return value ? JSON.parse(value) : null;
}

for (const phase of ['ready', 'handshake', 'discovery'] as const) {
  test(`built MCP shutdown owns the ${phase} fixture and waits for its exit`, async ({}, testInfo) => {
    test.skip(process.env.HOMEBOT_MCP_SHUTDOWN_LIVE !== '1', 'Opt-in actual SDK fixture; no default connectors/providers.');
    test.skip(process.platform !== 'win32', 'Records Windows process identity.');
    test.setTimeout(90_000);
    const entry = path.resolve('out/main/index.js');
    const built = fs.readFileSync(entry, 'utf8');
    expect(built).toContain('ownedServers.add(owned)');
    expect(built).toContain('mcpQuitPending = true');
    // The native/connector exit ordering below proves the quit barrier;
    // its Promise-chain spelling is not a compiled-entry identity contract.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-mcp-shutdown-live-'));
    const profile = path.join(home, 'profile');
    const configDir = path.join(profile, 'config');
    const ap = path.join(home, 'ap');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(ap, { recursive: true });
    fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# isolated marker only\n');
    fs.writeFileSync(path.join(configDir, 'user-settings.json'), JSON.stringify({
      firstRun: false, useCustomLLM: false, alwaysOnTop: false, theme: 'dark',
      chatModel: 'fixture-local:latest', hardwareProfile: '4gb', morningBriefing: false,
      telemetryEnabled: false, ollamaUrl: 'http://127.0.0.1:1', n8nUrl: 'http://127.0.0.1:2',
    }));
    const fixtureLog = path.join(home, 'fixture-events.jsonl');
    const appLog = path.join(home, 'app-events.jsonl');
    const fixture = path.join(home, 'single-mcp-fixture.cjs');
    // Actual SDK stdio protocol, one directly owned Node child, no HTTP/npx.
    // EOF intentionally delays exit, proving native quit actually waits.
    fs.writeFileSync(fixture, `
const fs = require('fs');
const readline = require('readline');
const log = ${JSON.stringify(fixtureLog)};
const phase = ${JSON.stringify(phase)};
const record = event => fs.appendFileSync(log, JSON.stringify({ event, at: Date.now(), pid: process.pid, parent: process.ppid, phase }) + '\\n');
record('born');
const pending = new Set();
let closing = false;
const watchdog = setTimeout(() => { record('watchdog'); process.exit(9); }, 25_000);
const respond = (message, result, delay = false) => {
  const send = () => {
    if (!closing) { record('response:' + message.method); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n'); }
  };
  if (delay) { const timer = setTimeout(send, 20_000); pending.add(timer); } else send();
};
readline.createInterface({ input: process.stdin, terminal: false }).on('line', line => {
  const message = JSON.parse(line);
  record('request:' + message.method);
  if (message.method === 'initialize') respond(message, {
    protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'owned-fixture', version: '1' }
  }, phase === 'handshake');
  if (message.method === 'tools/list') respond(message, { tools: [{ name: 'owned_read', description: 'Disposable control',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] }, phase === 'discovery');
});
process.stdin.on('end', () => {
  closing = true; record('stdin-ended'); clearTimeout(watchdog);
  for (const timer of pending) clearTimeout(timer);
  setTimeout(() => process.exit(0), 450);
});
process.on('exit', code => { record('exit:' + code); });
`);
    fs.writeFileSync(path.join(configDir, 'mcp-servers.json'), JSON.stringify({ servers: [{
      type: 'stdio', name: 'owned-fixture', command: process.execPath, args: [fixture], enabled: true,
      env: { HOME: home, USERPROFILE: home },
    }] }));
    const bootstrap = path.join(home, 'offline-bootstrap.cjs');
    fs.writeFileSync(bootstrap, `
const fs = require('fs');
const state = globalThis.mcpAcceptanceNetwork = { controls: 0, blocked: [], inventoryFixtures: 0 };
let control = true;
function deny(channel) {
  if (control) state.controls++; else state.blocked.push(channel);
  throw new Error('MCP acceptance blocks actual network transport: ' + channel);
}
globalThis.fetch = () => deny('fetch');
for (const name of ['http', 'https']) for (const method of ['get', 'request']) require(name)[method] = () => deny(name + '.' + method);
for (const invoke of [() => fetch('https://mcp-control.invalid'), () => require('http').get('http://mcp-control.invalid'),
  () => require('http').request('http://mcp-control.invalid'), () => require('https').get('https://mcp-control.invalid'),
  () => require('https').request('https://mcp-control.invalid')]) { try { invoke(); } catch {} }
control = false;
const widgetRequire = require('module').createRequire(${JSON.stringify(path.resolve('package.json'))});
widgetRequire('axios').get = async url => {
  if (String(url) === 'http://127.0.0.1:1/api/tags') {
    state.inventoryFixtures++;
    return { data: { models: [{ name: 'fixture-local:latest', size: 1_000_000_000 }] }, status: 200 };
  }
  return deny('axios.get');
};
const cp = require('child_process');
const originalSpawn = cp.spawn;
cp.spawn = function(command, ...args) {
  if (/ollama/i.test(String(command))) throw new Error('MCP acceptance refuses an Ollama launch');
  return originalSpawn.call(this, command, ...args);
};
const electron = require('electron');
const record = (event, code) => fs.appendFileSync(${JSON.stringify(appLog)}, JSON.stringify({ event, at: Date.now(), pid: process.pid, code }) + '\\n');
electron.app.on('before-quit', () => record('before-quit'));
electron.app.on('will-quit', () => record('will-quit'));
electron.app.on('quit', (_event, code) => record('quit', code));
electron.app.whenReady().then(() => electron.session.defaultSession.webRequest.onBeforeRequest(
  { urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { state.blocked.push('renderer'); callback({ cancel: true }); }
));
`);
    const shim = path.join(path.dirname(entry), `mcp-proof-entry-${process.pid}-${phase}.cjs`);
    fs.writeFileSync(shim, `require(${JSON.stringify(bootstrap)});\nrequire(${JSON.stringify(entry)});\n`, { flag: 'wx' });
    const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env,
      HOMEBOT_E2E: '1', HOMEBOT_DIRECT_OLLAMA: '1', HOMEBOT_E2E_BYPASS_MOCK: '1', NODE_ENV: 'test',
      HOMEBOT_E2E_USER_DATA_DIR: profile, HOME: home, USERPROFILE: home,
      APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
      ANCIENT_PATHWAYS_DIR: ap, HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'projects'),
    }).filter((item): item is [string, string] => typeof item[1] === 'string'));
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.JEST_WORKER_ID;
    const stages: Array<{ stage: string; at: number }> = [];
    const recordStage = (stage: string) => {
      stages.push({ stage, at: Date.now() });
      fs.writeFileSync(testInfo.outputPath('stages.json'), JSON.stringify(stages, null, 2));
      console.log('[MCP-PROOF]', phase, stage);
    };
    recordStage('launch');
    const app = await electron.launch({ executablePath: require('electron') as string, args: [shim], env });
    const owned = app.process();
    let exited = false;
    const exit = new Promise<void>(resolve => { owned.once('exit', () => { exited = true; recordStage('owned-launcher-exit'); resolve(); }); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitForExit = () => Promise.race([exit, new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned Electron did not exit within 12 seconds')), 12_000);
    })]).finally(() => { if (timer) clearTimeout(timer); });
    const page = await app.firstWindow();
    try {
      await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
      await focusStudioWindow(app, page);
      expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
      expect(await app.evaluate(() => (globalThis as any).mcpAcceptanceNetwork.controls)).toBe(5);
      expect((await page.evaluate(() => window.electron.mediaAncientPathwaysStatus!())).dir).toBe(ap);
      expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([{ type: 'stdio', name: 'owned-fixture',
        command: process.execPath, args: [fixture], enabled: true, env: { HOME: home, USERPROFILE: home } }]);
      await expect.poll(() => readEvents(fixtureLog).some(event => event.event ===
        (phase === 'handshake' ? 'request:initialize' : 'request:tools/list'))).toBe(true);
      if (phase === 'ready') {
        await expect.poll(() => page.evaluate(() => window.electron.mcpGetStatus!())).toEqual([
          { name: 'owned-fixture', type: 'stdio', toolCount: 1, connected: true },
        ]);
      } else {
        expect(await page.evaluate(() => window.electron.mcpGetStatus!())).toEqual([]);
        expect(readEvents(fixtureLog).some(event => event.event === `response:${phase === 'handshake' ? 'initialize' : 'tools/list'}`)).toBe(false);
      }
      const birth = readEvents(fixtureLog).find(event => event.event === 'born')!;
      expect(readEvents(fixtureLog).filter(event => event.event === 'born')).toHaveLength(1);
      const nativePid = await app.evaluate(() => process.pid);
      const nativeIdentity = identity(nativePid);
      const childIdentity = identity(birth.pid);
      const launcherIdentity = identity(owned.pid!);
      expect(nativeIdentity).not.toBeNull();
      expect(childIdentity?.Name).toBe('node.exe');
      expect(childIdentity?.ParentProcessId).toBe(nativePid);
      // Installed Playwright launches Electron through cmd on Windows even
      // with an explicit executablePath. Track both identities; wrapper exit
      // alone must never stand in for native/connector cleanup.
      expect(launcherIdentity?.Name).toBe('cmd.exe');
      expect(nativeIdentity?.ParentProcessId).toBe(owned.pid);
      recordStage('confirmed-' + phase);
      const network = await app.evaluate(() => (globalThis as any).mcpAcceptanceNetwork);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      recordStage('quit-request');
      await app.evaluate(({ app }) => { setImmediate(() => app.quit()); return true; });
      await waitForExit();
      expect(owned.exitCode).toBe(0);
      const events = readEvents(fixtureLog);
      const application = readEvents(appLog);
      const eof = events.find(event => event.event === 'stdin-ended')!;
      const childExit = events.find(event => event.event === 'exit:0')!;
      expect(eof).toBeDefined();
      expect(childExit).toBeDefined();
      expect(childExit.at - eof.at).toBeGreaterThanOrEqual(400);
      expect(events.some(event => event.event === 'watchdog')).toBe(false);
      expect(application.filter(event => event.event === 'before-quit').length).toBeGreaterThanOrEqual(2);
      expect(application.find(event => event.event === 'will-quit')!.at).toBeGreaterThanOrEqual(childExit.at);
      expect(application.find(event => event.event === 'quit')?.code).toBe(0);
      expect(identity(birth.pid)?.CreationDate === childIdentity!.CreationDate).toBe(false);
      expect(identity(nativePid)?.CreationDate === nativeIdentity!.CreationDate).toBe(false);
      // A positive live identity existed above; now observe after native exit
      // rather than trusting a missing child handle or a stale initial snapshot.
      await new Promise(resolve => setTimeout(resolve, 3500));
      expect(readEvents(fixtureLog)).toEqual(events);
      expect(events.filter(event => event.event === 'born')).toHaveLength(1);
      if (phase !== 'ready') {
        expect(events.some(event => event.event === `response:${phase === 'handshake' ? 'initialize' : 'tools/list'}`)).toBe(false);
      }
      fs.writeFileSync(testInfo.outputPath('mcp-shutdown-evidence.json'), JSON.stringify({
        phase, entry, entryHash: createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),
        profile, nativeIdentity, childIdentity, launcherIdentity, events, application, network,
        sdkTransport: 'actual stdio', otherConnectors: 0, nativeExitCode: application.find(event => event.event === 'quit')?.code,
        ownedLauncherExitCode: owned.exitCode,
        noRetryChildAfterExit: true, forcedKill: false, windowsShellDescendantsProved: false,
      }, null, 2));
      recordStage('assertions-complete');
    } catch (error) {
      if (!exited) await page.screenshot({ path: testInfo.outputPath('failure.png'), timeout: 3000 }).catch(() => {});
      throw error;
    } finally {
      if (!exited) {
        recordStage('finally-owned-quit');
        await app.evaluate(({ app }) => { setImmediate(() => app.quit()); return true; }).catch(() => {});
        await waitForExit();
      }
      if (fs.existsSync(fixtureLog)) fs.copyFileSync(fixtureLog, testInfo.outputPath('fixture-events.jsonl'));
      if (fs.existsSync(appLog)) fs.copyFileSync(appLog, testInfo.outputPath('app-events.jsonl'));
      fs.unlinkSync(shim); // Exact own launch shim, after the owned process exit.
      recordStage('teardown-complete');
    }
  });
}
