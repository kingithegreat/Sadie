import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
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
type PtyFactory = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; useConpty?: boolean }) => PtyProcess;
interface Session { owner: number; info: WorkspaceTerminalSessionInfo; pty: PtyProcess; listeners: Array<{ dispose(): void }>; exited: boolean; released: boolean }
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
    return require('node-pty').spawn(file, args, options);
  }, private readonly profiles = workspaceTerminalProfiles) {}

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
    const pty = this.spawnPty(profile.executable, args, { name: 'xterm-256color', ...size, cwd, env, useConpty: process.platform === 'win32' });
    const info: WorkspaceTerminalSessionInfo = { sessionId: randomUUID(), profileId: profile.id, cwd, pid: pty.pid, output: '', seq: 0 };
    const session: Session = { owner, info, pty, listeners: [], exited: false, released: false };
    this.sessions.set(info.sessionId, session);
    session.listeners.push(pty.onData(data => {
      info.output = (info.output + data).slice(-MAX_OUTPUT);
      for (let offset = 0; offset < data.length; offset += 16 * 1024) notify({ sessionId: info.sessionId, seq: ++info.seq, type: 'data', data: data.slice(offset, offset + 16 * 1024) });
    }));
    session.listeners.push(pty.onExit(event => {
      session.exited = true;
      notify({ sessionId: info.sessionId, seq: ++info.seq, type: 'exit', exitCode: event.exitCode });
      // ConPTY retains a worker even after the child exits. Release it now;
      // later closing its transcript must never kill a potentially reused PID.
      this.release(session, process.platform === 'win32');
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
    if (kill) { try { session.pty.kill(); } catch { /* already exited */ } }
  }
  async close(owner: number, id: string): Promise<void> {
    const session = this.owned(owner, id);
    this.sessions.delete(id);
    // Stop only this session's owned process tree, then release its PTY handle.
    if (!session.exited && process.platform === 'win32') await new Promise<void>(resolve => {
      execFile('taskkill.exe', ['/PID', String(session.pty.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 }, () => resolve());
    });
    this.release(session, !session.exited);
  }
  async closeOwner(owner: number): Promise<void> { await Promise.all([...this.sessions].filter(([, s]) => s.owner === owner).map(([id]) => this.close(owner, id))); }
  async closeAll(): Promise<void> { await Promise.all([...this.sessions].map(([id, s]) => this.close(s.owner, id))); }
}

export const workspacePtySessions = new WorkspacePtySessions();
