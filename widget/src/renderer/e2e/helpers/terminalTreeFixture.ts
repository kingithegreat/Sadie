import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Script } from 'vm';

interface Rectangle { x: number; y: number; width: number; height: number }
export interface TerminalViewportGeometry {
  windowId: number;
  bounds: Rectangle;
  contentBounds: Rectangle;
  workArea: Rectangle;
  minimumSize: [number, number];
  isMaximized: boolean;
  isFullScreen: boolean;
  viewport: { width: number; height: number };
  terminalWidth: number;
}
export interface TerminalViewportAttempt {
  initial?: TerminalViewportGeometry;
  before?: TerminalViewportGeometry;
  requested?: Rectangle;
  after?: TerminalViewportGeometry;
}

/** Select a real, observable horizontal resize inside the existing work area. */
export function chooseTerminalViewportBounds(before: TerminalViewportGeometry): Rectangle {
  const { bounds, workArea, minimumSize } = before;
  const values = [bounds.x, bounds.y, bounds.width, bounds.height, workArea.x, workArea.y, workArea.width, workArea.height, ...minimumSize];
  if (values.some(value => !Number.isFinite(value)) || before.isMaximized || before.isFullScreen) throw new Error('The fixture needs measured normal-window geometry before resizing.');
  const minWidth = Math.max(1, minimumSize[0]), minHeight = Math.max(1, minimumSize[1]);
  if (minWidth > workArea.width || minHeight > workArea.height) throw new Error('The native minimum size exceeds the available work area.');
  const step = Math.max(80, Math.min(240, Math.floor((workArea.width - minWidth) / 3)));
  const candidates = [bounds.width - step, bounds.width + step, minWidth, workArea.width];
  const width = candidates.find(value => value >= minWidth && value <= workArea.width && Math.abs(value - bounds.width) >= 40);
  if (width === undefined) throw new Error('The work area cannot provide an observable native width change.');
  const height = Math.max(minHeight, Math.min(bounds.height, workArea.height));
  return { x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)), width, height };
}

/** A request is not a resize receipt; all three observed surfaces must change. */
export function terminalViewportResizeApplied(before: TerminalViewportGeometry, requested: Rectangle, after: TerminalViewportGeometry): boolean {
  return after.windowId === before.windowId && !after.isMaximized && !after.isFullScreen && after.bounds.width === requested.width
    && after.contentBounds.width !== before.contentBounds.width && after.viewport.width !== before.viewport.width
    && Number.isFinite(after.terminalWidth) && after.terminalWidth > 0 && after.terminalWidth !== before.terminalWidth;
}

export async function captureTerminalViewport(app: ElectronApplication, page: Page, regionName: string): Promise<TerminalViewportGeometry> {
  // Public Playwright binding identifies this Page's actual BrowserWindow.
  // Never select some other visible auxiliary window.
  const handle = await app.browserWindow(page);
  let windowId: number;
  try { windowId = await handle.evaluate(window => window.id); } finally { await handle.dispose(); }
  const [native, viewport, terminal] = await Promise.all([
    app.evaluate(({ BrowserWindow, screen }, id) => {
      const window = BrowserWindow.fromId(id); if (!window || window.isDestroyed()) throw new Error('The actual fixture window is unavailable.');
      const bounds = window.getBounds(), minimum = window.getMinimumSize();
      return { windowId: id, bounds, contentBounds: window.getContentBounds(), workArea: screen.getDisplayMatching(bounds).workArea,
        minimumSize: [minimum[0], minimum[1]] as [number, number], isMaximized: window.isMaximized(), isFullScreen: window.isFullScreen() };
    }, windowId),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    page.getByRole('region', { name: regionName, exact: true }).boundingBox(),
  ]);
  if (!terminal) throw new Error('The actual terminal region has no measured bounds.');
  return { ...native, viewport, terminalWidth: terminal.width };
}

export async function normalizeTerminalWindow(app: ElectronApplication, windowId: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    const window = BrowserWindow.fromId(id); if (!window || window.isDestroyed()) throw new Error('The actual fixture window is unavailable.');
    if (window.isFullScreen()) window.setFullScreen(false);
    if (window.isMaximized()) window.unmaximize();
  }, windowId);
}

export async function resizeTerminalWindow(app: ElectronApplication, windowId: number, bounds: Rectangle): Promise<void> {
  await app.evaluate(({ BrowserWindow }, request) => {
    const window = BrowserWindow.fromId(request.windowId); if (!window || window.isDestroyed()) throw new Error('The actual fixture window is unavailable.');
    window.setBounds(request.bounds, false);
  }, { windowId, bounds });
}

export function terminalTreeSources(project: string) {
  const file = (name: string) => JSON.stringify(path.join(project, name));
  return {
    // Node 22.23.3 public getWindowSize() returns cached columns/rows. Its
    // held TTYWrap method queries uv_tty_get_winsize/GetConsoleScreenBufferInfo.
    // This pinned fixture observes that native handle without refreshing the
    // JS cache, synthesizing dimensions, opening a replacement or any fallback.
    'stdin.cjs': `const fs=require('fs');const p=${file('tty.json')};const nativeSize=()=>{const handle=process.stdout._handle;if(!handle||typeof handle.getWindowSize!=='function')throw Error('held native TTY query unavailable');const size=[0,0];const error=handle.getWindowSize(size);if(error!==0||size.some(value=>!Number.isInteger(value)||value<=0))throw Error('held native TTY query refused');return size;};const record=input=>{const size=nativeSize();fs.writeFileSync(p+'.tmp',JSON.stringify({pid:process.pid,stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,columns:size[0],rows:size[1],cachedColumns:process.stdout.columns,input}));fs.renameSync(p+'.tmp',p);};record();const timer=setInterval(()=>record(),50);console.log('TTY_READY');process.stdin.once('data',d=>{clearInterval(timer);record(d.toString().trim());process.exit(0);});`,
    'interrupt.cjs': `require('fs').writeFileSync(${file('interrupt.json')},JSON.stringify({pid:process.pid}));console.log('INTERRUPT_READY');setInterval(()=>{},1000);`,
    'grandchild.cjs': `require('fs').writeFileSync(${file('grandchild.json')},JSON.stringify({pid:process.pid,parent:process.ppid}));setInterval(()=>{},1000);`,
    // Windows libuv assigns non-detached children to its per-Node kill-on-close
    // Job. unref() alone does not survive that parent's native exit:
    // https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/win/process.c#L65-L91
    // The actual GUI fixture must still prove the outer retained Job owns them.
    'intermediate.cjs': `setTimeout(()=>{const c=require('child_process').spawn(process.execPath,[${file('grandchild.cjs')}],{detached:true,stdio:'ignore'});c.once('spawn',()=>{c.unref();setTimeout(()=>process.exit(0),300);});},500);`,
    'late-root.cjs': `const c=require('child_process').spawn(process.execPath,[${file('intermediate.cjs')}],{detached:true,stdio:'ignore'});c.once('spawn',()=>require('fs').writeFileSync(${file('background-root.json')},JSON.stringify({pid:process.pid,child:c.pid})));c.once('exit',code=>require('fs').writeFileSync(${file('intermediate-exited.txt')},String(code)));`,
  };
}

// Parse the cooked bytes that will actually be written, without executing them.
export function validateTerminalSources(sources: Record<string, string>): void {
  for (const [name, source] of Object.entries(sources)) new Script(source, { filename: name });
}

export function terminalDiagnosticText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)
    // Fixture command echoes/argv and arbitrary environment dumps are not useful here.
    .filter(line => !/\.cjs\b|\bnode(?:\.exe)?["\s]|\b(?:env|argv|capability)\b["']?\s*[:=]/i.test(line))
    .map(line => line.replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]')
      .replace(/\b(?:token|secret|password|authorization|api[_-]?key)["']?\s*[:=]\s*\S+/gi, '[redacted]'))
    .join('\n').slice(0, 4096);
}

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Read-only terminal diagnostic deadline exceeded.')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function settleTerminalCleanup(operations: Promise<unknown>[], preservePrimaryFailure: boolean, report: (errors: unknown[]) => void): Promise<void> {
  const cleanup = await Promise.allSettled(operations);
  const refused = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (!refused.length) return;
  try { report(refused.map(result => result.reason)); } catch { /* Artifact errors never replace the assertion or cleanup refusal. */ }
  if (!preservePrimaryFailure) throw refused[0].reason;
}

export async function recordTerminalFailure(page: Page, projectDir: string, testInfo: TestInfo, geometry?: TerminalViewportAttempt): Promise<void> {
  const metadata = bounded(page.evaluate(async root => {
    const panel = document.querySelector('[aria-label="Interactive terminal"]');
    const ui = {
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(node => (node.textContent || '').slice(0, 4096)).slice(0, 8),
      tabs: Array.from(panel?.querySelectorAll('[role="tab"]') || []).map(node => (node.textContent || '').slice(0, 128)).slice(0, 8),
      xterm: Array.from(panel?.querySelectorAll('.xterm-rows') || []).map(node => (node.textContent || '').slice(-8192)).slice(0, 4),
      fit: Array.from(panel?.querySelectorAll('[data-terminal-fit]') || []).slice(0, 4).map(node => {
        const result: Record<string, number | string> = {};
        const raw = (node as HTMLElement).dataset.terminalFit || '';
        if (raw.length > 1024) return result;
        try {
          const value = JSON.parse(raw) as Record<string, unknown>;
          for (const key of ['fitCount', 'hostWidth', 'hostHeight', 'emulatorCols', 'emulatorRows', 'requestCols', 'requestRows', 'resizeSequence']) {
            const n = value[key]; if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000) result[key] = n;
          }
          if (['hidden', 'returned', 'threw'].includes(String(value.fitOutcome))) result.fitOutcome = String(value.fitOutcome);
          if (['pending', 'invalid-size', 'success', 'rejected', 'transport-error'].includes(String(value.requestOutcome))) result.requestOutcome = String(value.requestOutcome);
        } catch { /* Unqualified DOM is never authority or raw diagnostic output. */ }
        return result;
      }),
    };
    const api = (window as unknown as { electron: { workspaceTerminalList(request: { projectDir: string }): Promise<unknown> } }).electron;
    return { ui, result: await api.workspaceTerminalList({ projectDir: root }) };
  }, projectDir), 2500).then(({ ui, result }) => {
    const response = result as { success?: boolean; error?: string; sessions?: Array<Record<string, unknown>> };
    return {
      ui: { alerts: ui.alerts.map(terminalDiagnosticText), tabs: ui.tabs.map(terminalDiagnosticText), xterm: ui.xterm.map(terminalDiagnosticText), fit: ui.fit },
      list: { success: response.success, error: terminalDiagnosticText(response.error), sessions: (response.sessions || []).slice(0, 4).map(session => ({
        profileId: session.profileId, pid: session.pid, shellPid: session.shellPid,
        exited: session.exited, exitCode: session.exitCode,
        closeError: terminalDiagnosticText(session.closeError), output: terminalDiagnosticText(session.output),
      })) },
    };
  }).catch(error => ({ diagnosticError: terminalDiagnosticText(String(error)) }));
  // Mask canvas command echoes; diagnostic text above is separately bounded/redacted.
  const screenshot = bounded(page.screenshot({ path: testInfo.outputPath('terminal-failure.png'), timeout: 2000,
    mask: [page.locator('.xterm-screen'), page.locator('[role="alert"]')] }), 2500)
    .then(() => ({ screenshot: 'terminal-failure.png', canvasMasked: true }))
    .catch(error => ({ screenshotError: terminalDiagnosticText(String(error)) }));
  const [state, visual] = await Promise.all([metadata, screenshot]);
  fs.writeFileSync(testInfo.outputPath('terminal-failure.json'), JSON.stringify({ failureOnly: true, ...state, ...visual, ...(geometry ? { geometry } : {}) }, null, 2));
}
