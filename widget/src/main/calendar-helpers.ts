import { execFile, type ChildProcess, type ExecFileOptions } from 'child_process';

type Executor = (file: string, args: string[], options: ExecFileOptions, callback: (error: Error | null, stdout: string, stderr: string) => void) => ChildProcess;
interface Helper {
  child: ChildProcess;
  closed: boolean;
  close: Promise<void>;
  cancel(reason: string): void;
  stop?: Promise<void>;
}

/** Own the PowerShell handle only; Outlook and other COM servers are user processes. */
export class CalendarHelperManager {
  private helpers = new Set<Helper>();
  private stopping?: Promise<void>;
  private admissionClosed = false;
  constructor(private readonly execute: Executor = execFile as Executor, private readonly executionTimeout = 15_000, private readonly stopTimeout = 3000) {}

  run(script: string, signal?: AbortSignal): Promise<{ stdout: string }> {
    if (this.admissionClosed) return Promise.reject(new Error('Calendar helpers are stopped while HomeBot closes.'));
    if (signal?.aborted) return Promise.reject(new Error('Calendar helper cancelled.'));
    if (this.helpers.size >= 4) return Promise.reject(new Error('Too many calendar helpers are still running.'));
    return new Promise((resolve, reject) => {
      let finished = false, timer: NodeJS.Timeout | undefined;
      let helper: Helper;
      const settle = (error?: Error, stdout = '') => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve({ stdout });
      };
      const cancel = (reason: string) => {
        settle(new Error(reason));
        // Failure remains owned in the set; quit will Retry this same handle.
        void this.stopOne(helper).catch(() => {});
      };
      const abort = () => cancel('Calendar helper cancelled.');
      let child: ChildProcess;
      try {
        child = this.execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
          // Do not log the script, Outlook data, command arguments or stderr.
          settle(error ? new Error('Calendar PowerShell execution failed.') : undefined, String(stdout));
        });
      } catch { settle(new Error('Calendar PowerShell could not start.')); return; }
      let closed!: () => void;
      helper = { child, closed: false, close: new Promise<void>(resolveClose => { closed = resolveClose; }), cancel: reason => settle(new Error(reason)) };
      this.helpers.add(helper);
      const release = () => {
        if (helper.closed) return;
        helper.closed = true;
        this.helpers.delete(helper);
        closed();
      };
      child.once('close', release);
      child.once('error', () => { if (!child.pid) release(); });
      timer = setTimeout(() => cancel('Calendar helper timed out.'), this.executionTimeout);
      timer.unref?.();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  private stopOne(helper: Helper): Promise<void> {
    if (helper.closed) return Promise.resolve();
    if (helper.stop) return helper.stop;
    helper.stop = (async () => {
      // ChildProcess.kill targets the held native process, never a looked-up PID.
      try { helper.child.kill('SIGTERM'); } catch { /* still require close below */ }
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([helper.close, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('An owned calendar helper did not confirm exit. Retry closing HomeBot.')), this.stopTimeout);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    })().finally(() => { helper.stop = undefined; });
    return helper.stop;
  }

  stopAll(): Promise<void> {
    this.admissionClosed = true;
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      const owned = [...this.helpers];
      for (const helper of owned) helper.cancel('Calendar helper stopped because HomeBot is closing.');
      const results = await Promise.allSettled(owned.map(helper => this.stopOne(helper)));
      if (results.some(result => result.status === 'rejected')) throw new Error('An owned calendar helper did not confirm exit. Retry closing HomeBot.');
    })().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }

  resume(): void { this.admissionClosed = false; }
}

const calendarHelpers = new CalendarHelperManager();
export const runCalendarPowerShell = (script: string, signal?: AbortSignal): Promise<{ stdout: string }> => calendarHelpers.run(script, signal);
export const stopCalendarHelpers = (): Promise<void> => calendarHelpers.stopAll();
/** Called by the quit barrier only when another cleanup refuses native quit. */
export const resumeCalendarHelpers = (): void => calendarHelpers.resume();
