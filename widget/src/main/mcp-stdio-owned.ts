import path from 'path';
import { StdioClientTransport, getDefaultEnvironment, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createPendingWorkspaceWindowsJob, type PendingWorkspaceWindowsJob } from './workspace-windows-job';
import { createWorkspaceProcessGate, snapshotWorkspaceLaunch } from './workspace-process-gate';
import { workspacePtyLifecycle } from './workspace-pty-identity';

export interface OwnedMcpStdioOptions {
  signal?: AbortSignal;
  /** Must check this exact server generation and global shutdown admission. */
  assertCurrent?: () => void;
}
export interface OwnedMcpStdioTransport {
  transport: StdioClientTransport;
  /** Retained independently of Client, which drops its transport on close. */
  close(): Promise<void>;
  cleanupScope: 'windows-job' | 'sdk-direct-child';
}

const CHILD_CLOSE_BUDGET_MS = 4500;

/** SDK public start/close/pid/stderr only. The configured server cannot execute
 * until the shared fixed bootstrap is assigned to its retained Windows Job.
 * A closed RPC client is not proof that this Job has no inherited members.
 */
class WindowsOwnedStdio extends StdioClientTransport {
  private readonly job: PendingWorkspaceWindowsJob;
  private readonly approvedLaunch: ReturnType<typeof snapshotWorkspaceLaunch>;
  private readonly options: OwnedMcpStdioOptions;
  private stopRequested = false;
  private started = false;
  private spawnAttempt?: Promise<void>;
  private closing?: Promise<void>;
  private closed = false;
  private childClosed = false;
  private resolveChildClose!: () => void;
  private readonly childClose: Promise<void>;

  constructor(server: StdioServerParameters, options: OwnedMcpStdioOptions) {
    // Freeze only SDK's public default inheritance plus explicit overrides for
    // the target. Credentials are never copied to diagnostics or helper env.
    const targetEnv = { ...getDefaultEnvironment(), ...server.env };
    const cwd = path.resolve(server.cwd ?? process.cwd());
    const approved = snapshotWorkspaceLaunch(server.command, [...(server.args ?? [])], targetEnv, { cwd, adapter: 'cross-spawn' });
    const coreEnv = { ...getDefaultEnvironment() };
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    if (systemRoot) coreEnv.SystemRoot = systemRoot;
    const gate = createWorkspaceProcessGate(coreEnv);
    const sdkEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(gate.env)) if (typeof value === 'string') sdkEnv[key] = value;
    super({ command: gate.executable, args: gate.args, env: sdkEnv, cwd,
      stderr: server.stderr, maxBufferSize: server.maxBufferSize });
    this.options = { signal: options.signal, assertCurrent: options.assertCurrent };
    this.approvedLaunch = approved;
    this.childClose = new Promise(resolve => { this.resolveChildClose = resolve; });
    // Protocol.connect preserves this callback before installing its own.
    this.onclose = () => { this.childClosed = true; this.resolveChildClose(); };
    // Ownership is established synchronously, before Client.connect/start.
    this.job = createPendingWorkspaceWindowsJob({ env: gate.env,
      gate: { pipeName: gate.pipeName, capability: gate.capability } });
    // The owner's ready failure is still observed by start/close; prevent an
    // idle factory from emitting an unhandled readiness rejection.
    void this.job.ready.catch(() => {});
    void this.job.listening.catch(() => {});
  }

  private assertAdmitted(): void {
    if (this.stopRequested || this.options.signal?.aborted) throw new Error('MCP server startup was cancelled.');
    this.options.assertCurrent?.();
  }

  override async start(): Promise<void> {
    if (this.started) throw new Error('Owned MCP stdio transport already started.');
    this.started = true;
    try {
      this.assertAdmitted();
      await this.job.listening;
      this.assertAdmitted();
      // SDK only spawns the core gate; no project module or configured command.
      this.spawnAttempt = super.start();
      await this.spawnAttempt;
      this.assertAdmitted();
      const pid = this.pid;
      if (!Number.isSafeInteger(pid) || !pid || pid < 1) throw new Error('MCP bootstrap did not expose a positive native PID.');
      const identity = await workspacePtyLifecycle.capture(pid);
      if (!identity) throw new Error('MCP bootstrap native identity could not be verified.');
      this.assertAdmitted();
      await this.job.attach(pid, identity);
      await this.job.ready;
      this.assertAdmitted();
      // Shared Job checks this callback again immediately before GO, after its
      // own awaited membership query. No task completion exception is allowed.
      await this.job.authorize(this.approvedLaunch, () => this.assertAdmitted());
      this.assertAdmitted();
    } catch (error) {
      try { await this.close(); }
      catch (cleanup) { throw new Error(`${String(error)}; MCP cleanup remains pending: ${String(cleanup)}`); }
      throw error;
    }
  }

  private async closeSdkChild(): Promise<void> {
    // Stop never waits for start itself: start's error path also joins close.
    // Join only the SDK spawn attempt so no late spawn can escape this close.
    if (!this.spawnAttempt) return;
    await this.spawnAttempt.catch(() => {});
    await super.close();
    if (this.childClosed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.childClose, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('MCP bootstrap child close was not confirmed.')), CHILD_CLOSE_BUDGET_MS);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  override close(): Promise<void> {
    // Set before ANY await, including pending Job setup and SDK spawn.
    this.stopRequested = true;
    if (this.closed) return Promise.resolve();
    if (!this.closing) {
      const operation = Promise.allSettled([this.closeSdkChild(), this.job.stop()]).then(results => {
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => String(result.reason));
        if (errors.length) throw new Error(`Owned MCP cleanup could not be confirmed: ${errors.join('; ')}`);
        this.closed = true;
      });
      this.closing = operation;
      // Keep the same retained Job on failure; retry cannot recapture a PID or
      // return a permanently cached rejection. Successful cleanup is memoized.
      void operation.catch(() => { if (this.closing === operation) this.closing = undefined; });
    }
    return this.closing;
  }
}

class DirectOwnedStdio extends StdioClientTransport {
  private stopRequested = false;
  private readonly options: OwnedMcpStdioOptions;
  constructor(server: StdioServerParameters, options: OwnedMcpStdioOptions) {
    super({ ...server, args: [...(server.args ?? [])], env: { ...getDefaultEnvironment(), ...server.env },
      cwd: path.resolve(server.cwd ?? process.cwd()) });
    this.options = { signal: options.signal, assertCurrent: options.assertCurrent };
  }
  private assertAdmitted(): void {
    if (this.stopRequested || this.options.signal?.aborted) throw new Error('MCP server startup was cancelled.');
    this.options.assertCurrent?.();
  }
  override async start(): Promise<void> {
    this.assertAdmitted();
    await super.start();
    try { this.assertAdmitted(); }
    catch (error) { await this.close(); throw error; }
  }
  override close(): Promise<void> { this.stopRequested = true; return super.close(); }
}

export function createOwnedMcpStdioTransport(server: StdioServerParameters, options: OwnedMcpStdioOptions = {}): OwnedMcpStdioTransport {
  if (process.platform === 'win32') {
    const transport = new WindowsOwnedStdio(server, options);
    return { transport, close: () => transport.close(), cleanupScope: 'windows-job' };
  }
  // Preserve SDK behavior on POSIX. This public close is DIRECT-CHILD scope;
  // it is not a new process-group or complete descendant cleanup guarantee.
  const transport = new DirectOwnedStdio(server, options);
  return { transport, close: () => transport.close(), cleanupScope: 'sdk-direct-child' };
}
