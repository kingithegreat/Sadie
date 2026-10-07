import type { ChildProcess } from 'child_process';
import * as path from 'path';
import { createPendingWorkspaceWindowsJob } from '../workspace-windows-job';

// Spy on the real CommonJS export used by the production module; no OS call is mocked.
const childProcess = require('child_process') as typeof import('child_process');
const live = process.platform === 'win32' && process.env.HOMEBOT_LIVE_TASK_TREE === '1';

(live ? describe : describe.skip)('actual Windows pending Job helper', () => {
  test('Stop before any bootstrap attachment confirms an empty Job and the same owned helper closes normally', async () => {
    const actualSpawn = childProcess.spawn;
    let held: ChildProcess | undefined;
    let closeCode: number | null | undefined, closeSignal: NodeJS.Signals | null | undefined;
    const phases: string[] = [];
    let buffered = '';
    const spy = jest.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof childProcess.spawn>) => {
      const child = Reflect.apply(actualSpawn, childProcess, args) as ChildProcess;
      held = child;
      child.once('close', (code, signal) => { closeCode = code; closeSignal = signal; });
      child.stdout!.on('data', (data: Buffer) => {
        buffered += data.toString();
        for (;;) {
          const newline = buffered.indexOf('\n'); if (newline < 0) break;
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          try { const value = JSON.parse(line); if (value.type === 'phase' && typeof value.phase === 'string') phases.push(value.phase); }
          catch { /* The production reader, not this passive observation, owns validity. */ }
        }
      });
      return child;
    }) as typeof childProcess.spawn);
    const job = createPendingWorkspaceWindowsJob();
    try {
      // Stop is requested before listening, without attaching or executing any target.
      await job.stop();
      expect(held!.pid).toBeGreaterThan(0);
      expect(closeCode).toBe(0); expect(closeSignal).toBeNull();
      expect(held!.exitCode).toBe(0); expect(held!.signalCode).toBeNull();
      expect(phases).toEqual(expect.arrayContaining(['compile', 'create', 'command', 'stop']));
      expect(phases).not.toContain('attach'); expect(phases).not.toContain('go');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
      await job.stop(); expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      try { await job.stop(); }
      finally { spy.mockRestore(); }
    }
  }, 15_000);
});
