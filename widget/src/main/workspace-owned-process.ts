import { spawn, type ChildProcess } from 'child_process';
const identities = new WeakMap<ChildProcess, Promise<string | null>>();
function windowsCreation(child: ChildProcess): Promise<string | null> {
  if (!child.pid || child.exitCode !== null) return Promise.resolve(null);
  const pid = child.pid;
  const source = `& { $taskProcess = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($taskProcess -and $taskProcess.ParentProcessId -eq ${process.pid}) { [Console]::Write($taskProcess.CreationDate.ToUniversalTime().Ticks) } }`;
  return new Promise(resolve => {
    const query = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', source], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; let settled = false;
    const finish = (value: string | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { query.kill(); finish(null); }, 1500);
    query.stdout!.on('data', chunk => { output = (output + chunk).slice(-100); });
    query.once('error', () => finish(null)); query.once('close', () => finish(child.exitCode === null && /^\d+$/.test(output.trim()) ? output.trim() : null));
  });
}
/** Record the native creation identity while this exact ChildProcess is alive. */
export function rememberWorkspaceChild(child: ChildProcess): void {
  if (process.platform === 'win32') identities.set(child, windowsCreation(child));
}
function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => { const timer = setTimeout(() => { child.removeListener('close', closed); resolve(false); }, timeoutMs); const closed = () => { clearTimeout(timer); resolve(true); }; child.once('close', closed); });
}
/** Bound every helper, revalidate Windows PID creation, then prove owned exit. */
export async function stopWorkspaceChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = waitForClose(child, 5500);
  if (process.platform === 'win32') {
    const original = await identities.get(child);
    const current = original ? await windowsCreation(child) : null;
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (original && current === original) {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { killer.kill(); child.kill(); finish(); }, 2500);
        killer.once('close', finish); killer.once('error', () => { child.kill(); finish(); });
      });
    } else {
      // The native owner could not be verified. ChildProcess.kill uses this
      // owned process handle, rather than risking taskkill against a reused PID.
      child.kill();
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  if (await closed) return;
  child.kill();
  if (!await waitForClose(child, 1000)) throw new Error('The owned program did not confirm exit. Try Stop again before closing HomeBot.');
}
