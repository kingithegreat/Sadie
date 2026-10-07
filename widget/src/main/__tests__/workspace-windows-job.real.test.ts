import type { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createPendingWorkspaceWindowsJob } from '../workspace-windows-job';
import { createWorkspaceProcessGate } from '../workspace-process-gate';

// Spy on the real CommonJS export used by the production module; no OS call is mocked.
const childProcess = require('child_process') as typeof import('child_process');
const live = process.platform === 'win32' && process.env.HOMEBOT_LIVE_TASK_TREE === '1';

(live ? describe : describe.skip)('actual Windows pending Job helper', () => {
  async function probe(sdkGate: boolean) {
    const home = sdkGate ? fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-sdk-job-')) : undefined;
    if (home) for (const dir of ['tmp', 'AppData/Local', 'AppData/Roaming']) fs.mkdirSync(path.join(home, dir), { recursive: true });
    const coreEnv = home ? { ...getDefaultEnvironment(), SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT,
      USERPROFILE: home, HOME: home, TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'),
      APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local') } : undefined;
    const gate = coreEnv ? createWorkspaceProcessGate(coreEnv) : undefined;
    const started = Date.now(), observations: Array<{ event: string; elapsedMs: number; phase?: string }> = [];
    let listening: { ok: boolean; elapsedMs: number; error?: string } | undefined;
    const actualSpawn = childProcess.spawn;
    let held: ChildProcess | undefined;
    let closeCode: number | null | undefined, closeSignal: NodeJS.Signals | null | undefined;
    const phases: string[] = [];
    let buffered = '';
    const spy = jest.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof childProcess.spawn>) => {
      const child = Reflect.apply(actualSpawn, childProcess, args) as ChildProcess;
      held = child;
      observations.push({ event: 'spawn-returned', elapsedMs: Date.now() - started });
      child.once('close', (code, signal) => { closeCode = code; closeSignal = signal; observations.push({ event: 'close', elapsedMs: Date.now() - started }); });
      child.stdout!.on('data', (data: Buffer) => {
        buffered += data.toString();
        for (;;) {
          const newline = buffered.indexOf('\n'); if (newline < 0) break;
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          try { const value = JSON.parse(line); if (value.type === 'phase' && ['entry', 'encoding', 'compile', 'create', 'listen', 'command', 'stop'].includes(value.phase)) {
            phases.push(value.phase); observations.push({ event: 'phase', phase: value.phase, elapsedMs: Date.now() - started });
          } }
          catch { /* The production reader, not this passive observation, owns validity. */ }
        }
      });
      return child;
    }) as typeof childProcess.spawn);
    const job = createPendingWorkspaceWindowsJob(gate ? { env: gate.env, gate: { pipeName: gate.pipeName, capability: gate.capability } } : {});
    void job.listening.then(() => { listening = { ok: true, elapsedMs: Date.now() - started }; }, error => { listening = { ok: false, elapsedMs: Date.now() - started, error: String(error) }; });
    let originalFailure: unknown;
    try {
      // Stop is requested before listening, without attaching or executing any target.
      const stopping = job.stop(); void stopping.catch(() => {});
      // The SDK-shaped case additionally qualifies the ORIGINAL listener deadline.
      // The plain early-Stop case records a rejected listener honestly without masking it.
      if (sdkGate) await job.listening;
      await stopping;
      expect(held!.pid).toBeGreaterThan(0);
      expect(closeCode).toBe(0); expect(closeSignal).toBeNull();
      expect(held!.exitCode).toBe(0); expect(held!.signalCode).toBeNull();
      expect(phases).toEqual(expect.arrayContaining(['compile', 'create', 'command', 'stop']));
      expect(phases).not.toContain('attach'); expect(phases).not.toContain('go');
      if (sdkGate) { expect(listening!.ok).toBe(true); expect(phases).toContain('listen'); }
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
      await job.stop(); expect(spy).toHaveBeenCalledTimes(1);
    } catch (error) { originalFailure = error; throw error; }
    finally {
      try { await job.stop(); }
      catch (error) {
        if (!originalFailure) throw error;
        // Keep the first real startup/Stop failure as the test oracle.
        console.error('Pending Job cleanup retry also refused:', String(error));
      }
      finally {
        spy.mockRestore();
        const directory = path.resolve(process.cwd(), '..', 'artifacts', 'ide-native-zero-retry');
        const receipt = { scenario: sdkGate ? 'sdk-safe-private-profile-with-gate' : 'full-environment-without-gate', pid: held?.pid,
          home, listening, closeCode, closeSignal, elapsedMs: Date.now() - started, observations: observations.slice(0, 40), failure: originalFailure ? String(originalFailure) : undefined,
          scope: 'Same held ChildProcess helper; no bootstrap/target, no attach/GO, original operation deadlines. Timing is diagnostic only.' };
        try { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, `pending-job-observation-${sdkGate ? 'sdk-gate' : 'plain'}.json`), JSON.stringify(receipt, null, 2), { flag: 'wx' }); }
        catch (error) { if (!originalFailure) throw error; console.error('Pending Job diagnostic receipt failed:', String(error)); }
      }
    }
  }
  test('Stop before any bootstrap attachment confirms an empty Job and the same owned helper closes normally', () => probe(false), 15_000);
  test('SDK-safe environment with a private profile and gate meets the original listener deadline before confirmed empty Stop', () => probe(true), 15_000);
});
