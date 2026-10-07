import type { Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Script } from 'vm';

export function terminalTreeSources(project: string) {
  const file = (name: string) => JSON.stringify(path.join(project, name));
  return {
    'stdin.cjs': `const fs=require('fs');const p=${file('tty.json')};const record=input=>{fs.writeFileSync(p+'.tmp',JSON.stringify({pid:process.pid,stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,columns:process.stdout.getWindowSize()[0],input}));fs.renameSync(p+'.tmp',p);};record();const timer=setInterval(()=>record(),50);console.log('TTY_READY');process.stdin.once('data',d=>{clearInterval(timer);record(d.toString().trim());process.exit(0);});`,
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

export async function recordTerminalFailure(page: Page, projectDir: string, testInfo: TestInfo): Promise<void> {
  const metadata = bounded(page.evaluate(async root => {
    const panel = document.querySelector('[aria-label="Interactive terminal"]');
    const ui = {
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(node => (node.textContent || '').slice(0, 4096)).slice(0, 8),
      tabs: Array.from(panel?.querySelectorAll('[role="tab"]') || []).map(node => (node.textContent || '').slice(0, 128)).slice(0, 8),
      xterm: Array.from(panel?.querySelectorAll('.xterm-rows') || []).map(node => (node.textContent || '').slice(-8192)).slice(0, 4),
    };
    const api = (window as unknown as { electron: { workspaceTerminalList(request: { projectDir: string }): Promise<unknown> } }).electron;
    return { ui, result: await api.workspaceTerminalList({ projectDir: root }) };
  }, projectDir), 2500).then(({ ui, result }) => {
    const response = result as { success?: boolean; error?: string; sessions?: Array<Record<string, unknown>> };
    return {
      ui: { alerts: ui.alerts.map(terminalDiagnosticText), tabs: ui.tabs.map(terminalDiagnosticText), xterm: ui.xterm.map(terminalDiagnosticText) },
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
  fs.writeFileSync(testInfo.outputPath('terminal-failure.json'), JSON.stringify({ failureOnly: true, ...state, ...visual }, null, 2));
}
