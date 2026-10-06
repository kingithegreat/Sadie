import { execFile } from 'child_process';
import type { WorkspacePtyIdentity } from './workspace-pty-identity';

/** Kill only OS handles whose creation time matches the captured owned tree. */
export function forceStopWorkspacePty(pid: number, original: WorkspacePtyIdentity | null | undefined): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !original || !/^\d+$/.test(original.creation)) return Promise.resolve(false);
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
 public static IntPtr OpenChecked(int pid,long expected) {
  IntPtr h=OpenProcess(0x101001,false,pid); if(h==IntPtr.Zero) return IntPtr.Zero;
  long created,exited,kernel,user;
  if(!GetProcessTimes(h,out created,out exited,out kernel,out user) || DateTime.FromFileTimeUtc(created).Ticks/10!=expected/10) { CloseHandle(h); return IntPtr.Zero; }
  return h;
 }
 public static bool Stop(IntPtr h) { return WaitForSingleObject(h,0)==0 || (TerminateProcess(h,1) && WaitForSingleObject(h,1200)==0); }
}
'@
$taskHandles=New-Object 'System.Collections.Generic.List[IntPtr]'
try {
 $taskRoot=[OwnedPtyStop]::OpenChecked(${pid},[long]${original.creation})
 if($taskRoot -eq [IntPtr]::Zero) { [Console]::Write('uncertain'); exit 0 }
 $taskHandles.Add($taskRoot)
 $taskAll=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 $taskRootRecord=$taskAll | Where-Object { $_.ProcessId -eq ${pid} -and $_.CreationDate.ToUniversalTime().Ticks -eq [long]${original.creation} -and $_.ParentProcessId -eq ${original.parent} }
 if(!$taskRootRecord) { [Console]::Write('uncertain'); exit 0 }
 $taskOwned=@($taskRootRecord)
 for($taskLevel=0;$taskLevel -lt $taskOwned.Count;$taskLevel++) {
  $taskParent=$taskOwned[$taskLevel]
  $taskChildren=@($taskAll | Where-Object { $_.ParentProcessId -eq $taskParent.ProcessId -and $_.CreationDate -ge $taskParent.CreationDate -and $_.ProcessId -notin $taskOwned.ProcessId })
  $taskOwned+= $taskChildren
  if($taskOwned.Count -gt 128) { [Console]::Write('uncertain'); exit 0 }
 }
 foreach($taskChild in ($taskOwned | Select-Object -Skip 1)) {
  $taskHandle=[OwnedPtyStop]::OpenChecked([int]$taskChild.ProcessId,$taskChild.CreationDate.ToUniversalTime().Ticks)
  if($taskHandle -eq [IntPtr]::Zero) { [Console]::Write('uncertain'); exit 0 }
  $taskHandles.Add($taskHandle)
 }
 $taskStopped=$true
 for($taskIndex=$taskHandles.Count-1;$taskIndex -ge 0;$taskIndex--) { if(![OwnedPtyStop]::Stop($taskHandles[$taskIndex])) { $taskStopped=$false } }
 if($taskStopped) { [Console]::Write('stopped') } else { [Console]::Write('uncertain') }
} finally { foreach($taskHandle in $taskHandles) { [OwnedPtyStop]::CloseHandle($taskHandle) | Out-Null } }
`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, timeout: 4500, maxBuffer: 4096 }, (error, output) => resolve(!error && String(output).trim() === 'stopped'));
  });
}
