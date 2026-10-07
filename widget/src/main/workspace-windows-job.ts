import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { verifiedWorkspaceWindowsJobRuntime } from './workspace-windows-job-asset';
import type { WorkspacePtyIdentity } from './workspace-pty-identity';

export interface WorkspaceWindowsJob {
  readonly ready: Promise<void>;
  queryEmpty(): Promise<boolean>;
  stop(): Promise<void>;
}
export interface WorkspaceApprovedLaunch {
  executable: string; args: string[]; env: NodeJS.ProcessEnv; kind?: 'task'; cwd?: string;
  /** Main-only Windows PTY mode; no renderer supplies console devices or FDs. */
  console?: 'attached';
  /** Constructed only by the trusted main snapshot helper, never IPC arguments. */
  adapter?: { kind: 'cross-spawn'; modulePath: string; comspec: string };
}
export interface PendingWorkspaceWindowsJob extends WorkspaceWindowsJob {
  readonly listening: Promise<void>;
  attach(pid: number, original: WorkspacePtyIdentity): Promise<void>;
  /** Fixed core bootstrap capture; originating parent is always main process.pid. */
  attachChild?(pid: number): Promise<WorkspacePtyIdentity>;
  authorize(launch: WorkspaceApprovedLaunch, validate?: () => void): Promise<number>;
  /** Observability only; never evidence of readiness, membership or cleanup. */
  getStartupDiagnostics?(): WorkspaceJobStartupDiagnostics;
}
export interface WorkspaceJobStartupDiagnostics {
  spawnObservedMs?: number;
  startupTimeoutObservedMs?: number;
  phases: Array<{ phase: string; observedMs: number; code?: string; nativeCode?: string }>;
  close?: { observedMs: number; outcome: 'zero' | 'nonzero' | 'signal' | 'unknown' | 'not-started'; exitCode?: number };
  /** No ChildProcess/helper/Job was ever created; not an OS exit receipt. */
  noOwnerCleanupConfirmed?: true;
}
interface JobOptions { env?: NodeJS.ProcessEnv; gate?: { pipeName: string; capability: string } }
type Reply = { type?: unknown; id?: unknown; ok?: unknown; empty?: unknown; pid?: unknown; creation?: unknown; parent?: unknown; phase?: unknown; code?: unknown; nativeCode?: unknown };
const OPERATION_TIMEOUT = 4500;
const MAX_LINE = 4096;
const DIAGNOSTIC_PHASES = new Set(['entry', 'encoding', 'encoding-constructed', 'encoding-set', 'setup', 'setup-read', 'utility-import', 'utility-imported', 'compile', 'asset-load', 'asset-loaded', 'create', 'listen', 'command', 'attach', 'go', 'query', 'stop']);
const DIAGNOSTIC_CODES = new Set(['create', 'limits', 'pipe', 'open', 'identity', 'assign', 'root', 'peer-timeout', 'peer', 'capability', 'peer-read-timeout', 'peer-input', 'query', 'baseline', 'child', 'completion', 'membership', 'operation', 'console-input', 'console-output', 'console-close', 'spawn', 'unknown']);
const DIAGNOSTIC_NATIVE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENXIO', 'EINVAL', 'EBADF', 'EIO', 'ENOTSUP', 'UNKNOWN']);

/** Return cleanup ownership before asynchronous helper startup or assignment. */
export function createPendingWorkspaceWindowsJob(options: JobOptions = {}): PendingWorkspaceWindowsJob {
  let child: ChildProcessWithoutNullStreams | undefined;
  let asset: { host: string; hostSha256: string; assembly: string; sha256: string };
  let setup: string;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  let listenResolve!: () => void, listenReject!: (error: Error) => void;
  let closeResolve!: () => void;
  let closed = false, attached = false, authorized = false, complete = false;
  let closeCode: number | null = null;
  let zeroConfirmed = false;
  let noOwnerCleanupConfirmed = false;
  let stopping: Promise<void> | undefined;
  let nextId = 0, lineBuffer = '';
  let phase = 'unobserved', diagnosticFailure: string | undefined;
  let spawnStarted = Date.now(), phaseObservedAt: number | undefined;
  let spawnObservedMs: number | undefined, startupTimeoutObservedMs: number | undefined;
  let observedClose: WorkspaceJobStartupDiagnostics['close'];
  const observedPhases: WorkspaceJobStartupDiagnostics['phases'] = [];
  const elapsed = () => {
    const value = Date.now() - spawnStarted;
    return Number.isFinite(value) ? Math.max(0, Math.min(60_000, Math.floor(value))) : 60_000;
  };
  const diagnostic = () => ` Helper phase: ${phase}.${phaseObservedAt === undefined ? '' : ` Observed ${phaseObservedAt}ms after helper spawn began.`}${diagnosticFailure ? ` Last fixed helper error: ${diagnosticFailure}.` : ''}`;
  const pending = new Map<number, { operation: string; resolve(value: Reply): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  const stopRequests = new Set<number>();
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const listening = new Promise<void>((resolve, reject) => { listenResolve = resolve; listenReject = reject; });
  void ready.catch(() => undefined); void listening.catch(() => undefined);
  const close = new Promise<void>(resolve => { closeResolve = resolve; });
  const fail = (message: string) => {
    const error = new Error(message); readyReject(error); listenReject(error);
    for (const [id, operation] of pending) { clearTimeout(operation.timer); pending.delete(id); operation.reject(error); }
  };
  const request = (operation: string, fields: object = {}): Promise<Reply> => {
    if (!child || closed) return Promise.reject(new Error('The owned Job helper is unavailable; process cleanup is unverified.'));
    const id = ++nextId;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The owned Job did not confirm its state in time. Its cleanup ownership is retained.' + diagnostic())); }, OPERATION_TIMEOUT);
      pending.set(id, { operation, resolve, reject, timer });
      if (operation === 'stop') { stopRequests.add(id); if (stopRequests.size > 16) stopRequests.delete(stopRequests.values().next().value!); }
      const encoded = JSON.stringify({ ...fields, id, operation }) + '\n';
      if (encoded.length > 131072) { clearTimeout(timer); pending.delete(id); reject(new Error('The approved launch exceeds its bounded transport size.')); return; }
      child!.stdin.write(encoded, error => {
        if (!error) return; const item = pending.get(id); if (!item) return;
        clearTimeout(item.timer); pending.delete(id); item.reject(new Error('The owned Job request could not be delivered.'));
      });
    });
  };
  const job: PendingWorkspaceWindowsJob = {
    ready, listening,
    getStartupDiagnostics: () => ({
      ...(spawnObservedMs === undefined ? {} : { spawnObservedMs }),
      ...(startupTimeoutObservedMs === undefined ? {} : { startupTimeoutObservedMs }),
      phases: observedPhases.map(observation => ({ ...observation })),
      ...(observedClose ? { close: { ...observedClose } } : {}),
      ...(noOwnerCleanupConfirmed ? { noOwnerCleanupConfirmed: true as const } : {}),
    }),
    attach: async (pid, original) => {
      if (attached || !Number.isSafeInteger(pid) || pid <= 0 || !original || !/^\d{1,19}$/.test(original.creation) || BigInt(original.creation) <= 0n || !Number.isSafeInteger(original.parent) || original.parent <= 0) {
        const error = new Error('One positive captured native identity is required before Job assignment.'); readyReject(error); throw error;
      }
      attached = true;
      try {
        await listening; const result = await request('attach', { pid, creation: original.creation });
        if (result.ok !== true) throw new Error('Job assignment or startup peer verification failed. No project execution was released.' + diagnostic());
        readyResolve();
      } catch (error) { readyReject(error instanceof Error ? error : new Error('Job assignment failed.')); throw error; }
    },
    attachChild: async pid => {
      if (!options.gate || attached || !Number.isSafeInteger(pid) || pid <= 0) {
        const error = new Error('One fixed core child and its private startup peer are required.'); readyReject(error); throw error;
      }
      attached = true;
      try {
        await listening;
        const result = await request('attach-child', { pid, parent: process.pid });
        if (result.ok !== true || typeof result.creation !== 'string' || !/^\d{1,19}$/.test(result.creation) || BigInt(result.creation) <= 0n || result.parent !== process.pid) {
          throw new Error('The fixed launcher creation identity could not be verified. No project code was released.' + diagnostic());
        }
        readyResolve(); return { creation: result.creation, parent: process.pid };
      } catch (error) { readyReject(error instanceof Error ? error : new Error('Task child assignment failed.')); throw error; }
    },
    authorize: async (launch, validate) => {
      if (!options.gate || authorized) throw new Error('The startup handoff is single-use.');
      authorized = true; await ready;
      if (typeof launch.executable !== 'string' || !launch.executable || !Array.isArray(launch.args) || launch.args.some(arg => typeof arg !== 'string') || !launch.env || typeof launch.env !== 'object') throw new Error('A main-approved launch is required.');
      if (launch.kind !== undefined && launch.kind !== 'task') throw new Error('The approved launch kind is invalid.');
      if (launch.console !== undefined && (launch.console !== 'attached' || launch.kind !== undefined || launch.adapter !== undefined)) throw new Error('Attached console handles are restricted to the main-approved terminal profile.');
      // The originating main-owned scope must still hold after readiness.
      validate?.();
      const result = await request('go', { launch });
      if (result.ok !== true || !Number.isSafeInteger(result.pid) || (result.pid as number) <= 0) throw new Error('The approved shell did not confirm a positive owned process. Its Job is retained for cleanup.' + diagnostic());
      return result.pid as number;
    },
    queryEmpty: async () => {
      await ready; const result = await request('query');
      if (result.ok !== true || typeof result.empty !== 'boolean') throw new Error('The owned Job state is unverified.' + diagnostic());
      return result.empty;
    },
    stop: () => {
      if (complete) return Promise.resolve(); if (stopping) return stopping;
      if (!child && closed && observedClose?.outcome === 'not-started') {
        // This branch cannot consume an OS close event or a returned uncertain
        // ChildProcess: there was never a helper to own or admit into a Job.
        noOwnerCleanupConfirmed = true; complete = true; return Promise.resolve();
      }
      const operation = (async () => {
        await listening.catch(() => undefined);
        if (!closed) {
          const result = await request('stop');
          if (result.ok !== true || result.empty !== true) throw new Error('The owned Job did not confirm all its processes exited. Retry Stop.' + diagnostic());
          zeroConfirmed = true;
        }
        if (!zeroConfirmed) throw new Error('The owned Job helper was lost without verified cleanup.');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The owned Job helper has not closed. Its cleanup ownership is retained.')), OPERATION_TIMEOUT);
          void close.then(() => { clearTimeout(timer); resolve(); });
        });
        if (closeCode !== 0) throw new Error('The owned Job helper exited unexpectedly; cleanup is unverified.');
        complete = true;
      })();
      stopping = operation;
      void operation.catch(() => { if (stopping === operation) stopping = undefined; });
      return operation;
    },
  };
  if (options.gate && (!/^hbi-[a-f0-9-]{36}$/.test(options.gate.pipeName) || !/^[a-f0-9]{64}$/.test(options.gate.capability))) {
    observedClose = { observedMs: elapsed(), outcome: 'not-started' };
    closed = true; closeResolve(); fail('The private startup pipe configuration is invalid.'); return job;
  }
  try {
    // Fixed argv contains no bearer, launch command, environment or project.
    // Sensitive setup and GO use only the owned process's stdin transport.
    // Both fixed owned artifacts are verified before any spawn. Request cwd,
    // environment and argv cannot select a host or an assembly.
    asset = verifiedWorkspaceWindowsJobRuntime();
    const encodedPath = Buffer.from(asset.assembly, 'utf8').toString('base64');
    if (!encodedPath || encodedPath.length > 8192 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('The fixed product setup is invalid.');
    setup = [encodedPath, asset.sha256, options.gate?.pipeName || '', options.gate?.capability || ''].join('\n') + '\n';
    spawnStarted = Date.now();
    child = spawn(asset.host, [], { windowsHide: true, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { observedClose = { observedMs: elapsed(), outcome: 'not-started' }; closed = true; closeResolve(); fail('The owned Job helper could not start.'); return job; }
  const startupTimer = setTimeout(() => {
    startupTimeoutObservedMs = elapsed();
    fail('The owned Job helper did not become ready in time. Cleanup ownership is retained.' + diagnostic());
  }, OPERATION_TIMEOUT);
  child.once('spawn', () => { spawnObservedMs = elapsed(); });
  child.stdin.on('error', () => fail('The owned Job control pipe failed. Cleanup ownership is retained.'));
  child.stdout.on('data', (chunk: Buffer | string) => {
    lineBuffer += chunk.toString();
    if (lineBuffer.length > MAX_LINE && !lineBuffer.includes('\n')) { lineBuffer = ''; fail('The owned Job helper returned an oversized response.'); return; }
    for (;;) {
      const end = lineBuffer.indexOf('\n'); if (end < 0) break;
      const line = lineBuffer.slice(0, end); lineBuffer = lineBuffer.slice(end + 1);
      if (line.length > MAX_LINE) { fail('The owned Job helper returned an oversized response.'); continue; }
      let message: Reply;
      try { const value: unknown = JSON.parse(line); if (!value || typeof value !== 'object') throw new Error(); message = value as Reply; }
      catch { fail('The owned Job helper returned invalid state evidence.'); continue; }
      if (message.type === 'phase' && typeof message.phase === 'string' && DIAGNOSTIC_PHASES.has(message.phase) && (message.code === undefined || typeof message.code === 'string' && DIAGNOSTIC_CODES.has(message.code)) && (message.nativeCode === undefined || typeof message.nativeCode === 'string' && DIAGNOSTIC_NATIVE_CODES.has(message.nativeCode))) {
        // Observability only: a phase never proves listening, assignment or zero accounting.
        phase = message.phase; phaseObservedAt = Math.max(0, Date.now() - spawnStarted);
        observedPhases.push({ phase, observedMs: elapsed(),
          ...(typeof message.code === 'string' ? { code: message.code } : {}),
          ...(typeof message.nativeCode === 'string' ? { nativeCode: message.nativeCode } : {}),
        });
        if (observedPhases.length > 16) observedPhases.shift();
        if (typeof message.code === 'string') diagnosticFailure = `${phase}/${message.code}${typeof message.nativeCode === 'string' ? ` (${message.nativeCode})` : ''}`;
        else if (['attach', 'go', 'query', 'stop'].includes(phase)) diagnosticFailure = undefined;
      }
      else if (message.type === 'listening') { clearTimeout(startupTimer); listenResolve(); }
      else if (message.type === 'result' && Number.isSafeInteger(message.id)) {
        if (stopRequests.has(message.id as number) && message.ok === true && message.empty === true) zeroConfirmed = true;
        const item = pending.get(message.id as number); if (!item) continue;
        clearTimeout(item.timer); pending.delete(message.id as number); item.resolve(message);
      } else fail('The owned Job helper returned unknown state evidence.');
    }
  });
  child.stderr.on('data', () => undefined);
  child.once('error', () => fail('The owned Job helper failed. No cleanup completion was proven.'));
  child.once('close', (code, signal) => {
    const boundedCode = Number.isInteger(code) && code !== null && code >= -2147483648 && code <= 4294967295 ? code : undefined;
    observedClose = { observedMs: elapsed(), outcome: signal ? 'signal' : boundedCode === 0 ? 'zero' : boundedCode === undefined ? 'unknown' : 'nonzero',
      ...(boundedCode === undefined ? {} : { exitCode: boundedCode }),
    };
    clearTimeout(startupTimer); closed = true; closeCode = code; closeResolve(); if (!zeroConfirmed || code !== 0) fail('The owned Job helper closed without verified cleanup.');
  });
  // Setup has four fixed bounded lines, not a PowerShell JSON cmdlet cold path.
  // Capabilities remain only in the held stdin pipe, never executable argv.
  child.stdin.write(setup!);
  return job;
}

export function createWorkspaceWindowsJob(pid: number, original: WorkspacePtyIdentity, options: { env?: NodeJS.ProcessEnv } = {}): WorkspaceWindowsJob {
  const job = createPendingWorkspaceWindowsJob(options);
  void job.attach(pid, original).catch(() => undefined);
  return job;
}
