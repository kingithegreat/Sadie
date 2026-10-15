import { execFile } from 'child_process';

export interface WorkspacePtyIdentity { creation: string; parent: number }
/** Passive fixed metadata only; it never changes process ownership or readiness. */
export interface WorkspacePtyIdentityDiagnostic {
  status: 'invalid-pid' | 'missing' | 'observed' | 'malformed' | 'query-error' | 'foreign-parent' | 'unsupported';
  elapsedMs: number;
  errorCode?: 'ENOENT' | 'EACCES' | 'EPERM' | 'ETIMEDOUT' | 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' | 'unknown';
  exitCode?: number;
  signal?: 'SIGTERM' | 'SIGKILL' | 'unknown';
  killed?: boolean;
}
type ObserveIdentity = (diagnostic: WorkspacePtyIdentityDiagnostic) => void;
function observeSafely(observer: ObserveIdentity | undefined, diagnostic: WorkspacePtyIdentityDiagnostic): void {
  try { observer?.(diagnostic); } catch { /* Diagnostics cannot change the original query outcome. */ }
}
/** A missing process is null; an unavailable query remains unknown. */
export function queryWorkspacePtyIdentity(pid: number, observer?: ObserveIdentity): Promise<WorkspacePtyIdentity | null | undefined> {
  const started = Date.now();
  const report = (status: WorkspacePtyIdentityDiagnostic['status'], fields: Partial<WorkspacePtyIdentityDiagnostic> = {}) => observeSafely(observer, {
    status, elapsedMs: Math.min(60_000, Math.max(0, Date.now() - started)), ...fields,
  });
  if (!Number.isSafeInteger(pid) || pid <= 0) { report('invalid-pid'); return Promise.resolve(undefined); }
  const source = `& { $taskProcess = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop; if ($taskProcess) { [Console]::Write(($taskProcess.CreationDate.ToUniversalTime().Ticks.ToString() + ':' + $taskProcess.ParentProcessId)) } else { [Console]::Write('missing') } }`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', source], { windowsHide: true, timeout: 1800, maxBuffer: 1024 }, (error, output) => {
      if (error) {
        const allowed = ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'];
        const fields: Partial<WorkspacePtyIdentityDiagnostic> = {
          errorCode: typeof error.code === 'string' && allowed.includes(error.code) ? error.code as WorkspacePtyIdentityDiagnostic['errorCode'] : 'unknown',
          ...(typeof error.code === 'number' && Number.isSafeInteger(error.code) ? { exitCode: error.code } : {}),
          ...(typeof error.killed === 'boolean' ? { killed: error.killed } : {}),
          ...(error.signal ? { signal: error.signal === 'SIGTERM' || error.signal === 'SIGKILL' ? error.signal : 'unknown' } : {}),
        };
        report('query-error', fields); resolve(undefined); return;
      }
      const text = String(output).trim();
      if (text === 'missing') { report('missing'); resolve(null); return; }
      const parsed = /^(\d+):(\d+)$/.exec(text);
      report(parsed ? 'observed' : 'malformed');
      resolve(parsed ? { creation: parsed[1], parent: Number(parsed[2]) } : undefined);
    });
  });
}
export interface WorkspacePtyLifecycle {
  capture(pid: number, observer?: ObserveIdentity): Promise<WorkspacePtyIdentity | null | undefined>;
  stopped(pid: number, original: WorkspacePtyIdentity | null | undefined): Promise<boolean>;
}
export const workspacePtyLifecycle: WorkspacePtyLifecycle = {
  capture: async (pid, observer) => {
    if (process.platform !== 'win32') { observeSafely(observer, { status: 'unsupported', elapsedMs: 0 }); return null; }
    let diagnostic: WorkspacePtyIdentityDiagnostic | undefined;
    const identity = await queryWorkspacePtyIdentity(pid, value => { diagnostic = value; });
    if (diagnostic) observeSafely(observer, identity && identity.parent !== process.pid ? { ...diagnostic, status: 'foreign-parent' } : diagnostic);
    return identity && identity.parent !== process.pid ? undefined : identity;
  },
  stopped: async (pid, original) => {
    if (process.platform !== 'win32') return true;
    const current = await queryWorkspacePtyIdentity(pid);
    return current === null || (!!original && !!current && current.creation !== original.creation);
  },
};
