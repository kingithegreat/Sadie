import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { verifiedWorkspaceWindowsJobAsset } from './workspace-windows-job-asset';
import type { WorkspacePtyIdentity } from './workspace-pty-identity';

export interface WorkspaceWindowsJob {
  readonly ready: Promise<void>;
  queryEmpty(): Promise<boolean>;
  stop(): Promise<void>;
}
export interface WorkspaceApprovedLaunch {
  executable: string; args: string[]; env: NodeJS.ProcessEnv; kind?: 'task'; cwd?: string;
  /** Main-only Windows PTY mode; no renderer supplies console devices or FDs. */
  console?: 'attached';
  /** Constructed only by the trusted main snapshot helper, never IPC arguments. */
  adapter?: { kind: 'cross-spawn'; modulePath: string; comspec: string };
}
export interface PendingWorkspaceWindowsJob extends WorkspaceWindowsJob {
  readonly listening: Promise<void>;
  attach(pid: number, original: WorkspacePtyIdentity): Promise<void>;
  /** Task-only live-peer capture; originating parent is always main process.pid. */
  attachChild?(pid: number): Promise<WorkspacePtyIdentity>;
  authorize(launch: WorkspaceApprovedLaunch, validate?: () => void): Promise<number>;
  /** Observability only; never evidence of readiness, membership or cleanup. */
  getStartupDiagnostics?(): WorkspaceJobStartupDiagnostics;
}
export interface WorkspaceJobStartupDiagnostics {
  spawnObservedMs?: number;
  startupTimeoutObservedMs?: number;
  phases: Array<{ phase: string; observedMs: number; code?: string; nativeCode?: string }>;
  close?: { observedMs: number; outcome: 'zero' | 'nonzero' | 'signal' | 'unknown' | 'not-started'; exitCode?: number };
  /** No ChildProcess/helper/Job was ever created; not an OS exit receipt. */
  noOwnerCleanupConfirmed?: true;
}
interface JobOptions { env?: NodeJS.ProcessEnv; gate?: { pipeName: string; capability: string } }
type Reply = { type?: unknown; id?: unknown; ok?: unknown; empty?: unknown; pid?: unknown; creation?: unknown; parent?: unknown; phase?: unknown; code?: unknown; nativeCode?: unknown };
const OPERATION_TIMEOUT = 4500;
const MAX_LINE = 4096;
const DIAGNOSTIC_PHASES = new Set(['entry', 'encoding', 'encoding-constructed', 'encoding-set', 'setup', 'setup-read', 'utility-import', 'utility-imported', 'compile', 'asset-load', 'asset-loaded', 'create', 'listen', 'command', 'attach', 'go', 'query', 'stop']);
const DIAGNOSTIC_CODES = new Set(['create', 'limits', 'pipe', 'open', 'identity', 'assign', 'root', 'peer-timeout', 'peer', 'capability', 'peer-read-timeout', 'peer-input', 'query', 'baseline', 'child', 'completion', 'membership', 'operation', 'console-input', 'console-output', 'console-close', 'spawn', 'unknown']);
const DIAGNOSTIC_NATIVE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENXIO', 'EINVAL', 'EBADF', 'EIO', 'ENOTSUP', 'UNKNOWN']);

/** Return cleanup ownership before asynchronous helper startup or assignment. */
export function createPendingWorkspaceWindowsJob(options: JobOptions = {}): PendingWorkspaceWindowsJob {
  let child: ChildProcessWithoutNullStreams | undefined;
  let asset: { assembly: string; sha256: string };
  let setup: string;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  let listenResolve!: () => void, listenReject!: (error: Error) => void;
  let closeResolve!: () => void;
  let closed = false, attached = false, authorized = false, complete = false;
  let closeCode: number | null = null;
  let zeroConfirmed = false;
  let noOwnerCleanupConfirmed = false;
  let stopping: Promise<void> | undefined;
  let nextId = 0, lineBuffer = '';
  let phase = 'unobserved', diagnosticFailure: string | undefined;
  let spawnStarted = Date.now(), phaseObservedAt: number | undefined;
  let spawnObservedMs: number | undefined, startupTimeoutObservedMs: number | undefined;
  let observedClose: WorkspaceJobStartupDiagnostics['close'];
  const observedPhases: WorkspaceJobStartupDiagnostics['phases'] = [];
  const elapsed = () => {
    const value = Date.now() - spawnStarted;
    return Number.isFinite(value) ? Math.max(0, Math.min(60_000, Math.floor(value))) : 60_000;
  };
  const diagnostic = () => ` Helper phase: ${phase}.${phaseObservedAt === undefined ? '' : ` Observed ${phaseObservedAt}ms after helper spawn began.`}${diagnosticFailure ? ` Last fixed helper error: ${diagnosticFailure}.` : ''}`;
  const pending = new Map<number, { operation: string; resolve(value: Reply): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  const stopRequests = new Set<number>();
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const listening = new Promise<void>((resolve, reject) => { listenResolve = resolve; listenReject = reject; });
  void ready.catch(() => undefined); void listening.catch(() => undefined);
  const close = new Promise<void>(resolve => { closeResolve = resolve; });
  const fail = (message: string) => {
    const error = new Error(message); readyReject(error); listenReject(error);
    for (const [id, operation] of pending) { clearTimeout(operation.timer); pending.delete(id); operation.reject(error); }
  };
  const request = (operation: string, fields: object = {}): Promise<Reply> => {
    if (!child || closed) return Promise.reject(new Error('The owned Job helper is unavailable; process cleanup is unverified.'));
    const id = ++nextId;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The owned Job did not confirm its state in time. Its cleanup ownership is retained.' + diagnostic())); }, OPERATION_TIMEOUT);
      pending.set(id, { operation, resolve, reject, timer });
      if (operation === 'stop') { stopRequests.add(id); if (stopRequests.size > 16) stopRequests.delete(stopRequests.values().next().value!); }
      const encoded = JSON.stringify({ ...fields, id, operation }) + '\n';
      if (encoded.length > 131072) { clearTimeout(timer); pending.delete(id); reject(new Error('The approved launch exceeds its bounded transport size.')); return; }
      child!.stdin.write(encoded, error => {
        if (!error) return; const item = pending.get(id); if (!item) return;
        clearTimeout(item.timer); pending.delete(id); item.reject(new Error('The owned Job request could not be delivered.'));
      });
    });
  };
  const job: PendingWorkspaceWindowsJob = {
    ready, listening,
    getStartupDiagnostics: () => ({
      ...(spawnObservedMs === undefined ? {} : { spawnObservedMs }),
      ...(startupTimeoutObservedMs === undefined ? {} : { startupTimeoutObservedMs }),
      phases: observedPhases.map(observation => ({ ...observation })),
      ...(observedClose ? { close: { ...observedClose } } : {}),
      ...(noOwnerCleanupConfirmed ? { noOwnerCleanupConfirmed: true as const } : {}),
    }),
    attach: async (pid, original) => {
      if (attached || !Number.isSafeInteger(pid) || pid <= 0 || !original || !/^\d{1,19}$/.test(original.creation) || BigInt(original.creation) <= 0n || !Number.isSafeInteger(original.parent) || original.parent <= 0) {
        const error = new Error('One positive captured native identity is required before Job assignment.'); readyReject(error); throw error;
      }
      attached = true;
      try {
        await listening; const result = await request('attach', { pid, creation: original.creation });
        if (result.ok !== true) throw new Error('Job assignment or startup peer verification failed. No project execution was released.' + diagnostic());
        readyResolve();
      } catch (error) { readyReject(error instanceof Error ? error : new Error('Job assignment failed.')); throw error; }
    },
    attachChild: async pid => {
      if (!options.gate || attached || !Number.isSafeInteger(pid) || pid <= 0) {
        const error = new Error('One fixed task child and its private startup peer are required.'); readyReject(error); throw error;
      }
      attached = true;
      try {
        await listening;
        const result = await request('attach-child', { pid, parent: process.pid });
        if (result.ok !== true || typeof result.creation !== 'string' || !/^\d{1,19}$/.test(result.creation) || BigInt(result.creation) <= 0n || result.parent !== process.pid) {
          throw new Error('The task launcher creation identity could not be verified. No package code was released.' + diagnostic());
        }
        readyResolve(); return { creation: result.creation, parent: process.pid };
      } catch (error) { readyReject(error instanceof Error ? error : new Error('Task child assignment failed.')); throw error; }
    },
    authorize: async (launch, validate) => {
      if (!options.gate || authorized) throw new Error('The startup handoff is single-use.');
      authorized = true; await ready;
      if (typeof launch.executable !== 'string' || !launch.executable || !Array.isArray(launch.args) || launch.args.some(arg => typeof arg !== 'string') || !launch.env || typeof launch.env !== 'object') throw new Error('A main-approved launch is required.');
      if (launch.kind !== undefined && launch.kind !== 'task') throw new Error('The approved launch kind is invalid.');
      if (launch.console !== undefined && (launch.console !== 'attached' || launch.kind !== undefined || launch.adapter !== undefined)) throw new Error('Attached console handles are restricted to the main-approved terminal profile.');
      // The originating main-owned scope must still hold after readiness.
      validate?.();
      const result = await request('go', { launch });
      if (result.ok !== true || !Number.isSafeInteger(result.pid) || (result.pid as number) <= 0) throw new Error('The approved shell did not confirm a positive owned process. Its Job is retained for cleanup.' + diagnostic());
      return result.pid as number;
    },
    queryEmpty: async () => {
      await ready; const result = await request('query');
      if (result.ok !== true || typeof result.empty !== 'boolean') throw new Error('The owned Job state is unverified.' + diagnostic());
      return result.empty;
    },
    stop: () => {
      if (complete) return Promise.resolve(); if (stopping) return stopping;
      if (!child && closed && observedClose?.outcome === 'not-started') {
        // This branch cannot consume an OS close event or a returned uncertain
        // ChildProcess: there was never a helper to own or admit into a Job.
        noOwnerCleanupConfirmed = true; complete = true; return Promise.resolve();
      }
      const operation = (async () => {
        await listening.catch(() => undefined);
        if (!closed) {
          const result = await request('stop');
          if (result.ok !== true || result.empty !== true) throw new Error('The owned Job did not confirm all its processes exited. Retry Stop.' + diagnostic());
          zeroConfirmed = true;
        }
        if (!zeroConfirmed) throw new Error('The owned Job helper was lost without verified cleanup.');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The owned Job helper has not closed. Its cleanup ownership is retained.')), OPERATION_TIMEOUT);
          void close.then(() => { clearTimeout(timer); resolve(); });
        });
        if (closeCode !== 0) throw new Error('The owned Job helper exited unexpectedly; cleanup is unverified.');
        complete = true;
      })();
      stopping = operation;
      void operation.catch(() => { if (stopping === operation) stopping = undefined; });
      return operation;
    },
  };
  if (options.gate && (!/^hbi-[a-f0-9-]{36}$/.test(options.gate.pipeName) || !/^[a-f0-9]{64}$/.test(options.gate.capability))) {
    observedClose = { observedMs: elapsed(), outcome: 'not-started' };
    closed = true; closeResolve(); fail('The private startup pipe configuration is invalid.'); return job;
  }
  try {
    // Fixed argv contains no bearer, launch command, environment or project.
    // Sensitive setup and GO use only the owned process's stdin transport.
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('The Windows system installation path is unavailable.');
    const helperExecutable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    asset = verifiedWorkspaceWindowsJobAsset();
    const encodedPath = Buffer.from(asset.assembly, 'utf8').toString('base64');
    if (!encodedPath || encodedPath.length > 8192 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('The fixed product setup is invalid.');
    setup = [encodedPath, asset.sha256, options.gate?.pipeName || '', options.gate?.capability || ''].join('\n') + '\n';
    spawnStarted = Date.now();
    child = spawn(helperExecutable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(windowsJobSource(), 'utf16le').toString('base64')], { windowsHide: true, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { observedClose = { observedMs: elapsed(), outcome: 'not-started' }; closed = true; closeResolve(); fail('The owned Job helper could not start.'); return job; }
  const startupTimer = setTimeout(() => {
    startupTimeoutObservedMs = elapsed();
    fail('The owned Job helper did not become ready in time. Cleanup ownership is retained.' + diagnostic());
  }, OPERATION_TIMEOUT);
  child.once('spawn', () => { spawnObservedMs = elapsed(); });
  child.stdin.on('error', () => fail('The owned Job control pipe failed. Cleanup ownership is retained.'));
  child.stdout.on('data', (chunk: Buffer | string) => {
    lineBuffer += chunk.toString();
    if (lineBuffer.length > MAX_LINE && !lineBuffer.includes('\n')) { lineBuffer = ''; fail('The owned Job helper returned an oversized response.'); return; }
    for (;;) {
      const end = lineBuffer.indexOf('\n'); if (end < 0) break;
      const line = lineBuffer.slice(0, end); lineBuffer = lineBuffer.slice(end + 1);
      if (line.length > MAX_LINE) { fail('The owned Job helper returned an oversized response.'); continue; }
      let message: Reply;
      try { const value: unknown = JSON.parse(line); if (!value || typeof value !== 'object') throw new Error(); message = value as Reply; }
      catch { fail('The owned Job helper returned invalid state evidence.'); continue; }
      if (message.type === 'phase' && typeof message.phase === 'string' && DIAGNOSTIC_PHASES.has(message.phase) && (message.code === undefined || typeof message.code === 'string' && DIAGNOSTIC_CODES.has(message.code)) && (message.nativeCode === undefined || typeof message.nativeCode === 'string' && DIAGNOSTIC_NATIVE_CODES.has(message.nativeCode))) {
        // Observability only: a phase never proves listening, assignment or zero accounting.
        phase = message.phase; phaseObservedAt = Math.max(0, Date.now() - spawnStarted);
        observedPhases.push({ phase, observedMs: elapsed(),
          ...(typeof message.code === 'string' ? { code: message.code } : {}),
          ...(typeof message.nativeCode === 'string' ? { nativeCode: message.nativeCode } : {}),
        });
        if (observedPhases.length > 16) observedPhases.shift();
        if (typeof message.code === 'string') diagnosticFailure = `${phase}/${message.code}${typeof message.nativeCode === 'string' ? ` (${message.nativeCode})` : ''}`;
        else if (['attach', 'go', 'query', 'stop'].includes(phase)) diagnosticFailure = undefined;
      }
      else if (message.type === 'listening') { clearTimeout(startupTimer); listenResolve(); }
      else if (message.type === 'result' && Number.isSafeInteger(message.id)) {
        if (stopRequests.has(message.id as number) && message.ok === true && message.empty === true) zeroConfirmed = true;
        const item = pending.get(message.id as number); if (!item) continue;
        clearTimeout(item.timer); pending.delete(message.id as number); item.resolve(message);
      } else fail('The owned Job helper returned unknown state evidence.');
    }
  });
  child.stderr.on('data', () => undefined);
  child.once('error', () => fail('The owned Job helper failed. No cleanup completion was proven.'));
  child.once('close', (code, signal) => {
    const boundedCode = Number.isInteger(code) && code !== null && code >= -2147483648 && code <= 4294967295 ? code : undefined;
    observedClose = { observedMs: elapsed(), outcome: signal ? 'signal' : boundedCode === 0 ? 'zero' : boundedCode === undefined ? 'unknown' : 'nonzero',
      ...(boundedCode === undefined ? {} : { exitCode: boundedCode }),
    };
    clearTimeout(startupTimer); closed = true; closeCode = code; closeResolve(); if (!zeroConfirmed || code !== 0) fail('The owned Job helper closed without verified cleanup.');
  });
  // Setup has four fixed bounded lines, not a PowerShell JSON cmdlet cold path.
  // Capabilities remain only in the held stdin pipe, never executable argv.
  child.stdin.write(setup!);
  return job;
}

export function createWorkspaceWindowsJob(pid: number, original: WorkspacePtyIdentity, options: { env?: NodeJS.ProcessEnv } = {}): WorkspaceWindowsJob {
  const job = createPendingWorkspaceWindowsJob(options);
  void job.attach(pid, original).catch(() => undefined);
  return job;
}

function windowsJobSource(): string {
  return `[Console]::Out.WriteLine('{"type":"phase","phase":"entry"}'); [Console]::Out.Flush()
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
[Console]::Out.WriteLine('{"type":"phase","phase":"encoding"}'); [Console]::Out.Flush()
$inputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::Out.WriteLine('{"type":"phase","phase":"encoding-constructed"}'); [Console]::Out.Flush()
[Console]::InputEncoding=$inputEncoding
[Console]::Out.WriteLine('{"type":"phase","phase":"encoding-set"}'); [Console]::Out.Flush()
function ReadSetupLine([int]$maximum,[bool]$allowCleanEof=$false) {
 $text=[System.Text.StringBuilder]::new()
 while($true) { $character=[Console]::In.Read(); if($character -lt 0) { if($allowCleanEof -and $text.Length -eq 0) { return $null }; throw 'input' }; if($character -eq 10) { return $text.ToString() }; if($character -eq 13 -or $text.Length -ge $maximum) { throw 'input' }; [void]$text.Append([char]$character) }
}
function Emit($value) { [Console]::Out.WriteLine([OwnedWindowsJob]::EncodeFrame($value)); [Console]::Out.Flush() }
try {
 [Console]::Out.WriteLine('{"type":"phase","phase":"setup"}'); [Console]::Out.Flush()
 $encodedPath=ReadSetupLine 8192; $expectedHash=ReadSetupLine 64; $pipeName=ReadSetupLine 40; $capability=ReadSetupLine 64
 if($encodedPath.Length -eq 0 -or $encodedPath -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $expectedHash -cnotmatch '^[a-f0-9]{64}$') { throw 'input' }
 $pathBytes=[System.Convert]::FromBase64String($encodedPath); if([System.Convert]::ToBase64String($pathBytes) -cne $encodedPath) { throw 'input' }
 $assemblyPath=[System.Text.UTF8Encoding]::new($false,$true).GetString($pathBytes)
 if(![System.IO.Path]::IsPathRooted($assemblyPath) -or $assemblyPath.IndexOf([char]0) -ge 0 -or $assemblyPath.IndexOf([char]10) -ge 0 -or $assemblyPath.IndexOf([char]13) -ge 0) { throw 'input' }
 $gate=$null
 if($pipeName.Length -ne 0 -or $capability.Length -ne 0) { if($pipeName -cnotmatch '^hbi-[a-f0-9-]{36}$' -or $capability -cnotmatch '^[a-f0-9]{64}$') { throw 'input' }; $gate=@{pipeName=$pipeName;capability=$capability} }
 $initial=@{asset=@{assembly=$assemblyPath;sha256=$expectedHash};gate=$gate}
 [Console]::Out.WriteLine('{"type":"phase","phase":"setup-read"}'); [Console]::Out.Flush()
 [Console]::Out.WriteLine('{"type":"phase","phase":"asset-load"}'); [Console]::Out.Flush()
 if($initial.asset.assembly -isnot [string] -or ![System.IO.Path]::IsPathRooted($initial.asset.assembly) -or $initial.asset.sha256 -isnot [string] -or $initial.asset.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'asset' }
 $assetStream=[System.IO.File]::Open($initial.asset.assembly,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)
 try {
  if($assetStream.Length -lt 512 -or $assetStream.Length -gt 1048576) { throw 'asset' }
  $assetBytes=[byte[]]::new([int]$assetStream.Length); $offset=0
  while($offset -lt $assetBytes.Length) { $read=$assetStream.Read($assetBytes,$offset,$assetBytes.Length-$offset); if($read -le 0) { throw 'asset' }; $offset+=$read }
 } finally { $assetStream.Dispose() }
 $hasher=[System.Security.Cryptography.SHA256]::Create()
 try { $actualHash=[System.BitConverter]::ToString($hasher.ComputeHash($assetBytes)).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
 if($actualHash -cne $initial.asset.sha256) { throw 'asset' }
 [void][System.Reflection.Assembly]::Load($assetBytes)
 if(!('OwnedWindowsJob' -as [type])) { throw 'asset' }
 [Console]::Out.WriteLine('{"type":"phase","phase":"asset-loaded"}'); [Console]::Out.Flush()
 Emit @{type='phase';phase='create'}
 [OwnedWindowsJob]::Create()
 if($initial.gate) { Emit @{type='phase';phase='listen'}; [OwnedWindowsJob]::Listen([string]$initial.gate.pipeName) }
 Emit @{type='listening'}
 $attached=$false; $authorized=$false
 while($true) {
  Emit @{type='phase';phase='command'}
  $line=ReadSetupLine 131072 $true; if($null -eq $line) { if([OwnedWindowsJob]::Stop()) { exit 0 }; exit 1 }
  if($line.Length -gt 131072) { throw 'input' }; $request=[OwnedWindowsJob]::ParseFrame($line)
  if($request.id -isnot [int] -or $request.id -le 0 -or $request.operation -isnot [string]) { throw 'request' }
  foreach($key in $request.Keys) { if($key -cnotin @('id','operation','pid','creation','parent','launch')) { throw 'request' } }
  try {
   if($request.operation -in @('attach','attach-child','go','query','stop')) { $phase=if($request.operation -eq 'attach-child'){'attach'}else{[string]$request.operation}; Emit @{type='phase';phase=$phase} }
   if($request.operation -eq 'attach' -and !$attached) {
    if($request.pid -isnot [int] -or $request.pid -le 0 -or $request.creation -isnot [string] -or $request.creation -cnotmatch '^[0-9]{1,19}$' -or [long]$request.creation -le 0) { throw 'operation' }
    $attached=$true; [OwnedWindowsJob]::Attach([int]$request.pid,[long]$request.creation,[string]$initial.gate.capability); Emit @{type='result';id=$request.id;ok=$true}
   }
   elseif($request.operation -eq 'attach-child' -and !$attached -and $initial.gate) {
    if($request.Count -ne 4 -or $request.pid -isnot [int] -or $request.pid -le 0 -or $request.parent -isnot [int] -or $request.parent -le 0) { throw 'operation' }
    $attached=$true; $identity=[OwnedWindowsJob]::ParseFrame([OwnedWindowsJob]::AttachChild([int]$request.pid,[int]$request.parent,[string]$initial.gate.capability))
    Emit @{type='result';id=$request.id;ok=$true;creation=$identity.creation;parent=$identity.parent}
   }
   elseif($request.operation -eq 'go' -and $attached -and $initial.gate -and !$authorized) {
    $authorized=$true; $ack=[OwnedWindowsJob]::ParseFrame([OwnedWindowsJob]::Go([OwnedWindowsJob]::EncodeFrame($request.launch)))
    if($ack.type -eq 'launch-error') {
     if($ack.stage -is [string] -and $ack.code -is [string] -and $ack.stage -in @('console-input','console-output','console-close','spawn') -and $ack.code -in @('ENOENT','EACCES','EPERM','ENXIO','EINVAL','EBADF','EIO','ENOTSUP','UNKNOWN')) {
      Emit @{type='phase';phase='go';code=[string]$ack.stage;nativeCode=[string]$ack.code}
      Emit @{type='result';id=$request.id;ok=$false}; continue
     }; throw 'child'
    }
    if($ack.type -isnot [string] -or $ack.type -ne 'spawn' -or $ack.pid -isnot [int] -or $ack.pid -le 0) { throw 'child' }
    $member=[OwnedWindowsJob]::VerifyChild($ack.pid)
    if($member -eq 0 -and $request.launch.kind -eq 'task') {
     $done=[OwnedWindowsJob]::ParseFrame([OwnedWindowsJob]::ReadCompletion())
     if($done.type -isnot [string] -or $done.type -ne 'completed' -or $done.pid -isnot [int] -or $done.pid -ne $ack.pid -or $done.exitCode -isnot [int] -or ![OwnedWindowsJob]::CompletedTarget()) { throw 'completion' }
    } elseif($member -ne 1) { throw 'membership' }
    [OwnedWindowsJob]::Accept(); [OwnedWindowsJob]::ReleaseGate(); Emit @{type='result';id=$request.id;ok=$true;pid=$ack.pid}
   }
   elseif($request.operation -eq 'query' -and $attached) { Emit @{type='result';id=$request.id;ok=$true;empty=[OwnedWindowsJob]::Empty()} }
   elseif($request.operation -eq 'stop') { $empty=[OwnedWindowsJob]::Stop(); Emit @{type='result';id=$request.id;ok=$true;empty=$empty}; if($empty) { exit 0 } }
   else { throw 'operation' }
  } catch {
   $exception=$_.Exception; while($exception.InnerException) { $exception=$exception.InnerException }
   $code='unknown'; if($exception.Message -in @('create','limits','pipe','open','identity','assign','root','peer-timeout','peer','capability','peer-read-timeout','peer-input','query','baseline','child','completion','membership','operation')) { $code=$exception.Message }
   if($request.operation -in @('attach','attach-child','go','query','stop')) { $phase=if($request.operation -eq 'attach-child'){'attach'}else{[string]$request.operation}; Emit @{type='phase';phase=$phase;code=$code} }
   Emit @{type='result';id=$request.id;ok=$false}
  }
 }
} finally { if('OwnedWindowsJob' -as [type]) { [OwnedWindowsJob]::Close() } }
`;
}
