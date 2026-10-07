import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { assertWorkspaceRuntimeOpen } from './workspace-runtime-admission';
import { workspacePtyLifecycle, type WorkspacePtyIdentity } from './workspace-pty-identity';
import { stopWorkspacePtyTree, type WorkspacePtyStopReceipt } from './workspace-pty-force-stop';
import { checkedWorkspacePath } from './workspace-files';
import { ownedWindowsPty, type OwnedPtyProcess } from './workspace-pty-native-adapter';
import { createPendingWorkspaceWindowsJob, type PendingWorkspaceWindowsJob } from './workspace-windows-job';
import { snapshotWorkspaceLaunch } from './workspace-process-gate';
import { createWorkspaceTerminalGate } from './workspace-terminal-gate';
import type { WorkspaceTerminalCreateRequest, WorkspaceTerminalEvent, WorkspaceTerminalProfile, WorkspaceTerminalSessionInfo } from '../shared/workspace-terminal-types';

type PtyProcess = OwnedPtyProcess;
type PtyFactory = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; useConpty?: boolean; useConptyDll?: boolean }) => PtyProcess;
interface Session { owner: number; info: WorkspaceTerminalSessionInfo; pty: PtyProcess; job?: PendingWorkspaceWindowsJob; listeners: Array<{ dispose(): void }>; exited: boolean; released: boolean; killed: boolean; identity: Promise<WorkspacePtyIdentity | null | undefined>; exitWaiters: Set<() => void>; closing?: Promise<void>; killing?: Promise<void>; releasing?: Promise<void>; stopReceipt?: WorkspacePtyStopReceipt; stopReceiptLost?: boolean }
interface PendingCreate { owner: number; cwd: string; done: Promise<WorkspaceTerminalSessionInfo>; pty?: PtyProcess; job?: PendingWorkspaceWindowsJob; promoted: boolean; released: boolean; releasing?: Promise<void> }
const MAX_SESSIONS = 4;
const MAX_OUTPUT = 256 * 1024;
const RELEASE_TIMEOUT = 5500;
function bounded<T>(pending: Promise<T>, timeout: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    void pending.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

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
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 1 || rows > 200) throw new Error('Terminal size must be 2–500 columns and 1–200 rows.');
  return { cols, rows };
}

/** True PTYs: the process receives a console, stdin and terminal control sequences. */
export class WorkspacePtySessions {
  private sessions = new Map<string, Session>();
  private pendingCreates = new Set<PendingCreate>();
  constructor(private readonly spawnPty: PtyFactory = (file, args, options) => {
    // Load on demand; startup can explain an unavailable native package cleanly.
    // node-pty is an external production dependency, not a bundled .node addon.
    if (process.platform !== 'win32') return require('node-pty').spawn(file, args, options);
    if (require('node-pty/package.json').version !== '1.2.0-beta.15') throw new Error('Interactive terminals require the verified node-pty 1.2.0-beta.15 package. Rebuild this HomeBot copy with its pinned dependencies.');
    const binding = require('node-pty/lib/utils').loadNativeModule('conpty').module;
    if (typeof binding.kill !== 'function') throw new Error('The installed terminal binding does not support owned console cleanup.');
    const native = require('node-pty').spawn(file, args, options);
    // Pinned 1.2.0-beta.15 adapter: bypass public kill's ready-data defer and PID-list
    // branch. System ClosePseudoConsole returns immediately on build >=26100:
    // https://learn.microsoft.com/en-us/windows/console/closepseudoconsole
    return ownedWindowsPty(native, binding);
  }, private readonly profiles = workspaceTerminalProfiles, private readonly lifecycle = workspacePtyLifecycle, private readonly forceStop = stopWorkspacePtyTree, private readonly jobs = createPendingWorkspaceWindowsJob) {}

  create(owner: number, request: WorkspaceTerminalCreateRequest, notify: (event: WorkspaceTerminalEvent) => void, validateAuthority?: () => void): Promise<WorkspaceTerminalSessionInfo> {
    assertWorkspaceRuntimeOpen();
    validateAuthority?.();
    if (process.platform === 'win32' && Number(os.release().split('.')[2]) < 26100) throw new Error('Interactive terminals require Windows 11 24H2 (build 26100) or newer for bounded native cleanup. Use the command terminal on this Windows version.');
    if (this.sessions.size + [...this.pendingCreates].filter(p => !p.promoted).length >= MAX_SESSIONS) throw new Error('Close a terminal before opening another (maximum four).');
    const cwd = checkedWorkspacePath(request.projectDir);
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Choose a project folder.');
    const available = this.profiles();
    const profile = request.profileId ? available.find(p => p.id === request.profileId) : available[0];
    if (!profile) throw new Error('That shell profile is not available on this computer.');
    const size = dimensions(request.cols, request.rows);
    const args = profile.id === 'powershell' || profile.id === 'pwsh' ? ['-NoLogo', '-NoProfile'] : profile.id === 'cmd' ? ['/D'] : [];
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    const approvedLaunch = snapshotWorkspaceLaunch(profile.executable, args, env, process.platform === 'win32' ? { cwd, console: 'attached' } : {});
    const gate = process.platform === 'win32' ? createWorkspaceTerminalGate(env) : undefined;
    const pending: PendingCreate = { owner, cwd, done: undefined as unknown as Promise<WorkspaceTerminalSessionInfo>, promoted: false, released: false };
    this.pendingCreates.add(pending);
    pending.done = (async () => {
      try {
        if (gate) {
          pending.job = this.jobs({ gate: { pipeName: gate.pipeName, capability: gate.capability } });
          await pending.job.listening;
          assertWorkspaceRuntimeOpen();
          if (checkedWorkspacePath(request.projectDir) !== cwd) throw new Error('The project folder changed during terminal startup.');
        }
        const pty = this.spawnPty(gate?.executable || profile.executable, gate?.args || args, { name: 'xterm-256color', ...size, cwd, env: gate?.env || env, useConpty: process.platform === 'win32', useConptyDll: false });
        pending.pty = pty;
        if (pty.ready) await bounded(pty.ready, 6000, 'Terminal startup did not complete. Its owned output worker must close before HomeBot can quit.');
        if (!Number.isSafeInteger(pty.pid) || pty.pid <= 0) throw new Error('Terminal startup did not provide a valid shell process.');
        const info: WorkspaceTerminalSessionInfo = { sessionId: randomUUID(), profileId: profile.id, cwd, pid: pty.pid, output: '', seq: 0 };
        const session: Session = { owner, info, pty, job: pending.job, listeners: [], exited: false, released: false, killed: false, identity: this.lifecycle.capture(pty.pid), exitWaiters: new Set() };
        this.sessions.set(info.sessionId, session);
        pending.promoted = true;
        session.listeners.push(pty.onData(data => {
          info.output = (info.output + data).slice(-MAX_OUTPUT);
          for (let offset = 0; offset < data.length; offset += 16 * 1024) notify({ sessionId: info.sessionId, seq: ++info.seq, type: 'data', data: data.slice(offset, offset + 16 * 1024) });
        }));
        session.listeners.push(pty.onExit(event => {
          session.exited = true;
          info.exited = true; info.exitCode = event.exitCode;
          for (const resolve of session.exitWaiters) resolve();
          void (async () => {
            if (session.closing) { await session.closing; return; }
            if (session.job) {
              if (!await session.job.queryEmpty()) throw new Error('The terminal root ended, but owned background programs remain. Select Close to stop them.');
              await session.job.stop();
            }
            await this.release(session, process.platform === 'win32');
          })().catch(error => {
            info.closeError = error instanceof Error ? error.message : 'Terminal cleanup could not be confirmed. Select Close to retry.';
          }).then(() => { try { notify({ sessionId: info.sessionId, seq: ++info.seq, type: 'exit', exitCode: event.exitCode, closeError: info.closeError }); } catch { /* original renderer disappeared */ } });
        }));
        try {
          if (pending.job) {
            const original = await session.identity;
            if (!original) throw new Error('The terminal bootstrap creation identity could not be verified. No shell was released.');
            await pending.job.attach(pty.pid, original);
            assertWorkspaceRuntimeOpen();
            if (checkedWorkspacePath(request.projectDir) !== cwd) throw new Error('The project folder changed during terminal startup.');
            info.shellPid = await pending.job.authorize(approvedLaunch, () => {
              validateAuthority?.();
              assertWorkspaceRuntimeOpen();
              if (checkedWorkspacePath(request.projectDir) !== cwd) throw new Error('The project folder changed before terminal execution.');
            });
          }
          assertWorkspaceRuntimeOpen();
          validateAuthority?.();
        }
        catch (error) { await this.close(owner, info.sessionId); throw error; }
        return { ...info };
      } catch (error) {
        if (!pending.promoted && (pending.pty || pending.job)) await this.releasePending(pending);
        throw error;
      }
    })();
    void pending.done.then(() => this.pendingCreates.delete(pending), () => { if (pending.promoted || pending.released || (!pending.pty && !pending.job)) this.pendingCreates.delete(pending); });
    return pending.done;
  }
  private async releasePending(pending: PendingCreate): Promise<void> {
    if (pending.released) return;
    if (!pending.releasing) {
      pending.releasing = (async () => {
        const results = await Promise.allSettled([pending.job?.stop(), Promise.resolve().then(() => pending.pty?.kill())]);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
      })();
      void pending.releasing.catch(() => { pending.releasing = undefined; });
    }
    await bounded(pending.releasing, RELEASE_TIMEOUT, 'Terminal startup worker release could not be confirmed. Its owned worker is retained; try closing HomeBot again.');
    pending.released = true;
  }
  private async joinPending(owner?: number): Promise<void> {
    const pending = [...this.pendingCreates].filter(p => owner === undefined || p.owner === owner);
    const outcomes = await Promise.allSettled(pending.map(async p => {
      await p.done.catch(() => undefined);
      if (!p.promoted) await this.releasePending(p);
      this.pendingCreates.delete(p);
    }));
    const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failed) throw failed.reason;
  }

  private owned(owner: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new Error('This terminal belongs to a different window or has closed.');
    return session;
  }
  async list(owner: number, projectDir: string): Promise<WorkspaceTerminalSessionInfo[]> {
    const root = checkedWorkspacePath(projectDir);
    await Promise.allSettled([...this.pendingCreates].filter(p => p.owner === owner && p.cwd === root).map(p => p.done));
    const matches = (session: Session) => session.owner === owner && session.info.cwd === root;
    // Remount may race its old cleanup. Wait for those bounded attempts, then
    // recover only sessions still retained by main, including their transcript.
    await Promise.allSettled([...this.sessions.values()].filter(matches).map(session => session.closing).filter(Boolean));
    return [...this.sessions.values()].filter(matches).map(session => ({ ...session.info, exited: session.exited }));
  }
  write(owner: number, id: string, data: string): void {
    const session = this.owned(owner, id);
    if (session.exited) throw new Error('This terminal has exited. Open a new terminal.');
    if (typeof data !== 'string' || Buffer.byteLength(data) > 64 * 1024) throw new Error('Terminal input is too large.');
    session.pty.write(data);
  }
  resize(owner: number, id: string, cols: number, rows: number): void { const session = this.owned(owner, id); if (!session.exited) session.pty.resize(...Object.values(dimensions(cols, rows)) as [number, number]); }
  interrupt(owner: number, id: string): void { this.write(owner, id, '\x03'); }
  private release(session: Session, kill: boolean): Promise<void> {
    if (session.released) return Promise.resolve();
    if (session.releasing) return session.releasing;
    for (const listener of session.listeners) listener.dispose();
    session.listeners = [];
    let resolve!: () => void; let reject!: (error: unknown) => void;
    session.releasing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    void (kill ? this.kill(session) : Promise.resolve()).then(() => { session.released = true; resolve(); }, reject);
    void session.releasing.catch(() => { session.releasing = undefined; });
    return session.releasing;
  }
  private kill(session: Session): Promise<void> {
    if (session.killing) return session.killing;
    session.killed = true;
    // Set the captured operation before invoking kill, whose exit callback may
    // synchronously reenter release in a test or native adapter.
    let resolve!: () => void; let reject!: (error: unknown) => void;
    session.killing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    try { void Promise.resolve(session.pty.kill()).then(resolve, reject); } catch (error) { reject(error); }
    void session.killing.catch(() => { session.killed = false; session.killing = undefined; });
    return session.killing;
  }
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
      const original = await session.identity;
      if (session.stopReceiptLost) throw new Error('Terminal Stop evidence was corrupted or lost after a force attempt. Process-tree exit cannot safely be confirmed.');
      if (session.job) await session.job.stop();
      else if (process.platform === 'win32' && (!session.exited || session.stopReceipt)) {
        const result = await this.forceStop(session.pty.pid, original, session.stopReceipt);
        if (result.receipt) session.stopReceipt = result.receipt;
        if (result.attempted && !session.stopReceipt) session.stopReceiptLost = true;
        if (!result.stopped && (session.stopReceipt || result.attempted || !await this.lifecycle.stopped(session.pty.pid, original))) {
          if (original === undefined && !session.stopReceipt && !result.attempted) throw new Error('The terminal process identity could not be verified at startup. Nothing was stopped. Stop any running program, type exit in this terminal, then retry Close.');
          if (session.stopReceipt) throw new Error('Terminal process-tree exit could not be confirmed. Its captured identities are retained; try Close again.');
          if (session.stopReceiptLost) throw new Error('Terminal Stop evidence was corrupted or lost after a force attempt. Process-tree exit cannot safely be confirmed.');
          throw new Error('Terminal process-tree exit could not be confirmed. No verified Stop receipt is available; its session is retained. Try Close again.');
        }
      }
      const exited = this.waitForExit(session, 5500);
      if (!session.exited) await bounded(this.kill(session), RELEASE_TIMEOUT, 'Terminal output worker release could not be confirmed. Its session is retained; try Close again.');
      const notified = await exited;
      if ((!notified && process.platform !== 'win32') || !await this.lifecycle.stopped(session.pty.pid, original)) throw new Error('Terminal exit could not be confirmed. Its session is retained; try Close again before quitting HomeBot.');
      session.exited = true;
      await bounded(this.release(session, process.platform === 'win32'), RELEASE_TIMEOUT, 'Terminal output worker release could not be confirmed. Its session is retained; try Close again.');
      this.sessions.delete(id);
    })();
    try { await session.closing; }
    catch (error) { session.info.closeError = error instanceof Error ? error.message : String(error); throw error; }
    finally { session.closing = undefined; }
  }
  private async joinCloses(sessions: Array<[string, Session]>): Promise<void> {
    const outcomes = await Promise.allSettled(sessions.map(([id, session]) => this.close(session.owner, id)));
    const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failed) throw failed.reason;
  }
  async closeOwner(owner: number): Promise<void> {
    const pending = await Promise.allSettled([this.joinPending(owner)]);
    await this.joinCloses([...this.sessions].filter(([, session]) => session.owner === owner));
    if (pending[0].status === 'rejected') throw pending[0].reason;
  }
  async closeAll(): Promise<void> {
    const pending = await Promise.allSettled([this.joinPending()]);
    await this.joinCloses([...this.sessions]);
    if (pending[0].status === 'rejected') throw pending[0].reason;
  }
}

export const workspacePtySessions = new WorkspacePtySessions();
