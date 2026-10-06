import { execFile } from 'child_process';
import type { WorkspacePtyIdentity } from './workspace-pty-identity';

export interface WorkspacePtyCapturedIdentity extends WorkspacePtyIdentity { pid: number }
export type WorkspacePtyStopReceipt = WorkspacePtyCapturedIdentity[];
export interface WorkspacePtyStopResult { stopped: boolean; attempted: boolean; receipt?: WorkspacePtyStopReceipt }

function validReceipt(value: unknown): value is WorkspacePtyStopReceipt {
  if (!Array.isArray(value) || !value.length || value.length > 128) return false;
  const pids = new Set<number>();
  for (const entry of value) {
    if (!entry || !Number.isSafeInteger(entry.pid) || entry.pid <= 0 || pids.has(entry.pid) || !/^\d{1,19}$/.test(entry.creation) || !Number.isSafeInteger(entry.parent) || entry.parent <= 0) return false;
    pids.add(entry.pid);
  }
  return true;
}

/** Persist the captured identities before effects; retries touch only that set. */
export function stopWorkspacePtyTree(pid: number, original: WorkspacePtyIdentity | null | undefined, receipt?: WorkspacePtyStopReceipt, env?: NodeJS.ProcessEnv): Promise<WorkspacePtyStopResult> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !original || !/^\d{1,19}$/.test(original.creation) || !Number.isSafeInteger(original.parent) || original.parent <= 0 || (receipt && (!validReceipt(receipt) || receipt[0].pid !== pid || receipt[0].creation !== original.creation || receipt[0].parent !== original.parent))) return Promise.resolve({ stopped: false, attempted: false });
  const captured = receipt ? Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64') : undefined;
  const source = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class OwnedPtyStop {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint code);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
 // 0: captured identity is gone/replaced; 1: held matching handle; -1: unknown.
 public static int OpenIdentity(int pid,long expected,out IntPtr h) {
  h=OpenProcess(0x101001,false,pid); if(h==IntPtr.Zero) { int error=Marshal.GetLastWin32Error(); return error==87 || error==1168 ? 0 : -1; }
  long created,exited,kernel,user;
  if(!GetProcessTimes(h,out created,out exited,out kernel,out user)) { CloseHandle(h); h=IntPtr.Zero; return -1; }
  if(DateTime.FromFileTimeUtc(created).Ticks/10!=expected/10 || WaitForSingleObject(h,0)==0) { CloseHandle(h); h=IntPtr.Zero; return 0; }
  return 1;
 }
 public static bool Stop(IntPtr h) { return WaitForSingleObject(h,0)==0 || (TerminateProcess(h,1) && WaitForSingleObject(h,1200)==0); }
}
'@
$taskHandles=New-Object 'System.Collections.Generic.List[IntPtr]'
try {
 ${captured ? `$taskReceipt=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${captured}')))` : `
 $taskRoot=[IntPtr]::Zero
 $taskRootStatus=[OwnedPtyStop]::OpenIdentity(${pid},[long]${original.creation},[ref]$taskRoot)
 if($taskRootStatus -ne 1) { [Console]::WriteLine('uncertain'); exit 0 }
 $taskHandles.Add($taskRoot)
 $taskAll=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 $taskRootRecord=$taskAll | Where-Object { $_.ProcessId -eq ${pid} -and $_.CreationDate.ToUniversalTime().Ticks -eq [long]${original.creation} -and $_.ParentProcessId -eq ${original.parent} }
 if(!$taskRootRecord) { [Console]::WriteLine('uncertain'); exit 0 }
 $taskOwned=@($taskRootRecord)
 for($taskLevel=0;$taskLevel -lt $taskOwned.Count;$taskLevel++) {
  $taskParent=$taskOwned[$taskLevel]
  $taskChildren=@($taskAll | Where-Object { $_.ParentProcessId -eq $taskParent.ProcessId -and $_.CreationDate -ge $taskParent.CreationDate -and $_.ProcessId -notin $taskOwned.ProcessId })
  $taskOwned+= $taskChildren
  if($taskOwned.Count -gt 128) { [Console]::WriteLine('uncertain'); exit 0 }
 }
 $taskReceipt=@($taskOwned | ForEach-Object { @{pid=[int]$_.ProcessId;creation=[string]$_.CreationDate.ToUniversalTime().Ticks;parent=[int]$_.ParentProcessId} })
 `}
 # Flush receipt before any TerminateProcess; timeout stdout keeps this evidence.
 [Console]::WriteLine('receipt:'+(ConvertTo-Json -InputObject @($taskReceipt) -Compress -Depth 4)); [Console]::Out.Flush()
 foreach($taskChild in $taskReceipt) {
  ${captured ? '' : `if([int]$taskChild.pid -eq ${pid}) { continue }`}
  $taskHandle=[IntPtr]::Zero
  $taskState=[OwnedPtyStop]::OpenIdentity([int]$taskChild.pid,[long]$taskChild.creation,[ref]$taskHandle)
  if($taskState -lt 0) { [Console]::WriteLine('uncertain'); exit 0 }
  if($taskState -eq 1) { $taskHandles.Add($taskHandle) }
 }
 [Console]::WriteLine('attempted'); [Console]::Out.Flush()
 $taskStopped=$true
 for($taskIndex=$taskHandles.Count-1;$taskIndex -ge 0;$taskIndex--) { if(![OwnedPtyStop]::Stop($taskHandles[$taskIndex])) { $taskStopped=$false } }
 if($taskStopped) { [Console]::WriteLine('stopped') } else { [Console]::WriteLine('uncertain') }
} finally { foreach($taskHandle in $taskHandles) { [OwnedPtyStop]::CloseHandle($taskHandle) | Out-Null } }
`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, timeout: 4500, maxBuffer: 64 * 1024, ...(env ? { env } : {}) }, (error, output) => {
      const lines = String(output).split(/\r?\n/).map(line => line.trim());
      let capturedReceipt = receipt;
      try { const line = lines.find(value => value.startsWith('receipt:')); if (line) { const value: unknown = JSON.parse(line.slice(8)); if (validReceipt(value) && value[0].pid === pid && value[0].creation === original.creation && value[0].parent === original.parent) capturedReceipt = value; } } catch { /* Unknown partial output stays fail closed. */ }
      resolve({ stopped: !error && !!capturedReceipt && lines.includes('stopped'), attempted: lines.includes('attempted'), ...(capturedReceipt ? { receipt: capturedReceipt } : {}) });
    });
  });
}

/** Compatibility for native probes; managers use receipts for recoverable Close. */
export async function forceStopWorkspacePty(pid: number, original: WorkspacePtyIdentity | null | undefined): Promise<boolean> { return (await stopWorkspacePtyTree(pid, original)).stopped; }
