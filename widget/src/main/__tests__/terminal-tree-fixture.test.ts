import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Script } from 'vm';
import type { Page, TestInfo } from '@playwright/test';
import { terminalTreeSources, validateTerminalSources, terminalDiagnosticText, recordTerminalFailure, settleTerminalCleanup } from '../../renderer/e2e/helpers/terminalTreeFixture';

jest.setTimeout(15_000);

test('parses all exact cooked terminal fixtures including Windows paths and Unicode', () => {
  const sources = terminalTreeSources('C:\\private home\\一é\\project');
  expect(Object.keys(sources)).toEqual(['stdin.cjs', 'interrupt.cjs', 'grandchild.cjs', 'intermediate.cjs', 'late-root.cjs']);
  expect(() => validateTerminalSources(sources)).not.toThrow();
});

test('rejects an invalid cooked newline with its generated filename before launching anything', () => {
  const sources = { 'stdin.cjs': "require('fs').writeFileSync('marker', 'ran\n');" };
  expect(() => validateTerminalSources(sources)).toThrow('Invalid or unexpected token');
  try { validateTerminalSources(sources); } catch (error) { expect((error as Error).stack).toContain('stdin.cjs'); }
});

test('the exact stdin source records real TTY/resize/input fields with only native dependencies controlled', () => {
  const writes = new Map<string, string>();
  let data: ((chunk: Buffer) => void) | undefined, interval: (() => void) | undefined;
  let columns = 80, exit: number | undefined;
  const native = {
    writeFileSync: (file: string, text: string) => writes.set(file, text),
    renameSync: (from: string, to: string) => { writes.set(to, writes.get(from)!); writes.delete(from); },
  };
  const project = path.join('private', 'project');
  new Script(terminalTreeSources(project)['stdin.cjs']).runInNewContext({
    require: (name: string) => { expect(name).toBe('fs'); return native; },
    process: { pid: 17, stdin: { isTTY: true, once: (event: string, callback: typeof data) => { expect(event).toBe('data'); data = callback; } },
      stdout: { isTTY: true, getWindowSize: () => [columns, 25] }, exit: (code: number) => { exit = code; } },
    console: { log: () => {} }, setInterval: (callback: () => void) => { interval = callback; return 1; }, clearInterval: () => {},
  });
  const marker = path.join(project, 'tty.json');
  expect(JSON.parse(writes.get(marker)!)).toEqual({ pid: 17, stdin: true, stdout: true, columns: 80 });
  columns = 120; interval!(); data!(Buffer.from('NATIVE_STDIN\r\n'));
  expect(JSON.parse(writes.get(marker)!)).toEqual({ pid: 17, stdin: true, stdout: true, columns: 120, input: 'NATIVE_STDIN' });
  expect(exit).toBe(0);
});

test('cooked background fixtures detach both child levels and retain parent identities; original unref-only structure does not', () => {
  const sources = terminalTreeSources(path.join('private', 'project'));
  const run = (source: string) => {
    const spawned: Array<{ executable: string; args: string[]; options: { detached?: boolean; stdio: string } }> = [];
    const callbacks = new Map<string, (...args: unknown[]) => void>(), writes = new Map<string, string>();
    new Script(source).runInNewContext({
      require: (name: string) => name === 'child_process' ? {
        spawn: (executable: string, args: string[], options: { detached?: boolean; stdio: string }) => {
          spawned.push({ executable, args, options });
          return { pid: 31, once: (event: string, callback: (...args: unknown[]) => void) => { callbacks.set(event, callback); }, unref: () => {} };
        },
      } : { writeFileSync: (file: string, text: string) => writes.set(file, text) },
      process: { pid: 29, execPath: 'fixed-node', exit: () => {} }, setTimeout: (callback: () => void) => callback(),
    });
    callbacks.get('spawn')?.(); callbacks.get('exit')?.(0);
    return { spawned, writes };
  };
  for (const name of ['intermediate.cjs', 'late-root.cjs'] as const) {
    const fixed = run(sources[name]);
    expect(fixed.spawned).toHaveLength(1);
    expect(fixed.spawned[0].options).toEqual({ detached: true, stdio: 'ignore' });
    const original = run(sources[name].replace('{detached:true,stdio:', '{stdio:'));
    expect(original.spawned[0].options.detached).toBeUndefined();
  }
  const root = run(sources['late-root.cjs']);
  expect(JSON.parse(root.writes.get(path.join('private', 'project', 'background-root.json'))!)).toEqual({ pid: 29, child: 31 });
  expect(root.writes.get(path.join('private', 'project', 'intermediate-exited.txt'))).toBe('0');
});

test('diagnostics retain useful errors but exclude command argv, environment and capabilities', () => {
  const secret = 'a'.repeat(64);
  const output = terminalDiagnosticText(`\"C:\\node.exe\" \"C:\\private\\stdin.cjs\"\nenv={secret}\n{\"env\":{\"value\":\"private-secret\"}}\ncapability=${secret}\nTypeError: getWindowSize is unavailable\ntoken=private-secret\n${secret}`);
  expect(output).toContain('TypeError: getWindowSize is unavailable');
  expect(output).not.toMatch(/stdin\.cjs|node\.exe|private-secret|capability=|env=/);
  expect(output).not.toContain(secret);
  expect(terminalDiagnosticText('x'.repeat(9000))).toHaveLength(4096);
});

test('failure-only capture whitelists live session fields and keeps list errors visible', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-terminal-diag-'));
  try {
    const secret = 'b'.repeat(64);
    const page = {
      evaluate: async () => ({ ui: { alerts: ['terminal exited'], tabs: ['cmd — exited'], xterm: ['TTY_READY'] },
        result: { success: true, sessions: [{ profileId: 'cmd', pid: 12, shellPid: 13, exited: true, exitCode: 1,
          closeError: 'terminal exited', output: `TTY_READY\ncapability=${secret}`, env: { secret }, argv: [secret] }] } }),
      screenshot: async () => Buffer.from('controlled screenshot'), locator: (selector: string) => selector,
    } as unknown as Page;
    const info = { outputPath: (name: string) => path.join(directory, name) } as TestInfo;
    await recordTerminalFailure(page, directory, info);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'terminal-failure.json'), 'utf8'));
    expect(receipt.failureOnly).toBe(true); expect(receipt.canvasMasked).toBe(true);
    expect(receipt.list.sessions[0]).toEqual({ profileId: 'cmd', pid: 12, shellPid: 13, exited: true, exitCode: 1, closeError: 'terminal exited', output: 'TTY_READY' });
    expect(JSON.stringify(receipt)).not.toContain(secret);
    (page as unknown as { evaluate: () => Promise<unknown> }).evaluate = async () => { throw new Error('readonly list unavailable'); };
    await recordTerminalFailure(page, directory, info);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'terminal-failure.json'), 'utf8')).diagnosticError).toContain('readonly list unavailable');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cleanup preserves the exact primary failure and cleanup-only refusal still fails', async () => {
  const primary = new Error('TTY marker absent'), refusal = new Error('native exit unconfirmed');
  const failedRun = async () => {
    try { throw primary; } finally {
      await settleTerminalCleanup([Promise.reject(refusal), Promise.resolve()], true, errors => {
        expect(errors).toEqual([refusal]); throw new Error('artifact unavailable');
      });
    }
  };
  await expect(failedRun()).rejects.toBe(primary);
  await expect(settleTerminalCleanup([Promise.reject(refusal)], false, () => {})).rejects.toBe(refusal);
  await expect(settleTerminalCleanup([Promise.resolve()], false, () => {})).resolves.toBeUndefined();
});
