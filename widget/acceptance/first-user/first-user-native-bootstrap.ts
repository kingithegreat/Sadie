// Isolated production-path native acceptance helper; not application code.
import { expect, _electron as electron, type ElectronApplication, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

type RecordEntry = { method: string; path: string; body?: unknown; phase: string };
type Phase = 'setup' | 'pull' | 'chat';
const CHAT_MODEL = 'qwen2.5:3b';

function within(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

type ProcessIdentity = { ProcessId: number; ParentProcessId: number; CreationDate: string; ExecutablePath: string };
const cimIdentity = `[pscustomobject]@{ProcessId=[int]$p.ProcessId;ParentProcessId=[int]$p.ParentProcessId;CreationDate=$p.CreationDate.ToUniversalTime().ToString('o');ExecutablePath=$p.ExecutablePath}`;
function queryProcessIdentity(pid: number, timeout = 2500): ProcessIdentity | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid owned process PID');
  if (process.platform !== 'win32') throw new Error('This native identity proof is Windows-only');
  const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){${cimIdentity} | ConvertTo-Json -Compress}`],
  { encoding: 'utf8', windowsHide: true, timeout }).trim();
  return text ? JSON.parse(text) : null;
}

function sameProcess(expected: ProcessIdentity, actual: ProcessIdentity | null) {
  return !!actual && actual.ProcessId === expected.ProcessId && actual.ParentProcessId === expected.ParentProcessId
    && actual.CreationDate === expected.CreationDate && actual.ExecutablePath?.toLowerCase() === expected.ExecutablePath.toLowerCase();
}

function describeFailure(error: any, seen = new WeakSet<object>()): unknown {
  if (!error || typeof error !== 'object') return { message: String(error) };
  if (seen.has(error)) return { message: 'Repeated error reference' };
  seen.add(error);
  return { name: error.name, message: error.message, stack: error.stack,
    code: error.code, status: error.status, signal: error.signal, killed: error.killed,
    stdout: error.stdout == null ? undefined : String(error.stdout),
    stderr: error.stderr == null ? undefined : String(error.stderr),
    cause: error.cause ? describeFailure(error.cause, seen) : undefined,
    errors: Array.isArray(error.errors) ? error.errors.map((nested: unknown) => describeFailure(nested, seen)) : undefined };
}

function stopOwnedProcess(identity: ProcessIdentity) {
  if (!identity.CreationDate || !identity.ExecutablePath) throw new Error('Refusing force: incomplete process identity');
  // Hold the exact OS process handle before rechecking the CIM birth, parent
  // and executable. Kill through that held handle, never a process-tree/name.
  const identityJson = Buffer.from(JSON.stringify(identity), 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'; $i=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${identityJson}')) | ConvertFrom-Json; `
    + `$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$i.ProcessId); if(!$p){exit 0}; `
    + `$owned=[Diagnostics.Process]::GetProcessById($i.ProcessId); try{$null=$owned.Handle; `
    + `$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$i.ProcessId); if(!$p){exit 0}; $actual=${cimIdentity}; `
    + `if($actual.ProcessId -ne $i.ProcessId -or $actual.ParentProcessId -ne $i.ParentProcessId -or $actual.CreationDate -ne $i.CreationDate -or $actual.ExecutablePath -ne $i.ExecutablePath){throw 'Owned process identity changed; force refused'}; `
    + `$owned.Kill()}finally{$owned.Dispose()}`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000 });
}

export async function openFirstUserFixture(options: {
  testInfo: TestInfo; firstRun?: boolean; inventory?: 'installed' | 'missing'; entry?: string;
  holdSecondSettingsResponse?: boolean;
}) {
  if (options.holdSecondSettingsResponse) {
    expect(options.firstRun).toBe(true);
    expect(options.inventory).toBe('installed');
  }
  const entry = options.entry || process.env.HOMEBOT_FIRST_USER_ENTRY!;
  const runtimeRoot = process.env.HOMEBOT_FIRST_USER_RUNTIME_ROOT!;
  expect(path.isAbsolute(entry)).toBe(true);
  expect(path.isAbsolute(runtimeRoot)).toBe(true);
  expect(within(runtimeRoot, entry)).toBe(true);
  expect(fs.existsSync(entry)).toBe(true);
  const fixtureParent = process.env.HOMEBOT_FIRST_USER_FIXTURE_ROOT!;
  expect(path.isAbsolute(fixtureParent)).toBe(true);
  fs.mkdirSync(fixtureParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtureParent, 'fu-'));
  const home = path.join(root, 'home'), profile = path.join(home, 'profile');
  const roaming = path.join(home, 'AppData', 'Roaming'), local = path.join(home, 'AppData', 'Local');
  const temp = path.join(home, 'tmp'), projects = path.join(home, 'projects'), ap = path.join(home, 'ap');
  for (const dir of [path.join(profile, 'config'), roaming, local, temp, projects, ap]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# owned first-user fixture\n');
  fs.writeFileSync(path.join(profile, 'config', 'mcp-servers.json'), '{"servers":[]}');
  const roots = { root, home, profile, roaming, local, temp, projects, ap, runtimeRoot,
    ragIndex: path.resolve(path.dirname(entry), '../../../../memory/rag-index.json') };
  expect(within(runtimeRoot, roots.ragIndex)).toBe(true);
  const initialRag = fs.existsSync(roots.ragIndex) ? createHash('sha256').update(fs.readFileSync(roots.ragIndex)).digest('hex') : null;
  const model = { name: CHAT_MODEL, size: 2000000000, modified_at: '2026-10-07T00:00:00Z',
    details: { family: 'qwen2', families: ['qwen2'], parameter_size: '3B' } };
  // Keep the initial 7B choice installed for the response race. Otherwise the
  // real main startup validation may switch it to 3B before either read.
  const installed = options.holdSecondSettingsResponse
    ? [model, { ...model, name: 'qwen2.5:7b', size: 4700000000,
      details: { ...model.details, parameter_size: '7B' } }]
    : [model];
  const fixture = {
    phase: 'setup' as Phase,
    inventory: options.inventory === 'missing' ? [] as typeof model[] : installed,
    requests: [] as RecordEntry[], rejected: [] as RecordEntry[],
    pendingPull: null as http.ServerResponse | null,
    completePull() {
      if (!this.pendingPull) throw new Error('No authorized fixture pull is pending');
      this.inventory = [model];
      this.pendingPull.end('{"status":"success"}\n');
      this.pendingPull = null;
    },
  };
  async function body(request: http.IncomingMessage) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new Error('Fixture request body exceeds budget');
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf8');
    return content ? JSON.parse(content) : undefined;
  }
  const ollama = http.createServer(async (request, response) => {
    let data: any;
    try { data = await body(request); } catch { response.writeHead(400).end(); return; }
    const record = { method: request.method!, path: request.url!, body: data, phase: fixture.phase };
    fixture.requests.push(record);
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/') { response.end('{}'); return; }
    if (request.method === 'GET' && request.url === '/api/tags') { response.end(JSON.stringify({ models: fixture.inventory })); return; }
    if (request.method === 'GET' && request.url === '/api/ps') { response.end('{"models":[{"name":"fixture-gpu","size_vram":4294967296}]}'); return; }
    if (request.method === 'POST' && request.url === '/api/pull' && fixture.phase === 'pull'
      && data?.name === CHAT_MODEL && data?.stream === true && Object.keys(data).length === 2 && !fixture.pendingPull) {
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.write('{"status":"downloading","total":100,"completed":10}\n');
      fixture.pendingPull = response;
      return;
    }
    if (request.method === 'POST' && request.url === '/api/chat' && fixture.phase === 'chat'
      && data?.model === CHAT_MODEL && data?.stream === true
      && data?.messages?.filter((message: any) => message.role === 'user').at(-1)?.content === 'Hello') {
      response.setHeader('Content-Type', 'application/x-ndjson');
      // A normal greeting must pass the production small-model quality gate;
      // "Hi." deliberately triggers its existing too-short retry.
      response.write(JSON.stringify({ model: CHAT_MODEL, message: { role: 'assistant', content: 'Hello there.' }, done: false }) + '\n');
      response.end(JSON.stringify({ model: CHAT_MODEL, message: { role: 'assistant', content: '' }, done: true }) + '\n');
      return;
    }
    fixture.rejected.push(record);
    response.writeHead(404).end('{"error":"Unexpected fixture request"}');
  });
  const n8n = http.createServer(async (request, response) => {
    let data: any;
    try { data = await body(request); } catch { response.writeHead(400).end(); return; }
    const record = { method: request.method!, path: request.url!, body: data, phase: fixture.phase };
    fixture.requests.push(record);
    if (request.method === 'GET' && request.url === '/') { response.writeHead(200).end('{}'); return; }
    if (request.method === 'GET' && request.url === '/healthz') { response.writeHead(404).end(); return; }
    if (request.method === 'POST' && ['/webhook/homebot/calendar', '/webhook/homebot/chat', '/webhook/homebot/media-research'].includes(request.url!)
      && data?.action === 'ping' && Object.keys(data).length === 1) { response.writeHead(404).end(); return; }
    fixture.rejected.push(record);
    response.writeHead(404).end();
  });
  async function start(server: http.Server) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  const ollamaUrl = await start(ollama), n8nUrl = await start(n8n);
  const settingsPath = path.join(profile, 'config', 'user-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ firstRun: options.firstRun !== false, uncensoredMode: options.firstRun !== false,
    chatModel: options.firstRun === false ? CHAT_MODEL : 'qwen2.5:7b', theme: 'dark', useCustomLLM: false,
    modelRoutingMode: 'off', morningBriefing: false, moaEnabled: false, telemetryEnabled: false,
    ollamaUrl, n8nUrl, projectPath: projects }));
  const guard = path.join(root, 'guard.cjs');
  fs.writeFileSync(guard, `
const state=globalThis.firstUserGuard={phase:'setup',controls:0,rendererControls:0,allowed:[],denied:[],processAttempts:[],rendererDenied:[]};
const origins={ollama:${JSON.stringify(ollamaUrl)},n8n:${JSON.stringify(n8nUrl)}};
let control=true;
function inspect(value,method,protocol){
  let url;
  try {
    if(typeof value==='string'||value instanceof URL) url=new URL(String(value));
    else if(value?.url) url=new URL(String(value.url));
    else {const host=value.hostname||value.host; url=new URL((value.protocol||protocol||'http:')+'//'+host+(value.port?':'+value.port:'')+(value.path||'/'));}
  } catch {return reject('Malformed transport destination');}
  method=String(method||value?.method||'GET').toUpperCase();
  const entry={method,url:url.href,phase:state.phase};
  if(url.username||url.password||url.search||url.hash)return reject(entry);
  const basic=method==='GET'&&((url.origin===origins.ollama&&['/','/api/tags','/api/ps'].includes(url.pathname))||(url.origin===origins.n8n&&['/','/healthz'].includes(url.pathname)));
  const ping=method==='POST'&&url.origin===origins.n8n&&['/webhook/homebot/calendar','/webhook/homebot/chat','/webhook/homebot/media-research'].includes(url.pathname);
  const pull=method==='POST'&&url.origin===origins.ollama&&url.pathname==='/api/pull'&&state.phase==='pull';
  const chat=method==='POST'&&url.origin===origins.ollama&&url.pathname==='/api/chat'&&state.phase==='chat';
  if(!basic&&!ping&&!pull&&!chat)return reject(entry);
  state.allowed.push(entry);
}
function reject(entry){if(control)state.controls++;else state.denied.push(entry);throw Error('First-user transport denied');}
const originalFetch=globalThis.fetch;globalThis.fetch=function(input,init){inspect(input,init?.method);return originalFetch.call(this,input,init);};
for(const name of ['http','https']){const transport=require(name);for(const key of ['get','request']){const original=transport[key];transport[key]=function(...args){
  const overrides=args[1]&&typeof args[1]==='object'?args[1]:{};
  if((typeof args[0]==='string'||args[0] instanceof URL)&&['host','hostname','port','protocol','path','auth'].some(key=>overrides[key]!==undefined))return reject('Transport destination override');
  inspect(args[0],args[0]?.method||overrides.method||'GET',name+':');return original.apply(this,args);
};}}
for(const invoke of [()=>globalThis.fetch('https://first-user-control.invalid'),()=>require('http').get('http://first-user-control.invalid'),()=>require('http').request('http://first-user-control.invalid'),()=>require('https').get('https://first-user-control.invalid'),()=>require('https').request('https://first-user-control.invalid'),()=>require('http').get(origins.ollama+'/api/tags?override=1'),()=>require('http').get('http://127.0.0.1:1/api/tags'),()=>require('http').request(origins.ollama+'/api/pull',{method:'POST'}),()=>inspect(origins.ollama+'/api/chat','POST'),()=>require('http').request(origins.ollama+'/',{method:'POST',hostname:'first-user-control.invalid'})]){try{invoke();}catch{}}
control=false;
const cp=require('child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=function(command,...args){state.processAttempts.push({method:key,command:String(command),args:Array.isArray(args[0])?args[0]:[]});throw Error('First-user subprocess denied');};
const electron=require('electron');electron.app.whenReady().then(()=>{electron.session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
  if(!/^https?:/i.test(details.url)){callback({cancel:false});return;}
  if(details.url==='https://first-user-renderer-control.invalid/'){state.rendererControls++;callback({cancel:true});return;}
  // UI assets are file URLs. All renderer HTTP is denied in this first-user fixture.
  state.rendererDenied.push({method:details.method,url:details.url});callback({cancel:true});
});});
if(${options.holdSecondSettingsResponse === true}){
  const race=state.settingsReadRace={registrations:0,totalReads:0,reads:[],heldRead:null,released:false,releaseCount:0};
  let releaseHeld;
  globalThis.firstUserReleaseSettingsRead=function(){
    if(!releaseHeld||race.released)throw Error('No unreleased settings response is held');
    race.released=true;race.releaseCount++;
    const release=releaseHeld;releaseHeld=undefined;release();
  };
  // Install before production applyIpcHandlePatch captures ipcMain.handle.
  // Preserve the real listener, receiver and arguments; delay only its reply.
  const originalHandle=electron.ipcMain.handle;
  electron.ipcMain.handle=function(channel,listener){
    if(channel!=='homebot:get-settings')return Reflect.apply(originalHandle,this,[channel,listener]);
    race.registrations++;
    if(race.registrations!==1)throw Error('Settings race requires one original registration');
    return Reflect.apply(originalHandle,this,[channel,async function(...args){
      const index=++race.totalReads;
      if(index>16)throw Error('Settings race read receipt exceeded its budget');
      const record={index,senderId:args[0]?.sender?.id??null,capturedModel:null,deliveredModel:null,held:index===2};
      race.reads.push(record);
      const result=await Reflect.apply(listener,this,args);
      record.capturedModel=result?.chatModel??null;
      let delivered=result;
      if(index===2){
        delivered=JSON.parse(JSON.stringify(result));
        race.heldRead=index;
        await new Promise(resolve=>{releaseHeld=resolve;});
      }
      record.deliveredModel=delivered?.chatModel??null;
      return delivered;
    }]);
  };
}
`);
  // A bootstrap entry preserves module imports and production handlers; guard
  // installs first, unlike an app.evaluate performed after startup writes.
  const runtimeWidget = path.resolve(path.dirname(entry), '../..');
  expect(within(runtimeRoot, runtimeWidget)).toBe(true);
  expect(fs.existsSync(path.join(runtimeWidget, 'package.json'))).toBe(true);
  // Preserve actual package identity/app.getAppPath while installing isolated
  // store paths and transport guards before any production imports.
  const shim = path.join(runtimeWidget, `first-user-bootstrap-${path.basename(root)}.cjs`);
  fs.writeFileSync(shim, `require(${JSON.stringify(guard)});\nconst {app}=require('electron');\napp.setPath('appData',${JSON.stringify(roaming)});\napp.setPath('userData',${JSON.stringify(profile)});\napp.setPath('sessionData',${JSON.stringify(profile)});\nif(require('os').homedir()!==${JSON.stringify(home)})throw Error('Fixture HOME is not isolated');\nrequire(${JSON.stringify(entry)});\n`, { flag: 'wx' });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || key.startsWith('HOMEBOT_') || key === 'NODE_OPTIONS' || key === 'ELECTRON_RUN_AS_NODE' || key === 'JEST_WORKER_ID'
      || /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key) || key.startsWith('N8N_')) continue;
    env[key] = value;
  }
  Object.assign(env, { NODE_ENV: 'production', HOME: home, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local,
    TEMP: temp, TMP: temp, HOMEBOT_E2E_USER_DATA_DIR: profile, HOMEBOT_ENABLE_AUTO_UPDATE: '0',
    ANCIENT_PATHWAYS_DIR: ap, HOMEBOT_MOVIE_PROJECTS_DIR: projects, OLLAMA_URL: ollamaUrl, N8N_URL: n8nUrl,
    COMFY_ENDPOINT: 'http://127.0.0.1:4' });
  let app: ElectronApplication | undefined;
  let nativeIdentity: ProcessIdentity | null = null;
  let launcherIdentity: ProcessIdentity | null = null;
  let startupStage = 'launch';
  let startupNativeProcess: { pid: number; ppid: number; executable: string } | null = null;
  async function close() {
    let receipt: any;
    let safeToCloseServers = !app;
    try {
      if (app) {
        // Same 20s close budget as the repository helper, with the outcome and
        // exact owned child identity retained rather than inferred from time.
        const started = Date.now(), child = app.process();
        const identity = { pid: child.pid, executable: child.spawnfile, args: [...child.spawnargs], nativeIdentity, launcherIdentity };
        let timer: NodeJS.Timeout | undefined;
        const overran = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 20_000); });
        const forcedTargets: ProcessIdentity[] = [];
        let forced = false;
        let closeOutcome: 'closed' | 'rejected' | 'timeout' | null = null;
        let closeError: string | null = null;
        let refusal: string | null = null;
        let nativeAfter: ProcessIdentity | null = null;
        let launcherAfter: ProcessIdentity | null = null;
        let nativeProbeSucceeded = false;
        let launcherProbeSucceeded = false;
        let exitEvent: { code: number | null; signal: string | null; elapsedMs: number } | null = null;
        const onExit = (code: number | null, signal: string | null) => { exitEvent = { code, signal, elapsedMs: Date.now() - started }; };
        child.once('exit', onExit);
        async function waitForOwnedAbsence(budgetMs: number) {
          const deadline = Date.now() + budgetMs;
          do {
            const nativeBudget = deadline - Date.now();
            if (nativeBudget <= 0) return false;
            nativeProbeSucceeded = false;
            nativeAfter = queryProcessIdentity(nativeIdentity!.ProcessId, Math.min(2500, nativeBudget));
            nativeProbeSucceeded = true;
            launcherProbeSucceeded = false;
            if (launcherIdentity!.ProcessId === nativeIdentity!.ProcessId) launcherAfter = nativeAfter;
            else {
              const launcherBudget = deadline - Date.now();
              if (launcherBudget <= 0) return false;
              launcherAfter = queryProcessIdentity(launcherIdentity!.ProcessId, Math.min(2500, launcherBudget));
            }
            launcherProbeSucceeded = true;
            if (!sameProcess(nativeIdentity!, nativeAfter) && !sameProcess(launcherIdentity!, launcherAfter)) return true;
            await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
          } while (Date.now() < deadline);
          return false;
        }
        try {
          closeOutcome = await Promise.race([app.close().then(() => 'closed' as const, error => { closeError = String(error?.message || error); return 'rejected' as const; }), overran]);
          if (!nativeIdentity || !launcherIdentity) throw new Error('Unknown native/launcher identity; force refused and healthy fixtures retained');
          // Browser/transport closure is not OS exit. Give known identities a
          // separate 5s disappearance budget, even when app.close resolved.
          safeToCloseServers = await waitForOwnedAbsence(5000);
          if (!safeToCloseServers) {
            if (!nativeProbeSucceeded || !launcherProbeSucceeded) throw new Error('Native/launcher state is unknown; force refused');
            for (const target of [nativeIdentity, ...(launcherIdentity.ProcessId === nativeIdentity.ProcessId ? [] : [launcherIdentity])]) {
              const actual = target.ProcessId === nativeIdentity.ProcessId ? nativeAfter : launcherAfter;
              if (sameProcess(target, actual)) {
                stopOwnedProcess(target); // Holds/revalidates the identity again.
                forcedTargets.push(target);
                forced = true;
              }
            }
            safeToCloseServers = await waitForOwnedAbsence(5000);
          }
          if (!safeToCloseServers) throw new Error('Owned native/launcher identity is still alive after bounded shutdown');
        } catch (error: any) {
          refusal = String(error?.message || error);
        } finally {
          clearTimeout(timer);
          child.removeListener('exit', onExit);
          receipt = { ...identity, elapsedMs: Date.now() - started, closeOutcome, forced, forcedTargets, closeError, refusal, nativeAfter, launcherAfter,
            nativeProbeSucceeded, launcherProbeSucceeded,
            nativeSameIdentityAlive: nativeIdentity && nativeProbeSucceeded ? sameProcess(nativeIdentity, nativeAfter) : null,
            launcherSameIdentityAlive: launcherIdentity && launcherProbeSucceeded ? sameProcess(launcherIdentity, launcherAfter) : null,
            exitEvent, exitCode: child.exitCode, signalCode: child.signalCode,
            // CIM absence proves disappearance of an exact identity. The
            // launcher's code cannot establish the native main's OS exit code.
            nativeExitCode: null, naturalShutdownVerified: false, safeToCloseServers };
          fs.writeFileSync(options.testInfo.outputPath('first-user-shutdown.json'), JSON.stringify(receipt, null, 2));
        }
      }
    } finally {
      if (safeToCloseServers) {
        for (const server of [ollama, n8n]) {
          const closed = new Promise<void>(resolve => server.close(() => resolve()));
          server.closeAllConnections();
          await closed;
        }
      }
    }
    if (!safeToCloseServers) throw new Error(`First-user cleanup refused: ${receipt?.refusal || 'Native identity not proven absent'}`);
    return receipt;
  }
  try {
    app = await electron.launch({ executablePath: require('electron') as string, args: [shim], env });
    // Capture ownership before hydration/locator assertions can fail.
    startupStage = 'read native main metadata';
    startupNativeProcess = await app.evaluate(() => ({ pid: process.pid, ppid: process.ppid, executable: process.execPath }));
    // Cold Windows CIM/PowerShell startup has a separate bounded 15s budget.
    // Keep the post-close 5s disappearance budget and strict refusal unchanged.
    const initialCaptureDeadline = Date.now() + 15_000;
    const captureIdentity = (pid: number) => {
      const remaining = initialCaptureDeadline - Date.now();
      if (remaining <= 0) throw new Error('Initial native/launcher CIM capture exceeded its 15s budget');
      return queryProcessIdentity(pid, remaining);
    };
    startupStage = 'capture launcher CIM identity';
    launcherIdentity = captureIdentity(app.process().pid!);
    startupStage = 'capture native main CIM identity';
    nativeIdentity = captureIdentity(startupNativeProcess.pid);
    startupStage = 'verify native and launcher identities';
    expect(nativeIdentity?.ProcessId).toBe(startupNativeProcess.pid);
    expect(nativeIdentity?.ParentProcessId).toBe(startupNativeProcess.ppid);
    expect(nativeIdentity?.CreationDate).toBeTruthy();
    expect(nativeIdentity?.ExecutablePath).toBeTruthy();
    expect(launcherIdentity?.CreationDate).toBeTruthy();
    expect(launcherIdentity?.ExecutablePath).toBeTruthy();
    expect(fs.realpathSync(nativeIdentity!.ExecutablePath).toLowerCase()).toBe(fs.realpathSync(startupNativeProcess.executable).toLowerCase());
    expect(fs.realpathSync(nativeIdentity!.ExecutablePath).toLowerCase()).toBe(fs.realpathSync(require('electron') as string).toLowerCase());
    startupStage = 'hydrate production renderer';
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="homebot-app-root"][data-hydrated="true"]');
    // The shipped renderer's connect-src self CSP would intercept this control
    // before the session guard. Exercise that same session from a separate
    // owned hidden sandboxed window, without changing production CSP.
    startupStage = 'renderer transport positive control';
    const rendererBlocked = await app.evaluate(async ({ BrowserWindow, session }) => {
      const control = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, session: session.defaultSession,
      } });
      try {
        await control.loadURL('data:text/html;charset=utf-8,First-user%20transport%20control');
        return await control.webContents.executeJavaScript("fetch('https://first-user-renderer-control.invalid/').then(()=>false,()=>true)");
      } finally { control.destroy(); }
    });
    expect(rendererBlocked).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).firstUserGuard.rendererControls)).toBe(1);
    startupStage = 'verify effective isolated paths and production mode';
    const passive = await app.evaluate(({ app }) => ({ appPath: app.getAppPath(), userData: app.getPath('userData'), appData: app.getPath('appData'), sessionData: app.getPath('sessionData'),
      nodeHome: (process as any).getBuiltinModule('os').homedir(), nativePid: process.pid, e2e: !!process.env.HOMEBOT_E2E,
      guardControls: (globalThis as any).firstUserGuard.controls }));
    expect(passive.userData).toBe(profile);
    expect(path.resolve(passive.appPath)).toBe(runtimeWidget);
    expect(passive.appData).toBe(roaming);
    expect(passive.sessionData).toBe(profile);
    expect(passive.nodeHome).toBe(home);
    expect(passive.e2e).toBe(false);
    expect(passive.guardControls).toBe(10);
    expect(nativeIdentity!.ProcessId).toBe(passive.nativePid);
    async function setPhase(phase: Phase) {
      fixture.phase = phase;
      await app!.evaluate((_electron, value) => { (globalThis as any).firstUserGuard.phase = value; }, phase);
    }
    async function evidence() {
      const state = await app!.evaluate(() => (globalThis as any).firstUserGuard);
      const currentRag = fs.existsSync(roots.ragIndex) ? createHash('sha256').update(fs.readFileSync(roots.ragIndex)).digest('hex') : null;
      return { roots, passive, nativeIdentity, launcherIdentity, mainSha256: createHash('sha256').update(fs.readFileSync(entry)).digest('hex'), initialRag, currentRag,
        transport: state, requests: fixture.requests, rejected: fixture.rejected };
    }
    async function settingsReadRace() {
      return app!.evaluate(() => (globalThis as any).firstUserGuard.settingsReadRace ?? null);
    }
    async function releaseSettingsRead() {
      await app!.evaluate(() => {
        const release = (globalThis as any).firstUserReleaseSettingsRead;
        if (typeof release !== 'function') throw new Error('Settings response race is not enabled');
        release();
      });
    }
    return { app, page, fixture, roots, settingsPath, ollamaUrl, setPhase, evidence, close, settingsReadRace, releaseSettingsRead };
  } catch (error) {
    const failures: unknown[] = [error];
    if (app && options.holdSecondSettingsResponse) {
      try {
        await app.evaluate(() => {
          const race = (globalThis as any).firstUserGuard?.settingsReadRace;
          if (race?.heldRead === 2 && !race.released) (globalThis as any).firstUserReleaseSettingsRead();
        });
      } catch (releaseError) { failures.push(releaseError); }
    }
    try { await close(); } catch (cleanupError) { failures.push(cleanupError); }
    try {
      // Playwright's JSON reporter does not serialize AggregateError.errors.
      // Persist full nested primary/cleanup causes independently before throw.
      fs.writeFileSync(options.testInfo.outputPath('first-user-startup-error.json'), JSON.stringify({
        stage: startupStage, initialCIMCaptureBudgetMs: 15_000, startupNativeProcess,
        nativeIdentity, launcherIdentity, failures: failures.map(failure => describeFailure(failure)),
      }, null, 2));
    } catch (diagnosticError) { failures.push(diagnosticError); }
    if (failures.length > 1) throw new AggregateError(failures, `First-user startup failed at ${startupStage}; bounded cleanup/diagnostics also failed`);
    throw error;
  }
}
