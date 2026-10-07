import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import type { WorkspacePtyIdentity } from './workspace-pty-identity';

export interface WorkspaceWindowsJob {
  readonly ready: Promise<void>;
  queryEmpty(): Promise<boolean>;
  stop(): Promise<void>;
}
export interface WorkspaceApprovedLaunch { executable: string; args: string[]; env: NodeJS.ProcessEnv; kind?: 'task' }
export interface PendingWorkspaceWindowsJob extends WorkspaceWindowsJob {
  readonly listening: Promise<void>;
  attach(pid: number, original: WorkspacePtyIdentity): Promise<void>;
  authorize(launch: WorkspaceApprovedLaunch, validate?: () => void): Promise<number>;
}
interface JobOptions { env?: NodeJS.ProcessEnv; gate?: { pipeName: string; capability: string } }
type Reply = { type?: unknown; id?: unknown; ok?: unknown; empty?: unknown; pid?: unknown };
const OPERATION_TIMEOUT = 4500;
const MAX_LINE = 4096;

/** Return cleanup ownership before asynchronous helper startup or assignment. */
export function createPendingWorkspaceWindowsJob(options: JobOptions = {}): PendingWorkspaceWindowsJob {
  let child: ChildProcessWithoutNullStreams | undefined;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  let listenResolve!: () => void, listenReject!: (error: Error) => void;
  let closeResolve!: () => void;
  let closed = false, attached = false, authorized = false, complete = false;
  let closeCode: number | null = null;
  let zeroConfirmed = false;
  let stopping: Promise<void> | undefined;
  let nextId = 0, lineBuffer = '';
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The owned Job did not confirm its state in time. Its cleanup ownership is retained.')); }, OPERATION_TIMEOUT);
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
    attach: async (pid, original) => {
      if (attached || !Number.isSafeInteger(pid) || pid <= 0 || !original || !/^\d{1,19}$/.test(original.creation) || BigInt(original.creation) <= 0n || !Number.isSafeInteger(original.parent) || original.parent <= 0) {
        const error = new Error('One positive captured native identity is required before Job assignment.'); readyReject(error); throw error;
      }
      attached = true;
      try {
        await listening; const result = await request('attach', { pid, creation: original.creation });
        if (result.ok !== true) throw new Error('Job assignment or startup peer verification failed. No project execution was released.');
        readyResolve();
      } catch (error) { readyReject(error instanceof Error ? error : new Error('Job assignment failed.')); throw error; }
    },
    authorize: async (launch, validate) => {
      if (!options.gate || authorized) throw new Error('The startup handoff is single-use.');
      authorized = true; await ready;
      if (typeof launch.executable !== 'string' || !launch.executable || !Array.isArray(launch.args) || launch.args.some(arg => typeof arg !== 'string') || !launch.env || typeof launch.env !== 'object') throw new Error('A main-approved launch is required.');
      if (launch.kind !== undefined && launch.kind !== 'task') throw new Error('The approved launch kind is invalid.');
      // The originating main-owned scope must still hold after readiness.
      validate?.();
      const result = await request('go', { launch });
      if (result.ok !== true || !Number.isSafeInteger(result.pid) || (result.pid as number) <= 0) throw new Error('The approved shell did not confirm a positive owned process. Its Job is retained for cleanup.');
      return result.pid as number;
    },
    queryEmpty: async () => {
      await ready; const result = await request('query');
      if (result.ok !== true || typeof result.empty !== 'boolean') throw new Error('The owned Job state is unverified.');
      return result.empty;
    },
    stop: () => {
      if (complete) return Promise.resolve(); if (stopping) return stopping;
      const operation = (async () => {
        await listening.catch(() => undefined);
        if (!closed) {
          const result = await request('stop');
          if (result.ok !== true || result.empty !== true) throw new Error('The owned Job did not confirm all its processes exited. Retry Stop.');
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
    closed = true; closeResolve(); fail('The private startup pipe configuration is invalid.'); return job;
  }
  try {
    // Fixed argv contains no bearer, launch command, environment or project.
    // Sensitive setup and GO use only the owned process's stdin transport.
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('The Windows system installation path is unavailable.');
    const helperExecutable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    child = spawn(helperExecutable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(windowsJobSource(), 'utf16le').toString('base64')], { windowsHide: true, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { closed = true; closeResolve(); fail('The owned Job helper could not start.'); return job; }
  const startupTimer = setTimeout(() => fail('The owned Job helper did not become ready in time. Cleanup ownership is retained.'), OPERATION_TIMEOUT);
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
      if (message.type === 'listening') { clearTimeout(startupTimer); listenResolve(); }
      else if (message.type === 'result' && Number.isSafeInteger(message.id)) {
        if (stopRequests.has(message.id as number) && message.ok === true && message.empty === true) zeroConfirmed = true;
        const item = pending.get(message.id as number); if (!item) continue;
        clearTimeout(item.timer); pending.delete(message.id as number); item.resolve(message);
      } else fail('The owned Job helper returned unknown state evidence.');
    }
  });
  child.stderr.on('data', () => undefined);
  child.once('error', () => fail('The owned Job helper failed. No cleanup completion was proven.'));
  child.once('close', code => { clearTimeout(startupTimer); closed = true; closeCode = code; closeResolve(); if (!zeroConfirmed || code !== 0) fail('The owned Job helper closed without verified cleanup.'); });
  child.stdin.write(JSON.stringify({ gate: options.gate || null }) + '\n');
  return job;
}

export function createWorkspaceWindowsJob(pid: number, original: WorkspacePtyIdentity, options: { env?: NodeJS.ProcessEnv } = {}): WorkspaceWindowsJob {
  const job = createPendingWorkspaceWindowsJob(options);
  void job.attach(pid, original).catch(() => undefined);
  return job;
}

function windowsJobSource(): string {
  return `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Diagnostics; using System.Threading; using System.IO; using System.IO.Pipes; using System.Text; using Microsoft.Win32.SafeHandles;
public static class OwnedWindowsJob {
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long PerProcess,PerJob; public uint Flags; public UIntPtr MinWorking,MaxWorking; public uint ActiveLimit; public UIntPtr Affinity; public uint Priority,Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User,Kernel,PeriodUser,PeriodKernel; public uint Faults,Total,Active,Terminated; }
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimit info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out Accounting info,uint length,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern SafePipeHandle CreateNamedPipe(string name,uint access,uint mode,uint instances,uint output,uint input,uint timeout,IntPtr security);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static IntPtr job=IntPtr.Zero,root=IntPtr.Zero; static int rootPid; static NamedPipeServerStream pipe;
 static StreamReader reader; static StreamWriter writer;
 public static void Create() { job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Exception("create"); var limits=new ExtendedLimit(); limits.Basic.Flags=0x2000; if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))) throw new Exception("limits"); }
 public static void Listen(string name) { var handle=CreateNamedPipe(@"\\\\.\\pipe\\"+name,0x40080003,8,1,4096,4096,0,IntPtr.Zero); if(handle.IsInvalid) { handle.Dispose(); throw new Exception("pipe"); } pipe=new NamedPipeServerStream(PipeDirection.InOut,true,false,handle); }
 static void RequireRoot() { bool member; if(root==IntPtr.Zero||WaitForSingleObject(root,0)!=258||!IsProcessInJob(root,job,out member)||!member) throw new Exception("root"); }
 public static void Attach(int pid,long expected,string capability) { root=OpenProcess(0x101101,false,pid); if(root==IntPtr.Zero) throw new Exception("open"); long born,exited,kernel,user; if(!GetProcessTimes(root,out born,out exited,out kernel,out user) || DateTime.FromFileTimeUtc(born).Ticks/10!=expected/10 || WaitForSingleObject(root,0)!=258) throw new Exception("identity"); if(!AssignProcessToJobObject(job,root)) throw new Exception("assign"); rootPid=pid; RequireRoot(); if(pipe!=null) { var connection=pipe.BeginWaitForConnection(null,null); if(!connection.AsyncWaitHandle.WaitOne(3500)) throw new Exception("peer-timeout"); pipe.EndWaitForConnection(connection); connection.AsyncWaitHandle.Close(); uint peer; if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)||peer!=(uint)pid) throw new Exception("peer"); reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true); writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true); writer.AutoFlush=true; var hello=ReadPeerLine(); if(hello!=capability) throw new Exception("capability"); RequireRoot(); } else { CloseHandle(root); root=IntPtr.Zero; } }
 static string ReadPeerLine() { var result=reader.ReadLineAsync(); if(!result.Wait(3500)) throw new Exception("peer-read-timeout"); string value=result.Result; if(value==null||value.Length>4096) throw new Exception("peer-input"); return value; }
 static Accounting Account() { Accounting info; if(job==IntPtr.Zero||!QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Exception("query"); return info; }
 public static string Go(string launch) { RequireRoot(); uint peer; if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)||peer!=(uint)rootPid) throw new Exception("peer"); if(Account().Total!=1) throw new Exception("baseline"); writer.WriteLine(launch); return ReadPeerLine(); }
 // 0 positively absent; 1 same Job member; -1 unknown/live nonmember.
 public static int VerifyChild(int pid) { IntPtr child=OpenProcess(0x1000,false,pid); if(child==IntPtr.Zero) { int error=Marshal.GetLastWin32Error(); return error==87||error==1168?0:-1; } try { bool member; return IsProcessInJob(child,job,out member)&&member?1:-1; } finally { CloseHandle(child); } }
 public static string ReadCompletion() { RequireRoot(); return ReadPeerLine(); }
 public static bool CompletedTarget() { RequireRoot(); return Account().Total>=2; }
 public static void Accept() { RequireRoot(); writer.WriteLine("accepted"); }
 public static void ReleaseGate() { if(pipe!=null) { pipe.Dispose();pipe=null; } if(root!=IntPtr.Zero) { CloseHandle(root);root=IntPtr.Zero; } }
 public static bool Empty() { return Account().Active==0; }
 public static bool Stop() { if(root!=IntPtr.Zero) { CloseHandle(root);root=IntPtr.Zero; } if(!Empty() && !TerminateJobObject(job,1)) { if(!Empty()) return false; } var elapsed=Stopwatch.StartNew(); while(!Empty()&&elapsed.ElapsedMilliseconds<1200) Thread.Sleep(20); return Empty(); }
 public static void Close() { if(pipe!=null) pipe.Dispose(); if(root!=IntPtr.Zero) { CloseHandle(root);root=IntPtr.Zero; } if(job!=IntPtr.Zero) { CloseHandle(job);job=IntPtr.Zero; } }
}
'@
function Emit($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
 $initial=ConvertFrom-Json -InputObject ([Console]::In.ReadLine())
 [OwnedWindowsJob]::Create()
 if($initial.gate) { [OwnedWindowsJob]::Listen([string]$initial.gate.pipeName) }
 Emit @{type='listening'}
 $attached=$false; $authorized=$false
 while($true) {
  $line=[Console]::In.ReadLine(); if($null -eq $line) { if([OwnedWindowsJob]::Stop()) { exit 0 }; exit 1 }
  if($line.Length -gt 131072) { throw 'input' }; $request=ConvertFrom-Json -InputObject $line
  if($request.id -isnot [int] -or $request.id -le 0) { throw 'request' }
  try {
   if($request.operation -eq 'attach' -and !$attached) { $attached=$true; [OwnedWindowsJob]::Attach([int]$request.pid,[long]$request.creation,[string]$initial.gate.capability); Emit @{type='result';id=$request.id;ok=$true} }
   elseif($request.operation -eq 'go' -and $attached -and $initial.gate -and !$authorized) {
    $authorized=$true; $ack=ConvertFrom-Json -InputObject ([OwnedWindowsJob]::Go(($request.launch | ConvertTo-Json -Compress -Depth 5)))
    if($ack.type -ne 'spawn' -or $ack.pid -isnot [int] -or $ack.pid -le 0) { throw 'child' }
    $member=[OwnedWindowsJob]::VerifyChild($ack.pid)
    if($member -eq 0 -and $request.launch.kind -eq 'task') {
     $done=ConvertFrom-Json -InputObject ([OwnedWindowsJob]::ReadCompletion())
     if($done.type -ne 'completed' -or $done.pid -ne $ack.pid -or $done.exitCode -isnot [int] -or ![OwnedWindowsJob]::CompletedTarget()) { throw 'completion' }
    } elseif($member -ne 1) { throw 'membership' }
    [OwnedWindowsJob]::Accept(); [OwnedWindowsJob]::ReleaseGate(); Emit @{type='result';id=$request.id;ok=$true;pid=$ack.pid}
   }
   elseif($request.operation -eq 'query' -and $attached) { Emit @{type='result';id=$request.id;ok=$true;empty=[OwnedWindowsJob]::Empty()} }
   elseif($request.operation -eq 'stop') { $empty=[OwnedWindowsJob]::Stop(); Emit @{type='result';id=$request.id;ok=$true;empty=$empty}; if($empty) { exit 0 } }
   else { throw 'operation' }
  } catch { Emit @{type='result';id=$request.id;ok=$false} }
 }
} finally { [OwnedWindowsJob]::Close() }
`;
}
