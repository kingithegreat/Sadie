import { EventEmitter } from 'events';
import type { ChildProcess, ExecFileOptions } from 'child_process';
import { CalendarHelperManager } from '../calendar-helpers';

function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: 731, kill: jest.fn(() => true) }) as unknown as ChildProcess;
  let callback!: (error: Error | null, stdout: string, stderr: string) => void;
  const execute = jest.fn((_file: string, _args: string[], _options: ExecFileOptions, done: (error: Error | null, stdout: string, stderr: string) => void) => { callback = done; return child; });
  const manager = new CalendarHelperManager(execute, 15_000, 3000);
  const close = (error: Error | null = null, stdout = '') => { callback(error, stdout, ''); child.emit('close', error ? 1 : 0); };
  return { child, execute, manager, close };
}
afterEach(() => jest.useRealTimers());

test('direct hidden PowerShell argv preserves script bytes and normal close releases ownership', async () => {
  const f = fixture(); const script = '$ol = New-Object -ComObject Outlook.Application; "quoted $value"';
  const run = f.manager.run(script);
  expect(f.execute).toHaveBeenCalledWith('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], expect.objectContaining({ windowsHide: true, maxBuffer: 1024 * 1024 }), expect.any(Function));
  f.close(null, '[{"id":"ok"}]'); await expect(run).resolves.toEqual({ stdout: '[{"id":"ok"}]' });
  await f.manager.stopAll(); expect(f.child.kill).not.toHaveBeenCalled();
});

test('shutdown cancellation rejects the caller but awaits actual close rather than kill return', async () => {
  const f = fixture(); const run = expect(f.manager.run('Outlook.Application')).rejects.toThrow('HomeBot is closing');
  const stop = f.manager.stopAll(); let stopped = false; void stop.then(() => { stopped = true; });
  await run; await Promise.resolve(); expect(stopped).toBe(false);
  expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
  expect(f.manager.stopAll()).toBe(stop);
  f.close(); await stop; expect(stopped).toBe(true);
  await expect(f.manager.run('late Outlook.Application')).rejects.toThrow('while HomeBot closes');
  expect(f.execute).toHaveBeenCalledTimes(1);
  f.manager.resume(); const next = f.manager.run('next'); f.close(null, 'next'); await expect(next).resolves.toEqual({ stdout: 'next' });
});

test('unconfirmed shutdown rejects and Retry retains the same native child handle', async () => {
  jest.useFakeTimers(); const f = fixture(); const run = expect(f.manager.run('hang')).rejects.toThrow('HomeBot is closing');
  const failed = expect(f.manager.stopAll()).rejects.toThrow('did not confirm exit');
  await jest.advanceTimersByTimeAsync(3000); await failed; await run;
  const retry = f.manager.stopAll(); expect(f.child.kill).toHaveBeenCalledTimes(2);
  f.close(); await retry; expect(f.execute).toHaveBeenCalledTimes(1);
});

test('execution timeout cancels the operation while retaining an unconfirmed helper for quit', async () => {
  jest.useFakeTimers(); const f = fixture(); const expired = expect(f.manager.run('hang')).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(18_000); await expired;
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  const stopped = f.manager.stopAll(); f.close(); await stopped;
  expect(f.child.kill).toHaveBeenCalledTimes(2);
});

test('abort has no authority over other processes and close proves only this owned helper', async () => {
  const f = fixture(); const aborted = new AbortController(); aborted.abort();
  await expect(f.manager.run('never', aborted.signal)).rejects.toThrow('cancelled'); expect(f.execute).not.toHaveBeenCalled();
  const signal = new AbortController(); const run = expect(f.manager.run('hang', signal.signal)).rejects.toThrow('cancelled');
  signal.abort(); await run; expect(f.child.kill).toHaveBeenCalledTimes(1);
  const stopped = f.manager.stopAll(); f.close(); await stopped;
  expect(f.child.kill).toHaveBeenCalledTimes(1);
});

test('execution errors omit command arguments, stderr and calendar data', async () => {
  const f = fixture(); const run = expect(f.manager.run('private appointment')).rejects.toThrow(/^Calendar PowerShell execution failed\.$/);
  f.close(new Error('Command failed with secret appointment data')); await run;
  await f.manager.stopAll(); expect(f.child.kill).not.toHaveBeenCalled();
});
