import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { validateTrustedWorkspaceRoot, checkedTrustedWorkspacePath } from './workspace-trust';
import { rememberWorkspaceChild, stopWorkspaceChild } from './workspace-owned-process';
import type { WorkspaceDebugRequest, WorkspaceDebugResult, WorkspaceDebugFrame } from '../shared/workspace-debug-types';
const within = (root: string, file: string) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function projectRoot(input: string): string {
  return validateTrustedWorkspaceRoot(input);
}
function projectFile(root: string, file: unknown): string {
  if (typeof file !== 'string') throw new Error('Choose a JavaScript program.');
  const actual = fs.realpathSync(checkedTrustedWorkspacePath(root, file));
  if (!within(root, actual) || !/\.[cm]?js$/i.test(actual) || !fs.statSync(actual).isFile()) throw new Error('The integrated debugger supports JavaScript Node programs inside this project. Compile TypeScript first; other languages need their own debug adapter.');
  return actual;
}
interface InspectorFrame { callFrameId: string; functionName: string; url: string; location: { scriptId: string; lineNumber: number; columnNumber: number }; scopeChain: Array<{ type: string; object: { objectId?: string } }> }
class DebugSession {
  readonly root: string;
  child: ChildProcess | null = null;
  socket: WebSocket | null = null;
  output = '';
  paused = false;
  frames: InspectorFrame[] = [];
  private nextId = 0;
  private requests = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private scripts = new Map<string, string>();
  private points = new Map<string, { path: string; line: number; id: string }>();
  constructor(root: string) { this.root = root; }
  private rejectRequests(message: string): void {
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    this.requests.clear();
  }
  async start(file: string, args: string[]) {
    if (this.child) throw new Error('Stop the current debug session first.');
    this.child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', '--', file, ...args], { cwd: this.root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' } });
    const child = this.child;
    try {
    rememberWorkspaceChild(child);
    const url = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      const timeout = setTimeout(() => reject(new Error('The debugger did not start in time.')), 5000);
      child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); this.output = (this.output + chunk).slice(-256_000); const match = stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      child.stdout!.on('data', chunk => { this.output = (this.output + chunk).slice(-256_000); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => {
        clearTimeout(timeout);
        if (!this.socket) reject(new Error('The program exited before the debugger connected.'));
        if (this.child === child) {
          const endedSocket = this.socket;
          this.child = null; this.socket = null; this.paused = false; this.frames = [];
          // Breakpoint/script IDs belong to this inspector connection. A later
          // Start must not advertise points that were never installed there.
          this.points.clear(); this.scripts.clear(); this.rejectRequests('The debug program exited.');
          endedSocket?.close();
        }
      });
    });
    if (this.child !== child) throw new Error('The debug program exited before its connection was ready.');
    this.socket = new WebSocket(url);
    const socket = this.socket;
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      let message: any; try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id) { const pending = this.requests.get(message.id); if (!pending) return; this.requests.delete(message.id); clearTimeout(pending.timer); if (message.error) pending.reject(new Error(message.error.message || 'Debugger request failed.')); else pending.resolve(message.result); }
      else if (message.method === 'Debugger.scriptParsed') this.scripts.set(message.params.scriptId, message.params.url);
      else if (message.method === 'Debugger.paused') { this.paused = true; this.frames = message.params.callFrames || []; }
      else if (message.method === 'Debugger.resumed') { this.paused = false; this.frames = []; }
    });
    socket.addEventListener('close', () => { if (this.socket === socket) this.rejectRequests('Debugger disconnected.'); });
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Debugger connection timed out.')), 5000); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The debugger connection failed.')); }, { once: true }); });
    const initialize = async (method: string) => {
      const requireOwner = () => { if (this.child !== child || this.socket !== socket) throw new Error('The debug session changed during startup.'); };
      requireOwner(); await this.command(method); requireOwner();
    };
    await initialize('Runtime.enable'); await initialize('Debugger.enable'); await initialize('Runtime.runIfWaitingForDebugger');
    } catch (error) {
      // An ended startup may finish after a subsequent Start. Its failure must
      // never stop that replacement, or a program rejected by duplicate Start.
      if (this.child === child) await this.stop();
      throw error;
    }
  }
  command(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Start a debug session first.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('Debugger response timed out.')); }, 5000); this.requests.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  }
  state(): WorkspaceDebugResult {
    const frames: WorkspaceDebugFrame[] = this.frames.map(frame => {
      const url = frame.url || this.scripts.get(frame.location.scriptId) || '';
      let file = ''; try { file = url.startsWith('file:') ? fileURLToPath(url) : url; } catch { /* internal script */ }
      return { id: frame.callFrameId, name: frame.functionName || '(anonymous)', path: within(this.root, file) ? file : '', line: frame.location.lineNumber + 1, column: frame.location.columnNumber + 1 };
    });
    return { success: true, running: !!this.child, paused: this.paused, output: this.output, pid: this.child?.pid, frames, breakpoints: [...this.points.values()].map(point => ({ path: point.path, line: point.line })) };
  }
  async breakpoint(file: string, line: number, remove: boolean) {
    const key = `${file}:${line}`; const previous = this.points.get(key);
    if (previous) { await this.command('Debugger.removeBreakpoint', { breakpointId: previous.id }); this.points.delete(key); }
    if (!remove) { const result = await this.command('Debugger.setBreakpointByUrl', { url: pathToFileURL(file).href, lineNumber: line - 1 }); this.points.set(key, { path: file, line, id: result.breakpointId }); }
  }
  async evaluate(expression: string, frameId?: string): Promise<string> {
    if (!this.paused) throw new Error('Pause the program before evaluating a watch expression.');
    const frame = frameId ? this.frames.find(frame => frame.callFrameId === frameId) : this.frames[0]; if (!frame) throw new Error('The call stack changed. Choose a paused call frame again.');
    const result = await this.command('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, silent: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'The watch expression failed.');
    return String(result.result?.description ?? JSON.stringify(result.result?.value) ?? result.result?.type);
  }
  async scopes(frameId?: string): Promise<Array<{ name: string; value: string }>> {
    const frame = frameId ? this.frames.find(frame => frame.callFrameId === frameId) : this.frames[0]; if (!this.paused || !frame) throw new Error('Pause the program and choose the current call frame to inspect variables.');
    const result: Array<{ name: string; value: string }> = [];
    for (const scope of frame.scopeChain.slice(0, 3)) {
      if (!scope.object.objectId || scope.type === 'global') continue;
      const properties = await this.command('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true, generatePreview: false });
      for (const property of (properties.result || []).slice(0, 100)) result.push({ name: `${scope.type}.${property.name}`, value: String(property.value?.description ?? property.value?.value ?? property.value?.type ?? '(getter)') });
    }
    return result;
  }
  async stop(): Promise<void> {
    const child = this.child;
    const socket = this.socket; this.socket = null; socket?.close();
    this.rejectRequests('Debug session stopped.');
    if (child) await stopWorkspaceChild(child);
    if (this.child && this.child !== child) return;
    if (this.child === child) this.child = null;
    this.paused = false; this.frames = []; this.points.clear(); this.scripts.clear();
  }
}
const sessions = new Map<string, DebugSession>();
let stoppingAll: Promise<void> | null = null;
export function stopWorkspaceDebuggers(): Promise<void> {
  if (stoppingAll) return stoppingAll;
  const pending = Promise.allSettled([...sessions.entries()].map(async ([root, session]) => {
    await session.stop();
    if (sessions.get(root) === session && !session.child) sessions.delete(root);
  })).then(results => {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  });
  const owned = pending.finally(() => { if (stoppingAll === owned) stoppingAll = null; });
  stoppingAll = owned; return owned;
}
export async function performWorkspaceDebug(request: WorkspaceDebugRequest): Promise<WorkspaceDebugResult> {
  try {
    if (!request || typeof request.root !== 'string') throw new Error('Choose a project folder.');
    const root = projectRoot(request.root);
    if (request.action === 'start' && stoppingAll) throw new Error('Debugger cleanup is in progress. Wait for it to finish before starting another program.');
    let session = sessions.get(root);
    if (!session && request.action !== 'start') {
      if (request.action === 'state' || request.action === 'stop') return { success: true, running: false, paused: false, output: '', frames: [], breakpoints: [] };
      throw new Error('Start a debug session first.');
    }
    if (!session) { if (sessions.size >= 2) throw new Error('Close another project debug session first.'); session = new DebugSession(root); sessions.set(root, session); }
    switch (request.action) {
      case 'start': {
        const file = projectFile(root, request.file);
        const args = request.args || []; if (!Array.isArray(args) || args.length > 50 || args.some(arg => typeof arg !== 'string' || arg.length > 5000)) throw new Error('Program arguments are invalid.');
        await session.start(file, args);
        break;
      }
      case 'state': break;
      case 'stop': await session.stop(); if (sessions.get(root) === session && !session.child) sessions.delete(root); break;
      case 'resume': await session.command('Debugger.resume'); break;
      case 'pause': await session.command('Debugger.pause'); break;
      case 'step-over': await session.command('Debugger.stepOver'); break;
      case 'step-in': await session.command('Debugger.stepInto'); break;
      case 'step-out': await session.command('Debugger.stepOut'); break;
      case 'breakpoint': { const file = projectFile(root, request.file); if (!Number.isInteger(request.line) || request.line! < 1 || request.line! > 1_000_000) throw new Error('Enter a valid breakpoint line.'); await session.breakpoint(file, request.line!, request.remove === true); break; }
      case 'evaluate': { if (typeof request.expression !== 'string' || !request.expression.trim() || request.expression.length > 2000) throw new Error('Enter a watch expression up to 2,000 characters.'); return { ...session.state(), value: await session.evaluate(request.expression, request.frameId) }; }
      case 'scopes': return { ...session.state(), variables: await session.scopes(request.frameId) };
      default: throw new Error('Unknown debugger action.');
    }
    return session.state();
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
