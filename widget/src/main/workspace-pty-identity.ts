import { execFile } from 'child_process';

export interface WorkspacePtyIdentity { creation: string; parent: number }
/** A missing process is null; an unavailable query remains unknown. */
export function queryWorkspacePtyIdentity(pid: number): Promise<WorkspacePtyIdentity | null | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(undefined);
  const source = `& { $taskProcess = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop; if ($taskProcess) { [Console]::Write(($taskProcess.CreationDate.ToUniversalTime().Ticks.ToString() + ':' + $taskProcess.ParentProcessId)) } else { [Console]::Write('missing') } }`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', source], { windowsHide: true, timeout: 1800, maxBuffer: 1024 }, (error, output) => {
      if (error) { resolve(undefined); return; }
      const text = String(output).trim();
      if (text === 'missing') { resolve(null); return; }
      const parsed = /^(\d+):(\d+)$/.exec(text);
      resolve(parsed ? { creation: parsed[1], parent: Number(parsed[2]) } : undefined);
    });
  });
}
export interface WorkspacePtyLifecycle {
  capture(pid: number): Promise<WorkspacePtyIdentity | null | undefined>;
  stopped(pid: number, original: WorkspacePtyIdentity | null | undefined): Promise<boolean>;
}
export const workspacePtyLifecycle: WorkspacePtyLifecycle = {
  capture: async pid => {
    if (process.platform !== 'win32') return null;
    const identity = await queryWorkspacePtyIdentity(pid);
    return identity && identity.parent !== process.pid ? undefined : identity;
  },
  stopped: async (pid, original) => {
    if (process.platform !== 'win32') return true;
    const current = await queryWorkspacePtyIdentity(pid);
    return current === null || (!!original && !!current && current.creation !== original.creation);
  },
};
