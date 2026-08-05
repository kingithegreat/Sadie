/**
 * Interactive terminal sessions for the Terminal panel.
 *
 * Distinct from `tools/terminal.ts`, which is the LLM-facing tool: that one is
 * request/response, capped at 120s, and gated behind a permission prompt per
 * call. A human at a prompt needs streaming output, long-running commands, a
 * cwd that persists between commands, and the ability to cancel.
 *
 * Safety is deliberately shared, not reimplemented: the destructive-pattern
 * blocklist and the home-directory sandbox both come from `tools/terminal.ts`,
 * so a pattern added there protects this path too.
 *
 * This spawns one child per command rather than holding a PTY open. That means
 * no curses apps (vim, top) and no interactive prompts, but it needs no native
 * dependency — which matters because this machine has no MSVC C++ toolchain,
 * so a node-pty build would fail outright. Upgrading to node-pty + xterm.js is
 * a later step, not a prerequisite for a useful terminal.
 */

import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { isDestructiveCommand, validateCwd } from './tools/terminal';

export interface TerminalChunk {
  sessionId: string;
  stream: 'stdout' | 'stderr' | 'system';
  data: string;
}

export interface TerminalExit {
  sessionId: string;
  code: number | null;
  signal: string | null;
  durationMs: number;
  cwd: string;
}

interface Session {
  id: string;
  cwd: string;
  child: ChildProcess | null;
  startedAt: number;
}

const sessions = new Map<string, Session>();
let seq = 0;

/** Shell + flags per platform. */
function shellFor(): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c'] };
  }
  return { bin: process.env.SHELL || '/bin/sh', args: ['-c'] };
}

export function createSession(requestedCwd?: string): { id: string; cwd: string } {
  const home = os.homedir();
  let cwd = home;

  if (requestedCwd) {
    const v = validateCwd(requestedCwd);
    // Fall back to home rather than refusing to open a terminal at all.
    if (v.valid) cwd = v.resolved;
  }

  const id = `term_${Date.now().toString(36)}_${(seq++).toString(36)}`;
  sessions.set(id, { id, cwd, child: null, startedAt: 0 });
  return { id, cwd };
}

export function getSession(id: string): { id: string; cwd: string; running: boolean } | null {
  const s = sessions.get(id);
  return s ? { id: s.id, cwd: s.cwd, running: s.child !== null } : null;
}

export function closeSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  if (s.child) { try { s.child.kill(); } catch { /* already gone */ } }
  sessions.delete(id);
}

export function closeAllSessions(): void {
  for (const id of Array.from(sessions.keys())) closeSession(id);
}

/**
 * `cd` cannot be delegated to a spawned child — the child exits and its
 * working directory dies with it. Handle it in the session instead so the
 * prompt behaves the way a user expects.
 */
function handleCd(session: Session, target: string): { ok: boolean; message: string } {
  const home = os.homedir();
  const raw = target.trim().replace(/^["']|["']$/g, '');
  const dest = !raw || raw === '~'
    ? home
    : raw.startsWith('~')
      ? path.join(home, raw.slice(1))
      : path.resolve(session.cwd, raw);

  const v = validateCwd(dest);
  if (!v.valid) return { ok: false, message: v.error || `Cannot change directory to ${dest}` };

  session.cwd = v.resolved;
  return { ok: true, message: v.resolved };
}

export interface RunHandlers {
  onChunk: (chunk: TerminalChunk) => void;
  onExit: (exit: TerminalExit) => void;
}

/**
 * Run one command in a session, streaming output.
 * Returns immediately; completion is signalled through handlers.onExit.
 */
export function runCommand(id: string, command: string, handlers: RunHandlers): { started: boolean; error?: string } {
  const session = sessions.get(id);
  if (!session) return { started: false, error: 'Terminal session not found.' };
  if (session.child) return { started: false, error: 'A command is already running in this terminal.' };

  const cmd = (command || '').trim();
  if (!cmd) return { started: false, error: 'Empty command.' };

  const destructive = isDestructiveCommand(cmd);
  if (destructive.blocked) {
    handlers.onChunk({ sessionId: id, stream: 'system', data: `${destructive.reason}\n` });
    handlers.onExit({ sessionId: id, code: 126, signal: null, durationMs: 0, cwd: session.cwd });
    return { started: true };
  }

  // Built-ins the session owns rather than the child.
  const cdMatch = /^cd(?:\s+(.*))?$/i.exec(cmd);
  if (cdMatch) {
    const result = handleCd(session, cdMatch[1] ?? '');
    handlers.onChunk({
      sessionId: id,
      stream: result.ok ? 'system' : 'stderr',
      data: `${result.message}\n`,
    });
    handlers.onExit({ sessionId: id, code: result.ok ? 0 : 1, signal: null, durationMs: 0, cwd: session.cwd });
    return { started: true };
  }

  if (/^(clear|cls)$/i.test(cmd)) {
    handlers.onChunk({ sessionId: id, stream: 'system', data: '\x1bc' });
    handlers.onExit({ sessionId: id, code: 0, signal: null, durationMs: 0, cwd: session.cwd });
    return { started: true };
  }

  // The cwd may have been deleted since the last command.
  if (!fs.existsSync(session.cwd)) {
    const home = os.homedir();
    handlers.onChunk({
      sessionId: id,
      stream: 'system',
      data: `Working directory no longer exists; returned to ${home}\n`,
    });
    session.cwd = home;
  }

  const { bin, args } = shellFor();
  let child: ChildProcess;
  try {
    child = spawn(bin, [...args, cmd], {
      cwd: session.cwd,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '1' },
    });
  } catch (err: any) {
    return { started: false, error: `Could not start shell: ${err?.message || err}` };
  }

  session.child = child;
  session.startedAt = Date.now();

  child.stdout?.on('data', (b: Buffer) =>
    handlers.onChunk({ sessionId: id, stream: 'stdout', data: b.toString('utf8') }));
  child.stderr?.on('data', (b: Buffer) =>
    handlers.onChunk({ sessionId: id, stream: 'stderr', data: b.toString('utf8') }));

  child.on('error', (err: any) => {
    handlers.onChunk({ sessionId: id, stream: 'stderr', data: `${err?.message || err}\n` });
  });

  const finish = (code: number | null, signal: string | null) => {
    if (session.child !== child) return; // already reported
    const durationMs = Date.now() - session.startedAt;
    session.child = null;
    handlers.onExit({ sessionId: id, code, signal, durationMs, cwd: session.cwd });
  };

  child.on('close', finish);
  return { started: true };
}

/** Cancel the running command (Ctrl-C equivalent). */
export function killCommand(id: string): { killed: boolean; error?: string } {
  const session = sessions.get(id);
  if (!session) return { killed: false, error: 'Terminal session not found.' };
  if (!session.child) return { killed: false, error: 'Nothing is running.' };

  try {
    if (process.platform === 'win32' && session.child.pid) {
      // A shell's children survive killing the shell on Windows; kill the tree.
      spawn('taskkill', ['/pid', String(session.child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      session.child.kill('SIGINT');
    }
    return { killed: true };
  } catch (err: any) {
    return { killed: false, error: String(err?.message || err) };
  }
}

/** Test seam. */
export function __resetSessionsForTest(): void {
  sessions.clear();
  seq = 0;
}
