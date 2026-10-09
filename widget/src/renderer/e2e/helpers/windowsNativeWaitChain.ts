import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const WAIT_CHAIN_BUDGET_MS = 4000;
export const WAIT_CHAIN_MAX_THREADS = 128;
export const WAIT_CHAIN_MAX_NODES = 16;
export const WAIT_CHAIN_MAX_BYTES = 64 * 1024;
export interface CapturedNativeIdentity { pid: number; creation: string }
export interface NativeWaitChainReceipt {
  status: 'complete' | 'partial' | 'refused' | 'unavailable';
  pid: number; creation: string; artifact: string;
  durationMs: number; identityVerified?: boolean; stillAlive?: boolean;
  heldCreation?: string;
  totalThreadCount?: number; truncatedThreads?: boolean; truncatedOutput?: boolean;
  threads: unknown[]; error?: string;
  scope: 'read-only-wait-chain-and-thread-metadata';
}

/** SDK wct.h defines a 280-byte WAITCHAIN_NODE_INFO (8-byte aligned union).
 * Raw offsets avoid marshalling an overlapping WCHAR[128]/thread union.
 * No object names/memory, debugger attachment, suspension or termination.
 * https://learn.microsoft.com/en-us/windows/win32/api/wct/nf-wct-getthreadwaitchain
 * https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/wct.h
 */
export function nativeWaitChainCSharpSource(): string {
  return `using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
public static class HomeBotWaitChain {
  const int NodeBytes=280, MaxNodes=16, MaxThreads=128;
  [StructLayout(LayoutKind.Sequential)] public struct Time { public uint Low,High; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out Time birth,out Time exit,out Time kernel,out Time user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenThread(uint rights,bool inherit,uint tid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessIdOfThread(IntPtr h);
  [DllImport("advapi32.dll",SetLastError=true)] static extern IntPtr OpenThreadWaitChainSession(uint flags,IntPtr callback);
  [DllImport("advapi32.dll")] static extern void CloseThreadWaitChainSession(IntPtr session);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetThreadWaitChain(IntPtr session,UIntPtr context,uint flags,uint tid,ref uint count,IntPtr nodes,out bool cycle);
  public class Sample { public int Id; public string State,Reason,Error; }
  static List<Sample> ReadThreads(uint pid,out int total) {
    var samples=new List<Sample>();
    using(var process=Process.GetProcessById((int)pid)) {
      var threads=process.Threads; total=threads.Count;
      for(int i=0;i<Math.Min(total,MaxThreads);i++) {
        using(var thread=threads[i]) {
          var sample=new Sample();
          try { sample.Id=thread.Id; sample.State=thread.ThreadState.ToString();
            if(thread.ThreadState==System.Diagnostics.ThreadState.Wait) sample.Reason=thread.WaitReason.ToString(); }
          catch(Exception e) { sample.Error=e.GetType().Name; }
          samples.Add(sample);
        }
      }
    }
    return samples;
  }
  static Dictionary<string,object> Row() { return new Dictionary<string,object>(); }
  static string Birth(IntPtr handle) {
    Time birth,exit,kernel,user;
    if(!GetProcessTimes(handle,out birth,out exit,out kernel,out user)) throw new Exception("GetProcessTimes:"+Marshal.GetLastWin32Error());
    long value=(long)(((ulong)birth.High<<32)|birth.Low);
    return DateTime.FromFileTimeUtc(value).Ticks.ToString(CultureInfo.InvariantCulture);
  }
  // The original observer captures CIM creation at microsecond precision and
  // verifies its held native StartTime by the same /10 tick comparison.
  static bool SameBirth(string actual,string expected) { return Int64.Parse(actual,CultureInfo.InvariantCulture)/10==Int64.Parse(expected,CultureInfo.InvariantCulture)/10; }
  public static Dictionary<string,object> Collect(uint pid,string expected) {
    var result=Row(); var rows=new List<object>();
    result["pid"]=pid; result["creation"]=expected; result["status"]="refused"; result["threads"]=rows;
    result["identityVerified"]=false; result["stillAlive"]=false;
    IntPtr process=IntPtr.Zero,session=IntPtr.Zero,nodes=IntPtr.Zero;
    var elapsed=Stopwatch.StartNew();
    try {
      // Query-limited + SYNCHRONIZE only; never PROCESS_TERMINATE/VM_READ.
      process=OpenProcess(0x101000,false,pid);
      if(process==IntPtr.Zero) throw new Exception("OpenProcess:"+Marshal.GetLastWin32Error());
      string heldBirth=Birth(process);result["heldCreation"]=heldBirth;
      if(!SameBirth(heldBirth,expected)) throw new Exception("Captured process creation mismatch");
      result["identityVerified"]=true;
      if(WaitForSingleObject(process,0)!=258) throw new Exception("Captured process is not confirmed alive");
      result["stillAlive"]=true;
      int total; var samples=ReadThreads(pid,out total);
      result["totalThreadCount"]=total; result["truncatedThreads"]=total>MaxThreads;
      bool complete=total>0 && total<=MaxThreads;
      session=OpenThreadWaitChainSession(0,IntPtr.Zero);
      if(session==IntPtr.Zero) throw new Exception("OpenThreadWaitChainSession:"+Marshal.GetLastWin32Error());
      nodes=Marshal.AllocHGlobal(NodeBytes*MaxNodes);
      foreach(var sample in samples) {
        if(elapsed.ElapsedMilliseconds>2700) { complete=false; result["error"]="Collection time bound"; break; }
        var row=Row(); row["threadId"]=sample.Id; row["state"]=sample.State; row["waitReason"]=sample.Reason;
        var chain=new List<object>(); row["nodes"]=chain; rows.Add(row);
        IntPtr thread=IntPtr.Zero;
        try {
          if(sample.Id<=0 || sample.Error!=null) throw new Exception(sample.Error??"Unknown thread identity");
          thread=OpenThread(0x800,false,(uint)sample.Id);
          if(thread==IntPtr.Zero) throw new Exception("OpenThread:"+Marshal.GetLastWin32Error());
          if(GetProcessIdOfThread(thread)!=pid) throw new Exception("Thread owner mismatch");
          if(WaitForSingleObject(process,0)!=258) throw new Exception("Captured process exited during collection");
          uint count=MaxNodes; bool cycle;
          bool ok=GetThreadWaitChain(session,UIntPtr.Zero,1,(uint)sample.Id,ref count,nodes,out cycle);
          int error=ok?0:Marshal.GetLastWin32Error();
          row["wctError"]=error; row["reportedNodeCount"]=count;
          // ERROR_MORE_DATA still returns a valid bounded prefix (Microsoft docs).
          if(ok || error==234) {
            row["cycleObserved"]=cycle;
            for(int n=0;n<(int)Math.Min(count,(uint)MaxNodes);n++) {
              var node=Row(); IntPtr p=IntPtr.Add(nodes,n*NodeBytes);
              int type=Marshal.ReadInt32(p,0),status=Marshal.ReadInt32(p,4);
              node["objectType"]=type; node["objectStatus"]=status;
              if(type==8) { node["processId"]=(uint)Marshal.ReadInt32(p,8); node["threadId"]=(uint)Marshal.ReadInt32(p,12); node["waitTime"]=(uint)Marshal.ReadInt32(p,16); node["contextSwitches"]=(uint)Marshal.ReadInt32(p,20); }
              if(type<1 || type>12 || type==10 || status<1 || status>10 || status==1 || status==4 || status==5 || status==9 || status==10) complete=false;
              chain.Add(node);
            }
          }
          if(!ok || count==0 || count>MaxNodes) complete=false;
        } catch(Exception e) { row["error"]=e.Message; complete=false; }
        finally { if(thread!=IntPtr.Zero) CloseHandle(thread); }
      }
      // Keep the same held process handle throughout; no late PID recapture.
      if(!SameBirth(Birth(process),expected) || WaitForSingleObject(process,0)!=258) { result["stillAlive"]=false; throw new Exception("Captured process is no longer confirmed alive"); }
      result["status"]=complete?"complete":"partial";
    } catch(Exception e) { result["status"]="refused"; result["error"]=e.Message; }
    finally { if(nodes!=IntPtr.Zero) Marshal.FreeHGlobal(nodes); if(session!=IntPtr.Zero) CloseThreadWaitChainSession(session); if(process!=IntPtr.Zero) CloseHandle(process); }
    return result;
  }
}`;
}

export function windowsNativeWaitChainSource(pid: number, creation: string): string {
  if (!validIdentity(pid, creation)) throw new Error('Positive captured native identity required.');
  return `$ErrorActionPreference='Stop';$WarningPreference='SilentlyContinue';
Add-Type -TypeDefinition @'
${nativeWaitChainCSharpSource()}
'@;
$report=[HomeBotWaitChain]::Collect([uint32]${pid},'${creation}');
$json=ConvertTo-Json -InputObject $report -Depth 8 -Compress;
while([Text.Encoding]::UTF8.GetByteCount($json) -gt 61440 -and $report['threads'].Count -gt 0){
  $report['threads'].RemoveAt($report['threads'].Count-1);if($report['status'] -ne 'refused'){$report['status']='partial'};$report['truncatedOutput']=$true;
  $json=ConvertTo-Json -InputObject $report -Depth 8 -Compress;
}
[Console]::Out.WriteLine('WCT:'+ $json);[Console]::Out.Flush();`;
}
function validIdentity(pid: number, creation: string): boolean {
  return Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647 && typeof creation === 'string' && /^\d{1,19}$/.test(creation) && BigInt(creation) > 0n && BigInt(creation) <= 3155378975999999999n;
}

/** Caller supplies the private proof directory after its ORIGINAL close failure.
 * Collection never evaluates Electron or changes that outcome. A killed helper,
 * unsupported API, exited/reused PID or unreadable thread is diagnostic failure.
 */
export async function collectWindowsNativeWaitChain(identity: CapturedNativeIdentity, artifactDirectory: string): Promise<NativeWaitChainReceipt> {
  const started = Date.now();
  const receipt: NativeWaitChainReceipt = { status: 'refused', pid: identity.pid, creation: identity.creation,
    artifact: '', durationMs: 0, threads: [], scope: 'read-only-wait-chain-and-thread-metadata' };
  if (!validIdentity(identity.pid, identity.creation)) {
    receipt.error = 'A positive captured native identity is required.'; return receipt;
  }
  if (process.platform !== 'win32') { receipt.status = 'unavailable'; receipt.error = 'Windows wait-chain metadata is unavailable on this platform.'; return receipt; }
  if (!path.isAbsolute(artifactDirectory)) { receipt.error = 'An absolute private artifact directory is required.'; return receipt; }
  const token = `wait-chain-${identity.pid}-${started}-${randomUUID()}`;
  const directory = path.resolve(artifactDirectory, token), privateHome = path.join(directory, 'home');
  const temporary = path.join(privateHome, 'Temp'), roaming = path.join(privateHome, 'AppData', 'Roaming'), local = path.join(privateHome, 'AppData', 'Local');
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) { receipt.error = 'Fixed system PowerShell path is unavailable.'; return receipt; }
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  receipt.artifact = path.join(directory, 'receipt.json');
  try {
    for (const name of [temporary, roaming, local]) fs.mkdirSync(name, { recursive: true });
    const source = windowsNativeWaitChainSource(identity.pid, identity.creation);
    fs.writeFileSync(path.join(directory, 'source.ps1'), source, 'utf8');
    const env = { ...process.env, HOME: privateHome, USERPROFILE: privateHome, APPDATA: roaming, LOCALAPPDATA: local,
      TEMP: temporary, TMP: temporary, TMPDIR: temporary, PSModuleAnalysisCachePath: path.join(temporary, 'module-analysis') };
    const result = await new Promise<{ error: Error | null; stdout: string }>(resolve => {
      execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
        { env, cwd: privateHome, windowsHide: true, timeout: WAIT_CHAIN_BUDGET_MS, maxBuffer: WAIT_CHAIN_MAX_BYTES },
        (error, stdout) => resolve({ error, stdout: String(stdout) }));
    });
    if (Buffer.byteLength(result.stdout, 'utf8') > WAIT_CHAIN_MAX_BYTES) throw new Error('Wait-chain output exceeded 64KiB.');
    const output = result.stdout.split(/\r?\n/).filter(line => line.startsWith('WCT:'));
    if (output.length !== 1) throw result.error || new Error('Expected one bounded wait-chain metadata receipt.');
    const data = JSON.parse(output[0].slice(4));
    if (data.pid !== identity.pid || data.creation !== identity.creation || !['complete', 'partial', 'refused'].includes(data.status) ||
      !Array.isArray(data.threads) || data.threads.length > WAIT_CHAIN_MAX_THREADS || data.threads.some((row: any) => !row || !Array.isArray(row.nodes) || row.nodes.length > WAIT_CHAIN_MAX_NODES) ||
      (data.identityVerified === true && (!validIdentity(identity.pid, data.heldCreation) || BigInt(data.heldCreation) / 10n !== BigInt(identity.creation) / 10n)) ||
      (data.status === 'complete' && (data.identityVerified !== true || data.stillAlive !== true || data.truncatedThreads || data.truncatedOutput || !Number.isInteger(data.totalThreadCount) || data.totalThreadCount < 1 || data.totalThreadCount !== data.threads.length ||
        data.threads.some((row: any) => row.error || row.wctError !== 0 || row.reportedNodeCount !== row.nodes.length || row.nodes.length < 1 || row.nodes.some((node: any) => !node ||
          !Number.isInteger(node.objectType) || node.objectType < 1 || node.objectType > 12 || node.objectType === 10 ||
          !Number.isInteger(node.objectStatus) || node.objectStatus < 1 || node.objectStatus > 10 || [1, 4, 5, 9, 10].includes(node.objectStatus)))))) {
      throw new Error('Invalid or unqualified wait-chain metadata receipt.');
    }
    for (const key of ['status', 'identityVerified', 'stillAlive', 'heldCreation', 'totalThreadCount', 'truncatedThreads', 'truncatedOutput', 'threads', 'error'] as const) {
      if (key in data) (receipt as any)[key] = data[key];
    }
    if (result.error) {
      if (receipt.status !== 'refused') receipt.status = 'partial';
      receipt.error = `${receipt.error ? `${receipt.error}; ` : ''}Collector failed: ${result.error.message.slice(0, 512)}`;
    }
  } catch (error) { receipt.status = 'refused'; receipt.error = String(error).slice(0, 512); }
  receipt.durationMs = Date.now() - started;
  try { fs.writeFileSync(receipt.artifact, JSON.stringify(receipt, null, 2), 'utf8'); }
  catch (error) { receipt.status = 'refused'; receipt.error = `Artifact persistence failed: ${String(error).slice(0, 384)}`; }
  return receipt;
}
