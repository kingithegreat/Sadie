import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Script } from 'vm';
import * as ts from 'typescript';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { terminalTreeSources, validateTerminalSources, terminalDiagnosticText, recordTerminalFailure, settleTerminalCleanup,
  chooseTerminalViewportBounds, terminalViewportResizeApplied, captureTerminalViewport, normalizeTerminalWindow, resizeTerminalWindow, type TerminalViewportGeometry } from '../../renderer/e2e/helpers/terminalTreeFixture';

jest.setTimeout(15_000);

function ciGeometry(): TerminalViewportGeometry {
  return { windowId: 7, bounds: { x: 0, y: 0, width: 1024, height: 720 }, contentBounds: { x: 0, y: 0, width: 1024, height: 720 },
    workArea: { x: 0, y: 0, width: 1024, height: 720 }, minimumSize: [320, 400], isMaximized: false, isFullScreen: false,
    viewport: { width: 1024, height: 720 }, terminalWidth: 692 };
}

test('the actual window clamp restores the old oversized request on a 1024 display; the measured target remains inside its work area', () => {
  const before = ciGeometry(); let bounds = { ...before.bounds };
  const callbacks = new Map<string, () => void>(); let timer: (() => void) | undefined, delay: number | undefined;
  const window = { getBounds: () => bounds, isDestroyed: () => false, isMinimized: () => false, isMaximized: () => false, isFullScreen: () => false,
    setBounds: (value: typeof bounds) => { bounds = { ...value }; }, on: (event: string, callback: () => void) => callbacks.set(event, callback) };
  const file = path.resolve(__dirname, '../window-manager.ts');
  const parsed = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const actualClamp = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'keepWindowOnScreen');
  if (!actualClamp) throw new Error('The actual production clamp is missing.');
  const source = ts.transpileModule(actualClamp.getText(parsed) + '\nkeepWindowOnScreen(window);', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Script(source).runInNewContext({ window, screen: { getDisplayMatching: () => ({ workArea: before.workArea }) },
    setTimeout: (callback: () => void, milliseconds: number) => { timer = callback; delay = milliseconds; return 1; }, clearTimeout: () => {}, safeCatch: (error: unknown) => { throw error; } });
  bounds = { ...bounds, width: 1750, height: 1050 }; callbacks.get('resize')!(); expect(delay).toBe(220); timer!();
  expect(bounds).toEqual(before.bounds);
  expect(terminalViewportResizeApplied(before, { ...before.bounds, width: 1750, height: 1050 }, before)).toBe(false);
  const requested = chooseTerminalViewportBounds(before);
  expect(requested.width).toBeGreaterThanOrEqual(before.minimumSize[0]); expect(requested.width).toBeLessThan(before.bounds.width);
  bounds = requested; callbacks.get('resize')!(); timer!(); expect(bounds).toEqual(requested);
});

test('measured resize planning honors minimum size, display offsets and normalized window state', () => {
  const before = ciGeometry(); before.bounds = { x: -200, y: 2000, width: 340, height: 720 }; before.workArea.x = 100;
  const requested = chooseTerminalViewportBounds(before);
  expect(requested.width).toBeGreaterThan(before.bounds.width); expect(requested.x).toBeGreaterThanOrEqual(100);
  expect(requested.x + requested.width).toBeLessThanOrEqual(1124); expect(requested.y + requested.height).toBeLessThanOrEqual(720);
  before.minimumSize = [1024, 720]; before.bounds = { x: 100, y: 0, width: 1024, height: 720 };
  expect(() => chooseTerminalViewportBounds(before)).toThrow(/observable/);
  before.minimumSize = [1200, 720]; expect(() => chooseTerminalViewportBounds(before)).toThrow(/minimum size/);
  before.minimumSize = [320, 400]; before.isMaximized = true; expect(() => chooseTerminalViewportBounds(before)).toThrow(/normal-window/);
});

test('native resize is unqualified if renderer or terminal geometry is unchanged or belongs to another window', () => {
  const before = ciGeometry(), requested = chooseTerminalViewportBounds(before);
  const after = { ...before, bounds: requested, contentBounds: { ...before.contentBounds, width: requested.width },
    viewport: { ...before.viewport, width: requested.width }, terminalWidth: before.terminalWidth + requested.width - before.bounds.width };
  expect(terminalViewportResizeApplied(before, requested, after)).toBe(true);
  expect(terminalViewportResizeApplied(before, requested, { ...after, viewport: before.viewport })).toBe(false);
  expect(terminalViewportResizeApplied(before, requested, { ...after, terminalWidth: before.terminalWidth })).toBe(false);
  expect(terminalViewportResizeApplied(before, requested, { ...after, contentBounds: before.contentBounds })).toBe(false);
  expect(terminalViewportResizeApplied(before, requested, { ...after, windowId: before.windowId + 1 })).toBe(false);
  expect(terminalViewportResizeApplied(before, requested, { ...after, isFullScreen: true })).toBe(false);
});

test('geometry capture and resize use the actual Page window and public native APIs', async () => {
  const original = ciGeometry(); let bounds = { ...original.bounds }, fullScreen = true, maximized = true;
  const setBounds = jest.fn((value: typeof bounds, _animate: boolean) => { bounds = { ...value }; });
  const window = { id: 7, isDestroyed: () => false, getBounds: () => bounds, getContentBounds: () => bounds,
    getMinimumSize: () => [320, 400], isMaximized: () => maximized, isFullScreen: () => fullScreen,
    setFullScreen: (value: boolean) => { fullScreen = value; }, unmaximize: () => { maximized = false; }, setBounds };
  const fromId = jest.fn((id: number) => id === 7 ? window : null), dispose = jest.fn(async () => {});
  const page = { evaluate: async () => ({ width: bounds.width, height: bounds.height }),
    getByRole: (_role: string, options: { name: string }) => { expect(options.name).toBe('Interactive cmd terminal'); return { boundingBox: async () => ({ width: bounds.width - 332 }) }; } } as unknown as Page;
  const app = { browserWindow: jest.fn(async (actualPage: Page) => { expect(actualPage).toBe(page); return { evaluate: async (read: (value: typeof window) => number) => read(window), dispose }; }),
    evaluate: async (read: (electron: unknown, argument: unknown) => unknown, argument: unknown) => read({ BrowserWindow: { fromId }, screen: { getDisplayMatching: () => ({ workArea: original.workArea }) } }, argument) } as unknown as ElectronApplication;
  const captured = await captureTerminalViewport(app, page, 'Interactive cmd terminal');
  expect(captured).toMatchObject({ windowId: 7, minimumSize: [320, 400], isMaximized: true, isFullScreen: true, terminalWidth: 692 });
  await normalizeTerminalWindow(app, 7); const before = await captureTerminalViewport(app, page, 'Interactive cmd terminal');
  const requested = chooseTerminalViewportBounds(before); await resizeTerminalWindow(app, 7, requested);
  const after = await captureTerminalViewport(app, page, 'Interactive cmd terminal');
  expect(terminalViewportResizeApplied(before, requested, after)).toBe(true); expect(setBounds).toHaveBeenCalledWith(requested, false);
  expect(fromId.mock.calls.every(call => call[0] === 7)).toBe(true); expect(dispose).toHaveBeenCalledTimes(3);
});

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
  let columns = 89, exit: number | undefined;
  const handle = { getWindowSize: jest.fn((size: number[]) => { size[0] = columns; size[1] = 5; return 0; }) };
  const native = {
    writeFileSync: (file: string, text: string) => writes.set(file, text),
    renameSync: (from: string, to: string) => { writes.set(to, writes.get(from)!); writes.delete(from); },
  };
  const project = path.join('private', 'project');
  new Script(terminalTreeSources(project)['stdin.cjs']).runInNewContext({
    require: (name: string) => { expect(name).toBe('fs'); return native; },
    process: { pid: 17, stdin: { isTTY: true, once: (event: string, callback: typeof data) => { expect(event).toBe('data'); data = callback; } },
      stdout: { isTTY: true, columns: 89, getWindowSize: () => [89, 10], _handle: handle }, exit: (code: number) => { exit = code; } },
    console: { log: () => {} }, setInterval: (callback: () => void) => { interval = callback; return 1; }, clearInterval: () => {},
  });
  const marker = path.join(project, 'tty.json');
  expect(JSON.parse(writes.get(marker)!)).toEqual({ pid: 17, stdin: true, stdout: true, columns: 89, rows: 5, cachedColumns: 89 });
  columns = 57; interval!(); data!(Buffer.from('NATIVE_STDIN\r\n'));
  expect(JSON.parse(writes.get(marker)!)).toEqual({ pid: 17, stdin: true, stdout: true, columns: 57, rows: 5, cachedColumns: 89, input: 'NATIVE_STDIN' });
  expect(handle.getWindowSize).toHaveBeenCalledTimes(3);
  expect(handle.getWindowSize.mock.instances.every(owner => owner === handle)).toBe(true);
  expect(exit).toBe(0);
});

test('the cooked stdin observer refuses missing, failed or invalid native dimensions without cached fallback', () => {
  const source = terminalTreeSources(path.join('private', 'project'))['stdin.cjs'];
  const handles: unknown[] = [undefined, {}, { getWindowSize: () => -9 },
    { getWindowSize: (size: number[]) => { size[0] = 57; size[1] = 5; return undefined; } },
    ...[[0, 5], [57, 0], [NaN, 5], [Infinity, 5], [57.5, 5], [57, -1]].map(dimensions => ({
      getWindowSize: (size: number[]) => { size[0] = dimensions[0]; size[1] = dimensions[1]; return 0; },
    }))];
  for (const handle of handles) {
    const write = jest.fn();
    expect(() => new Script(source).runInNewContext({
      require: () => ({ writeFileSync: write }), process: { pid: 17,
        stdin: { isTTY: true }, stdout: { isTTY: true, columns: 57, getWindowSize: () => [57, 5], _handle: handle } },
    })).toThrow(/held native TTY query (unavailable|refused)/);
    expect(write).not.toHaveBeenCalled();
  }
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
    const geometry = { before: ciGeometry(), requested: chooseTerminalViewportBounds(ciGeometry()) };
    await recordTerminalFailure(page, directory, info, geometry);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'terminal-failure.json'), 'utf8'));
    expect(receipt.failureOnly).toBe(true); expect(receipt.canvasMasked).toBe(true);
    expect(receipt.geometry).toEqual(geometry);
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

test('actual failure capture bounds finite fit snapshots and excludes forged fields and oversized DOM packets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-terminal-fit-'));
  const globals = globalThis as unknown as { document?: unknown; window?: unknown };
  const previousDocument = globals.document, previousWindow = globals.window;
  try {
    const valid = { hostWidth: 422, emulatorCols: 56, requestCols: 56, requestRows: 15, resizeSequence: 2, requestOutcome: 'success', fitOutcome: 'returned', secret: 'private-secret' };
    const panel = { querySelectorAll: (selector: string) => selector === '[data-terminal-fit]' ? [
      { dataset: { terminalFit: JSON.stringify(valid) } },
      { dataset: { terminalFit: JSON.stringify({ hostWidth: 2_000_000, requestCols: -1, fitOutcome: 'private-secret', requestOutcome: 'forged' }) } },
      { dataset: { terminalFit: 'x'.repeat(1025) } },
    ] : [] };
    globals.document = { querySelector: () => panel, querySelectorAll: () => [] };
    globals.window = { electron: { workspaceTerminalList: async () => ({ success: true, sessions: [] }) } };
    const page = { evaluate: async (callback: (root: string) => unknown, root: string) => callback(root),
      screenshot: async () => Buffer.from('controlled screenshot'), locator: (selector: string) => selector } as unknown as Page;
    await recordTerminalFailure(page, directory, { outputPath: (name: string) => path.join(directory, name) } as TestInfo);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'terminal-failure.json'), 'utf8'));
    const { secret: _secret, ...expected } = valid;
    expect(receipt.ui.fit).toEqual([expected, {}, {}]);
    expect(JSON.stringify(receipt)).not.toContain('private-secret');
  } finally {
    globals.document = previousDocument; globals.window = previousWindow;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
