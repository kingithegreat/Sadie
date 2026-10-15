import { execFile, spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { stopWorkspacePtyTree, type WorkspacePtyStopReceipt } from '../../../main/workspace-pty-force-stop';

export interface NativeAppInfo { pid: number; ppid: number; execPath: string }
export interface NativeAppExit { code: number | null; signal?: string | null; creation?: string }
export interface NativeAppObservation { at: number; gone: boolean; live: Array<{ pid: number; parent: number; creation: string; name: string }> }
export const NATIVE_STARTUP_BUDGET_MS = 15_000;
export interface NativeStartupDiagnostic { budgetMs: number; durationMs: number; artifact: string; status: 'ready' | 'failed'; watcherPid?: number; stdoutTail: string; stderrTail: string; failure?: string; watcherCleanupRequested?: boolean }
export interface NativeAppMonitor {
  info: NativeAppInfo;
  creation?: string;
  exit: Promise<NativeAppExit>;
  observations?: NativeAppObservation[];
  startup?: NativeStartupDiagnostic;
  snapshot(): Promise<WorkspacePtyStopReceipt | undefined>;
  verify(receipt?: WorkspacePtyStopReceipt): Promise<boolean>;
  cleanup(receipt?: WorkspacePtyStopReceipt): Promise<unknown>;
  dispose(): void;
}

function encoded(source: string): string[] {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')];
}
function powershell(source: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => execFile('powershell.exe', encoded(source), { env, windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(error) : resolve(String(stdout))));
}
const quote = (value: string) => value.replace(/'/g, "''");

/** Only fixed purpose labels leave the OS observer; command arguments stay local. */
export function nativePurposeClassifierSource(): string {
  return `function Get-CapturedPurpose([string]$command){
    $text=$command
    if($command -match '(?i)-EncodedCommand\\s+"?([A-Za-z0-9+/=]+)'){
      try{$text+=' '+[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))}catch{}
    }
    if($text.Contains('Outlook.Application')){return 'outlook-com'}
    if($text.Contains('Win32_VideoController')){return 'gpu-discovery'}
    if($text.Contains('$taskProcess = Get-CimInstance Win32_Process')){return 'pty-identity'}
    if($text.Contains('class OwnedPtyStop')){return 'pty-stop'}
    return 'unclassified'
  }`;
}

/** Observe native main through its OS handle; Windows's cmd wrapper is separate. */
export async function monitorNativeApp(info: NativeAppInfo, child: ChildProcess, entry: string): Promise<NativeAppMonitor> {
  if (!Number.isSafeInteger(info.pid) || info.pid <= 0 || (info.pid !== child.pid && info.ppid !== child.pid)) throw new Error('Electron main does not belong to the launched process.');
  if (process.platform !== 'win32') {
    if (info.pid !== child.pid) throw new Error('Unsupported non-Windows Electron launcher: native ownership was not established.');
    const exit = new Promise<NativeAppExit>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve({ code: child.exitCode, signal: child.signalCode }); return; }
      child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject);
    });
    return { info, exit, snapshot: async () => undefined, verify: async () => child.exitCode !== null || child.signalCode !== null, cleanup: async () => {
      // Never signal a guessed process group shared with an unrelated app.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      return { forced: true, native: await exit };
    }, dispose: () => {} };
  }
  const startupStarted = Date.now();
  // The read-only observer still has a PowerShell module cache. Keep every
  // helper store inside this test's artifacts rather than the owner's profile.
  const observerHome = path.resolve('test-results', `native-observer-${process.pid}-${info.pid}-${Date.now()}`);
  const temporary = path.join(observerHome, 'Temp'), roaming = path.join(observerHome, 'AppData', 'Roaming'), local = path.join(observerHome, 'AppData', 'Local');
  for (const directory of [temporary, roaming, local]) fs.mkdirSync(directory, { recursive: true });
  const env = { ...process.env, HOME: observerHome, USERPROFILE: observerHome, TEMP: temporary, TMP: temporary, TMPDIR: temporary, APPDATA: roaming, LOCALAPPDATA: local };
  const expectedEntry = quote(path.resolve(entry)), expectedExecutable = quote(path.basename(info.execPath));
  const source = `$ErrorActionPreference='Stop';[Console]::WriteLine('stage:query-main');[Console]::Out.Flush();$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${info.pid}' -ErrorAction Stop;if(!$p -or $p.ParentProcessId -ne ${info.ppid} -or $p.Name -ne '${expectedExecutable}' -or $p.ExecutablePath -ne '${quote(info.execPath)}' -or !$p.CommandLine.Contains('${expectedEntry}')){throw 'Owned Electron command or creator mismatch'};[Console]::WriteLine('stage:open-main-handle');[Console]::Out.Flush();$held=[Diagnostics.Process]::GetProcessById(${info.pid});try{$handle=$held.Handle;$birth=$p.CreationDate.ToUniversalTime().Ticks;$heldBirth=$held.StartTime.ToUniversalTime().Ticks;if([decimal]::Truncate([decimal]$heldBirth/10) -ne [decimal]::Truncate([decimal]$birth/10)){throw 'Owned Electron creation mismatch'};[Console]::WriteLine('ready:'+(@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;execPath=[string]$p.ExecutablePath;entry='${expectedEntry}';creation=[string]$birth;heldCreation=[string]$heldBirth}|ConvertTo-Json -Compress));[Console]::Out.Flush();if(!$held.WaitForExit(900000)){throw 'Native Electron observer lifetime exceeded'};[Console]::WriteLine('exit:'+(@{code=$held.ExitCode;creation=[string]$birth}|ConvertTo-Json -Compress));[Console]::Out.Flush()}finally{$held.Dispose()}`;
  const watcher = spawn('powershell.exe', encoded(source), { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const startupArtifact = path.join(observerHome, 'startup.json');
  let output = '', stdoutTail = '', stderr = '', creation: string | undefined, exited = false, validationError: Error | undefined;
  const diagnostic = (status: 'ready' | 'failed', failure?: string): NativeStartupDiagnostic => ({ budgetMs: NATIVE_STARTUP_BUDGET_MS, durationMs: Date.now() - startupStarted, artifact: startupArtifact, status, watcherPid: watcher.pid, stdoutTail, stderrTail: stderr, ...(failure ? { failure } : {}) });
  let readyResolve!: () => void, readyReject!: (error: Error) => void, exitResolve!: (result: NativeAppExit) => void, exitReject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { readyResolve = yes; readyReject = no; });
  const exit = new Promise<NativeAppExit>((yes, no) => { exitResolve = yes; exitReject = no; }); void exit.catch(() => {});
  watcher.stdout!.on('data', chunk => {
    stdoutTail = (stdoutTail + String(chunk)).slice(-4096); output += String(chunk);
    if (output.length > 16 * 1024) { validationError = new Error('Native observer startup output exceeded its bound'); readyReject(validationError); exitReject(validationError); output = ''; return; }
    for (let newline = output.indexOf('\n'); newline >= 0; newline = output.indexOf('\n')) {
      const line = output.slice(0, newline).trim(); output = output.slice(newline + 1);
      try {
        if (line.startsWith('ready:')) {
          const value = JSON.parse(line.slice(6));
          if (value.pid !== info.pid || value.ppid !== info.ppid || typeof value.execPath !== 'string' || path.win32.normalize(value.execPath).toLowerCase() !== path.win32.normalize(info.execPath).toLowerCase() || typeof value.entry !== 'string' || path.resolve(value.entry).toLowerCase() !== path.resolve(entry).toLowerCase()) throw new Error('Invalid native startup identity receipt');
          if (typeof value.creation !== 'string' || typeof value.heldCreation !== 'string' || !/^\d{1,19}$/.test(value.creation) || !/^\d{1,19}$/.test(value.heldCreation) || BigInt(value.creation) <= 0n || BigInt(value.heldCreation) <= 0n || BigInt(value.creation) / 10n !== BigInt(value.heldCreation) / 10n) throw new Error('Invalid native creation receipt');
          creation = value.creation; readyResolve();
        }
        if (line.startsWith('exit:')) { const value = JSON.parse(line.slice(5)); if (!creation || value.creation !== creation || !Number.isInteger(value.code)) throw new Error('Invalid native exit receipt'); exited = true; exitResolve(value); }
      } catch (error) { validationError = error as Error; readyReject(validationError); exitReject(validationError); }
    }
  });
  watcher.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  watcher.once('error', error => { readyReject(error); exitReject(error); });
  watcher.once('exit', code => { const error = new Error(`Native Electron observer exited ${code}: ${stderr}`); if (!creation) readyReject(error); if (!exited) exitReject(error); });
  const timer = setTimeout(() => readyReject(new Error('Native Electron observer identity exceeded 15 seconds')), Math.max(1, NATIVE_STARTUP_BUDGET_MS - (Date.now() - startupStarted)));
  let startup: NativeStartupDiagnostic;
  try {
    await ready; if (validationError) throw validationError;
    startup = diagnostic('ready');
    fs.writeFileSync(startupArtifact, JSON.stringify({ ...startup, expected: { ...info, entry: path.resolve(entry) }, creation }, null, 2));
  } catch (error) {
    const failed = diagnostic('failed', error instanceof Error ? error.message : String(error));
    // This is the exact ChildProcess we spawned as a read-only watcher. Missing
    // native identity never authorizes signaling Electron or any guessed PID.
    try { failed.watcherCleanupRequested = watcher.kill(); } catch { failed.watcherCleanupRequested = false; }
    fs.writeFileSync(startupArtifact, JSON.stringify({ ...failed, expected: { ...info, entry: path.resolve(entry) } }, null, 2));
    throw new Error(`${failed.failure}. Startup diagnostics: ${startupArtifact}`);
  } finally { clearTimeout(timer); }
  const observations: NativeAppObservation[] = [];
  return {
    info, creation, exit, startup,
    observations,
    snapshot: async () => {
      const tree = `$ErrorActionPreference='Stop';${nativePurposeClassifierSource()};$all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$root=$all|Where-Object{$_.ProcessId -eq ${info.pid} -and $_.ParentProcessId -eq ${info.ppid} -and $_.CreationDate.ToUniversalTime().Ticks -eq [long]${creation}};if(!$root){throw 'Owned native main disappeared before snapshot'};$owned=@($root);for($level=0;$level -lt $owned.Count;$level++){$parent=$owned[$level];$owned+=@($all|Where-Object{$_.ParentProcessId -eq $parent.ProcessId -and $_.CreationDate -ge $parent.CreationDate -and $_.ProcessId -notin $owned.ProcessId});if($owned.Count -gt 128){throw 'Owned process tree exceeds bound'}};$receipt=@($owned|ForEach-Object{@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;creation=[string]$_.CreationDate.ToUniversalTime().Ticks;name=[string]$_.Name;purpose=(Get-CapturedPurpose ([string]$_.CommandLine))}});ConvertTo-Json -InputObject @($receipt) -Depth 4 -Compress`;
      const receipt = JSON.parse((await powershell(tree, env)).trim()) as WorkspacePtyStopReceipt;
      if (!Array.isArray(receipt) || !receipt.length || receipt.length > 128 || receipt[0].pid !== info.pid || receipt[0].creation !== creation || receipt[0].parent !== info.ppid) throw new Error('Invalid native owned-tree snapshot');
      return receipt;
    },
    verify: async receipt => {
      if (!receipt) return exited;
      const value = Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64');
      const source = `$ErrorActionPreference='Stop';$captured=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${value}')));$all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$live=@();foreach($identity in $captured){$matching=$all|Where-Object{$_.ProcessId -eq $identity.pid -and $_.CreationDate.ToUniversalTime().Ticks -eq [long]$identity.creation};foreach($match in $matching){$live+=@{pid=[int]$match.ProcessId;parent=[int]$match.ParentProcessId;creation=[string]$match.CreationDate.ToUniversalTime().Ticks;name=[string]$match.Name}}};ConvertTo-Json -InputObject @{gone=($live.Count -eq 0);live=@($live)} -Depth 4 -Compress`;
      const result = JSON.parse((await powershell(source, env)).trim()) as Omit<NativeAppObservation, 'at'>;
      if (typeof result.gone !== 'boolean' || !Array.isArray(result.live) || result.live.length > 128 || result.gone !== (result.live.length === 0) || result.live.some(row => !receipt.some(identity => identity.pid === row.pid && identity.creation === row.creation) || typeof row.name !== 'string')) throw new Error('Invalid owned identity disappearance receipt');
      observations.push({ at: Date.now(), ...result });
      return result.gone;
    },
    cleanup: receipt => stopWorkspacePtyTree(info.pid, { creation: creation!, parent: info.ppid }, receipt, env),
    dispose: () => { if (watcher.exitCode === null && watcher.signalCode === null) watcher.kill(); },
  };
}
