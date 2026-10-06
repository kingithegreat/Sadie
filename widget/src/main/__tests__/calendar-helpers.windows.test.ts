import { execFile, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CalendarHelperManager } from '../calendar-helpers';

const windowsTest = process.platform === 'win32' ? test : test.skip;
function within<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned calendar positive-control deadline exceeded')), timeout); })]).finally(() => clearTimeout(timer));
}
async function markerReady(file: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!fs.existsSync(file) && Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned positive-control helper exited before its start marker');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!fs.existsSync(file)) throw new Error('Owned helper start marker missing');
}
function closed(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => { child.once('close', () => resolve()); child.once('error', reject); });
}

windowsTest('real calendar Stop awaits its sleeping PowerShell close and preserves a separate owned process', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-owned-'));
  const temporary = path.join(directory, 'Temp'), roaming = path.join(directory, 'AppData', 'Roaming'), local = path.join(directory, 'AppData', 'Local');
  for (const target of [temporary, roaming, local]) fs.mkdirSync(target, { recursive: true });
  const env = { ...process.env, HOME: directory, USERPROFILE: directory, TEMP: temporary, TMP: temporary, TMPDIR: temporary, APPDATA: roaming, LOCALAPPDATA: local };
  const marker = path.join(temporary, 'calendar-ready'), otherMarker = path.join(temporary, 'other-ready');
  const sleep = (file: string) => `[IO.File]::WriteAllText('${file.replace(/'/g, "''")}', 'ready'); Start-Sleep -Seconds 60`;
  let owned: ChildProcess | undefined, unrelated: ChildProcess | undefined;
  let ownedExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let unrelatedExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const manager = new CalendarHelperManager((file, args, options, callback) => {
    owned = execFile(file, args, { ...options, env, encoding: 'utf8' }, callback);
    owned.once('exit', (code, signal) => { ownedExit = { code, signal }; });
    return owned;
  });
  let run: Promise<{ error?: Error; value?: { stdout: string } }> | undefined;
  try {
    unrelated = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(sleep(otherMarker), 'utf16le').toString('base64')], { env, windowsHide: true }, () => {});
    unrelated.once('exit', (code, signal) => { unrelatedExit = { code, signal }; });
    run = manager.run(sleep(marker)).then(value => ({ value }), error => ({ error }));
    await Promise.all([markerReady(marker, owned!), markerReady(otherMarker, unrelated)]);
    expect(owned!.pid).not.toBe(unrelated.pid);
    expect(owned!.exitCode).toBeNull(); expect(unrelated.exitCode).toBeNull();
    const ownedClosed = closed(owned!);
    await within(manager.stopAll(), 4000);
    await ownedClosed;
    expect((await run).error?.message).toContain('HomeBot is closing');
    expect(ownedExit).toBeDefined();
    expect(owned!.exitCode !== null || owned!.signalCode !== null).toBe(true);
    expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull();
  } finally {
    // Only these directly owned native handles are eligible for failure cleanup.
    const cleanup = [owned, unrelated].filter((child): child is ChildProcess => !!child).map(async child => {
      if (child.exitCode === null && child.signalCode === null) { const exit = closed(child); child.kill('SIGTERM'); await within(exit, 4000); }
    });
    const results = await Promise.allSettled(cleanup);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (run) await within(run, 3000);
    if (unrelated) expect(unrelatedExit).toBeDefined();
    console.log('[CALENDAR-OWNED-PROOF]', JSON.stringify({ ownedPid: owned?.pid, ownedExit, unrelatedPid: unrelated?.pid, unrelatedExit }));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
