import { execFile, spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { stopWorkspacePtyTree, type WorkspacePtyStopReceipt } from '../../../main/workspace-pty-force-stop';

export interface NativeAppInfo { pid: number; ppid: number; execPath: string }
export interface NativeAppExit { code: number | null; signal?: string | null; creation?: string }
export interface NativeAppMonitor {
  info: NativeAppInfo;
  creation?: string;
  exit: Promise<NativeAppExit>;
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
  // The read-only observer still has a PowerShell module cache. Keep every
  // helper store inside this test's artifacts rather than the owner's profile.
  const observerHome = path.resolve('test-results', `native-observer-${process.pid}-${info.pid}-${Date.now()}`);
  const temporary = path.join(observerHome, 'Temp'), roaming = path.join(observerHome, 'AppData', 'Roaming'), local = path.join(observerHome, 'AppData', 'Local');
  for (const directory of [temporary, roaming, local]) fs.mkdirSync(directory, { recursive: true });
  const env = { ...process.env, HOME: observerHome, USERPROFILE: observerHome, TEMP: temporary, TMP: temporary, TMPDIR: temporary, APPDATA: roaming, LOCALAPPDATA: local };
  const expectedEntry = quote(path.resolve(entry)), expectedExecutable = quote(path.basename(info.execPath));
  const source = `$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${info.pid}' -ErrorAction Stop;if(!$p -or $p.ParentProcessId -ne ${info.ppid} -or $p.Name -ne '${expectedExecutable}' -or !$p.CommandLine.Contains('${expectedEntry}')){throw 'Owned Electron command or creator mismatch'};$held=[Diagnostics.Process]::GetProcessById(${info.pid});try{$handle=$held.Handle;$birth=$p.CreationDate.ToUniversalTime().Ticks;if([decimal]::Truncate([decimal]$held.StartTime.ToUniversalTime().Ticks/10) -ne [decimal]::Truncate([decimal]$birth/10)){throw 'Owned Electron creation mismatch'};[Console]::WriteLine('ready:'+(@{creation=[string]$birth}|ConvertTo-Json -Compress));[Console]::Out.Flush();if(!$held.WaitForExit(900000)){throw 'Native Electron observer lifetime exceeded'};[Console]::WriteLine('exit:'+(@{code=$held.ExitCode;creation=[string]$birth}|ConvertTo-Json -Compress));[Console]::Out.Flush()}finally{$held.Dispose()}`;
  const watcher = spawn('powershell.exe', encoded(source), { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = '', creation: string | undefined, exited = false;
  let readyResolve!: () => void, readyReject!: (error: Error) => void, exitResolve!: (result: NativeAppExit) => void, exitReject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { readyResolve = yes; readyReject = no; });
  const exit = new Promise<NativeAppExit>((yes, no) => { exitResolve = yes; exitReject = no; }); void exit.catch(() => {});
  watcher.stdout!.on('data', chunk => {
    output += String(chunk);
    for (let newline = output.indexOf('\n'); newline >= 0; newline = output.indexOf('\n')) {
      const line = output.slice(0, newline).trim(); output = output.slice(newline + 1);
      try {
        if (line.startsWith('ready:')) { const value = JSON.parse(line.slice(6)); if (!/^\d{1,19}$/.test(value.creation)) throw new Error('Invalid native creation receipt'); creation = value.creation; readyResolve(); }
        if (line.startsWith('exit:')) { const value = JSON.parse(line.slice(5)); if (value.creation !== creation || !Number.isInteger(value.code)) throw new Error('Invalid native exit receipt'); exited = true; exitResolve(value); }
      } catch (error) { readyReject(error as Error); exitReject(error as Error); }
    }
  });
  watcher.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  watcher.once('error', error => { readyReject(error); exitReject(error); });
  watcher.once('exit', code => { const error = new Error(`Native Electron observer exited ${code}: ${stderr}`); if (!creation) readyReject(error); if (!exited) exitReject(error); });
  const timer = setTimeout(() => readyReject(new Error('Native Electron observer identity exceeded 8 seconds')), 8000);
  try { await ready; } catch (error) { watcher.kill(); throw error; } finally { clearTimeout(timer); }
  return {
    info, creation, exit,
    snapshot: async () => {
      const tree = `$ErrorActionPreference='Stop';$all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$root=$all|Where-Object{$_.ProcessId -eq ${info.pid} -and $_.ParentProcessId -eq ${info.ppid} -and $_.CreationDate.ToUniversalTime().Ticks -eq [long]${creation}};if(!$root){throw 'Owned native main disappeared before snapshot'};$owned=@($root);for($level=0;$level -lt $owned.Count;$level++){$parent=$owned[$level];$owned+=@($all|Where-Object{$_.ParentProcessId -eq $parent.ProcessId -and $_.CreationDate -ge $parent.CreationDate -and $_.ProcessId -notin $owned.ProcessId});if($owned.Count -gt 128){throw 'Owned process tree exceeds bound'}};$receipt=@($owned|ForEach-Object{@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;creation=[string]$_.CreationDate.ToUniversalTime().Ticks}});ConvertTo-Json -InputObject @($receipt) -Depth 4 -Compress`;
      const receipt = JSON.parse((await powershell(tree, env)).trim()) as WorkspacePtyStopReceipt;
      if (!Array.isArray(receipt) || !receipt.length || receipt.length > 128 || receipt[0].pid !== info.pid || receipt[0].creation !== creation || receipt[0].parent !== info.ppid) throw new Error('Invalid native owned-tree snapshot');
      return receipt;
    },
    verify: async receipt => {
      if (!receipt) return exited;
      const value = Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64');
      const source = `$ErrorActionPreference='Stop';$captured=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${value}')));$all=@(Get-CimInstance Win32_Process -ErrorAction Stop);foreach($identity in $captured){if($all|Where-Object{$_.ProcessId -eq $identity.pid -and $_.CreationDate.ToUniversalTime().Ticks -eq [long]$identity.creation}){[Console]::Write('live');exit 0}};[Console]::Write('gone')`;
      return (await powershell(source, env)).trim() === 'gone';
    },
    cleanup: receipt => stopWorkspacePtyTree(info.pid, { creation: creation!, parent: info.ppid }, receipt, env),
    dispose: () => { if (watcher.exitCode === null && watcher.signalCode === null) watcher.kill(); },
  };
}
