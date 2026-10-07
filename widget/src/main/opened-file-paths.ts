/** Query the objects already opened by main; never reopen caller paths. */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export const OPENED_PATH_QUERY_MS = 5000;
const MAX_QUERY_BYTES = 192 * 1024;
export const supportsOpenedFilePaths = (platform: string = process.platform) => platform === 'win32' || platform === 'linux';

/** Public Node stdio numeric FDs are duplicated into Windows standard HANDLEs.
 * GetFinalPathNameByHandleW resolves the actual object, including reparse points.
 * No ReadFile/CreateFile, request text, project imports or target execution.
 * https://nodejs.org/api/child_process.html#optionsstdio
 * https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew
 */
export function openedFileQuerySource(): string {
  return String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$PSModuleAutoloadingPreference='None'
try {
  Import-Module ([System.IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
  $framework=[System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
  Microsoft.PowerShell.Utility\Add-Type -ReferencedAssemblies @([System.IO.Path]::Combine($framework,'System.dll')) -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class HomeBotOpenedFiles {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int kind);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder result,uint length,uint flags);
 static string Query(int kind) {
  IntPtr handle=GetStdHandle(kind);
  if(handle==IntPtr.Zero || handle==new IntPtr(-1)) throw new Exception("handle");
  var result=new StringBuilder(32768);
  uint length=GetFinalPathNameByHandleW(handle,result,32768,0);
  if(length==0 || length>=32768) throw new Exception("path");
  return Convert.ToBase64String(Encoding.UTF8.GetBytes(result.ToString()));
 }
 public static void Emit() {
  string first=Query(-10),second=Query(-11);
  Console.Error.Write("HBI_OPENED_1\n"+first+"\n"+second+"\n");
 }
}
'@ -ErrorAction Stop
  [HomeBotOpenedFiles]::Emit()
  exit 0
} catch { [Console]::Error.Write("HBI_OPENED_FAILED\n"); exit 1 }
`;
}

export function parseOpenedFilePaths(output: Buffer): [string, string] {
  if (output.length > MAX_QUERY_BYTES || output.some(byte => byte > 127)) throw new Error('Opened-file verification returned invalid metadata.');
  const lines = output.toString('ascii').split('\n');
  if (lines.length !== 4 || lines[0] !== 'HBI_OPENED_1' || lines[3] !== '') throw new Error('Opened-file verification failed.');
  const paths = lines.slice(1, 3).map(encoded => {
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Opened-file verification returned invalid metadata.');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw new Error('Opened-file verification returned invalid metadata.');
    let target = bytes.toString('utf8');
    if (!Buffer.from(target, 'utf8').equals(bytes) || target.includes('\0') || target.length > 32767) throw new Error('Opened-file verification returned invalid metadata.');
    if (target.startsWith('\\\\?\\UNC\\')) target = '\\\\' + target.slice(8);
    else if (/^\\\\\?\\[a-zA-Z]:\\/.test(target)) target = target.slice(4);
    if (!(/^[a-zA-Z]:\\/.test(target) || /^\\\\[^\\]+\\[^\\]+\\/.test(target)) || target.startsWith('\\\\?\\') || target.startsWith('\\\\.\\')) throw new Error('Opened-file verification returned an unsupported namespace.');
    return path.win32.normalize(target);
  });
  return paths as [string, string];
}

export async function queryOpenedFilePaths(fds: readonly number[]): Promise<[string, string]> {
  if (fds.length !== 2 || fds.some(fd => !Number.isSafeInteger(fd) || fd < 0)) throw new Error('Two owned file descriptors are required.');
  if (process.platform === 'linux') {
    // procfs resolves each exact held descriptor, not the caller's replaceable
    // path. Missing procfs is a refusal, never a path-based fallback.
    return await Promise.all(fds.map(fd => fs.promises.realpath(`/proc/self/fd/${fd}`))) as [string, string];
  }
  if (process.platform !== 'win32') throw new Error('Secure IDE file comparison is unavailable on this platform. Compare pasted excerpts with diff_text.');
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('The fixed Windows file-verification helper is unavailable.');
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let privateRoot: string;
  try {
    // Main-owned canonical userData, never the request root or caller env.
    const profile = fs.realpathSync(app.getPath('userData'));
    const identity = fs.statSync(profile, { bigint: true });
    if (!identity.isDirectory()) throw new Error();
    privateRoot = path.join(profile, 'ide-file-verification');
    try {
      const existing = fs.lstatSync(privateRoot);
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // No recursive mkdir: an existing/racing last-component junction gets
      // EEXIST rather than having its target accepted or created through.
      fs.mkdirSync(privateRoot);
    }
    const current = fs.statSync(profile, { bigint: true });
    if (fs.realpathSync(profile) !== profile || current.dev !== identity.dev || current.ino !== identity.ino || current.birthtimeNs !== identity.birthtimeNs || fs.lstatSync(privateRoot).isSymbolicLink() || fs.realpathSync(privateRoot) !== privateRoot) throw new Error();
  } catch { throw new Error('The fixed opened-file verification private directory is unavailable or redirected.'); }
  const env: NodeJS.ProcessEnv = { SystemRoot: systemRoot, WINDIR: systemRoot, HOME: privateRoot, USERPROFILE: privateRoot, APPDATA: privateRoot, LOCALAPPDATA: privateRoot, TEMP: privateRoot, TMP: privateRoot, TMPDIR: privateRoot };
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(openedFileQuerySource(), 'utf16le').toString('base64')], { windowsHide: true, cwd: privateRoot, env, stdio: [fds[0], fds[1], 'pipe'] });
    } catch { reject(new Error('The fixed opened-file verification helper could not start.')); return; }
    let output = Buffer.alloc(0), failure: Error | undefined;
    const fail = (message: string) => { failure ||= new Error(message); try { child.kill(); } catch { /* close remains the ownership oracle */ } };
    // Keep the caller's FDs held until this exact helper closes; a timeout
    // never permits descriptor reuse underneath an outstanding query.
    // Timeout latches refusal and requests termination. The promise and caller
    // FD ownership remain pending until close; kill is not exit confirmation.
    const timer = setTimeout(() => fail('Opened-file verification timed out. Closure is unconfirmed until the owned helper closes. No file content was returned.'), OPENED_PATH_QUERY_MS);
    child.once('error', () => { failure ||= new Error('Opened-file verification could not run.'); });
    if (!child.stderr) fail('Opened-file verification has no metadata channel.');
    child.stderr?.on('error', () => fail('Opened-file verification metadata failed.'));
    child.stderr?.on('data', (chunk: Buffer) => {
      if (failure) return;
      if (output.length + chunk.length > MAX_QUERY_BYTES) { fail('Opened-file verification exceeded its metadata budget.'); return; }
      output = Buffer.concat([output, chunk]);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || code !== 0 || signal !== null) { reject(failure || new Error('Opened-file verification failed.')); return; }
      try { resolve(parseOpenedFilePaths(output)); } catch (error) { reject(error); }
    });
  });
}
