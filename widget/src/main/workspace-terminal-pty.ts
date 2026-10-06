import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { workspacePtyLifecycle, type WorkspacePtyIdentity, type WorkspacePtyLifecycle } from './workspace-pty-identity';
import { checkedWorkspacePath } from './workspace-files';
import type { WorkspaceTerminalCreateRequest, WorkspaceTerminalEvent, WorkspaceTerminalProfile, WorkspaceTerminalSessionInfo } from '../shared/workspace-terminal-types';

interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): { dispose(): void };
  onExit(callback: (event: { exitCode: number }) => void): { dispose(): void };
}
type PtyFactory = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; useConpty?: boolean; useConptyDll?: boolean }) => PtyProcess;
interface Session { owner: number; info: WorkspaceTerminalSessionInfo; pty: PtyProcess; listeners: Array<{ dispose(): void }>; exited: boolean; released: boolean; killed: boolean; identity: Promise<WorkspacePtyIdentity | null | undefined>; exitWaiters: Set<() => void>; closing?: Promise<void> }
const MAX_SESSIONS = 4;
const MAX_OUTPUT = 256 * 1024;

export function workspaceTerminalProfiles(): WorkspaceTerminalProfile[] {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const programs = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates: WorkspaceTerminalProfile[] = process.platform === 'win32' ? [
    { id: 'powershell', label: 'Windows PowerShell', executable: path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
    { id: 'pwsh', label: 'PowerShell 7', executable: path.join(programs, 'PowerShell', '7', 'pwsh.exe') },
    { id: 'cmd', label: 'Command Prompt', executable: path.join(windows, 'System32', 'cmd.exe') },
    { id: 'git-bash', label: 'Git Bash', executable: path.join(programs, 'Git', 'bin', 'bash.exe') },
  ] : [
    { id: 'bash', label: 'Bash', executable: '/bin/bash' },
    { id: 'zsh', label: 'Zsh', executable: '/bin/zsh' },
    { id: 'sh', label: 'Shell', executable: '/bin/sh' },
  ];
  return candidates.filter(p => fs.existsSync(p.executable));
}

function dimensions(cols = 100, rows = 30): { cols: number; rows: number } {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 500 || rows < 5 || rows > 200) throw new Error('Terminal size must be 20–500 columns and 5–200 rows.');
  return { cols, rows };
}

/** True PTYs: the process receives a console, stdin and terminal control sequences. */
export class WorkspacePtySessions {
  private sessions = new Map<string, Session>();
  constructor(private readonly spawnPty: PtyFactory = (file, args, options) => {
    // Load on demand; startup can explain an unavailable native package cleanly.
    // node-pty is an external production dependency, not a bundled .node addon.
    const native = require('node-pty').spawn(file, args, options);
    if (process.platform !== 'win32') return native;
    // node-pty 1.1.0 DLL mode does not reliably dispose its socket worker after
    // an already-exited shell. This adapter is intentionally tied to the pinned
    // version and invokes only the owned worker/native console, never a PID.
    const worker = native._agent?._conoutSocketWorker;
    if (!worker || typeof worker.dispose !== 'function') { native.kill(); throw new Error('The installed terminal binding does not support owned worker cleanup.'); }
    return { pid: native.pid, write: native.write.bind(native), resize: native.resize.bind(native), onData: native.onData.bind(native), onExit: native.onExit.bind(native), kill: () => { try { native.kill(); } finally { worker.dispose(); } } };
  }, private readonly profiles = workspaceTerminalProfiles, private readonly lifecycle = workspacePtyLifecycle) {}

  create(owner: number, request: WorkspaceTerminalCreateRequest, notify: (event: WorkspaceTerminalEvent) => void): WorkspaceTerminalSessionInfo {
    if (this.sessions.size >= MAX_SESSIONS) throw new Error('Close a terminal before opening another (maximum four).');
    const cwd = checkedWorkspacePath(request.projectDir);
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Choose a project folder.');
    const available = this.profiles();
    const profile = request.profileId ? available.find(p => p.id === request.profileId) : available[0];
    if (!profile) throw new Error('That shell profile is not available on this computer.');
    const size = dimensions(request.cols, request.rows);
    const args = profile.id === 'powershell' || profile.id === 'pwsh' ? ['-NoLogo', '-NoProfile'] : profile.id === 'cmd' ? ['/D'] : [];
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    // DLL mode closes the owned native console/process handle. Default node-pty
    // mode schedules PID-list kills, including a stale-PID fallback; avoid it.
    const pty = this.spawnPty(profile.executable, args, { name: 'xterm-256color', ...size, cwd, env, useConpty: process.platform === 'win32', useConptyDll: process.platform === 'win32' });
    const info: WorkspaceTerminalSessionInfo = { sessionId: randomUUID(), profileId: profile.id, cwd, pid: pty.pid, output: '', seq: 0 };
    const session: Session = { owner, info, pty, listeners: [], exited: false, released: false, killed: false, identity: this.lifecycle.capture(pty.pid), exitWaiters: new Set() };
    this.sessions.set(info.sessionId, session);
    session.listeners.push(pty.onData(data => {
      info.output = (info.output + data).slice(-MAX_OUTPUT);
      for (let offset = 0; offset < data.length; offset += 16 * 1024) notify({ sessionId: info.sessionId, seq: ++info.seq, type: 'data', data: data.slice(offset, offset + 16 * 1024) });
    }));
    session.listeners.push(pty.onExit(event => {
      session.exited = true;
      for (const resolve of session.exitWaiters) resolve();
      notify({ sessionId: info.sessionId, seq: ++info.seq, type: 'exit', exitCode: event.exitCode });
      // ConPTY retains a worker even after the child exits. Release it now;
      // later closing its transcript must never kill a potentially reused PID.
      try { this.release(session, process.platform === 'win32'); } catch (error) { console.error('[HomeBot-CATCH]', error); }
    }));
    return { ...info };
  }

  private owned(owner: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new Error('This terminal belongs to a different window or has closed.');
    return session;
  }
  write(owner: number, id: string, data: string): void {
    const session = this.owned(owner, id);
    if (session.exited) throw new Error('This terminal has exited. Open a new terminal.');
    if (typeof data !== 'string' || Buffer.byteLength(data) > 64 * 1024) throw new Error('Terminal input is too large.');
    session.pty.write(data);
  }
  resize(owner: number, id: string, cols: number, rows: number): void { const session = this.owned(owner, id); if (!session.exited) session.pty.resize(...Object.values(dimensions(cols, rows)) as [number, number]); }
  interrupt(owner: number, id: string): void { this.write(owner, id, '\x03'); }
  private release(session: Session, kill: boolean): void {
    if (session.released) return;
    session.released = true;
    for (const listener of session.listeners) listener.dispose();
    session.listeners = [];
    try { if (kill) this.kill(session); } catch (error) { session.released = false; throw error; }
  }
  private kill(session: Session): void { if (session.killed) return; session.killed = true; try { session.pty.kill(); } catch (error) { session.killed = false; throw error; } }
  private waitForExit(session: Session, timeout: number): Promise<boolean> {
    if (session.exited) return Promise.resolve(true);
    return new Promise(resolve => {
      const closed = () => { clearTimeout(timer); session.exitWaiters.delete(closed); resolve(true); };
      const timer = setTimeout(() => { session.exitWaiters.delete(closed); resolve(false); }, timeout);
      session.exitWaiters.add(closed);
    });
  }
  async close(owner: number, id: string): Promise<void> {
    const session = this.owned(owner, id);
    if (session.closing) return session.closing;
    session.closing = (async () => {
      const exited = this.waitForExit(session, 5500);
      if (!session.exited) this.kill(session);
      if (!await exited || !await this.lifecycle.stopped(session.pty.pid, await session.identity)) throw new Error('Terminal exit could not be confirmed. Its session is retained; try Close again before quitting HomeBot.');
      this.release(session, process.platform === 'win32');
      this.sessions.delete(id);
    })();
    try { await session.closing; } finally { session.closing = undefined; }
  }
  async closeOwner(owner: number): Promise<void> { await Promise.all([...this.sessions].filter(([, s]) => s.owner === owner).map(([id]) => this.close(owner, id))); }
  async closeAll(): Promise<void> { await Promise.all([...this.sessions].map(([id, s]) => this.close(s.owner, id))); }
}

export const workspacePtySessions = new WorkspacePtySessions();
