import type { EventEmitter } from 'events';

export interface OwnedPtyProcess {
  readonly pid: number;
  readonly ready?: Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void | Promise<void>;
  onData(callback: (data: string) => void): { dispose(): void };
  onExit(callback: (event: { exitCode: number }) => void): { dispose(): void };
}

type NativePty = OwnedPtyProcess & EventEmitter & {
  _pty: number;
  _agent: {
    readonly innerPid: number;
    onError(callback: (error: Error) => void): { dispose(): void };
    _pendingPtyInfo?: unknown;
    _clearConnectionTimeout(): void;
    _inSocket: { destroy(): void };
    _outSocket: { destroy(): void };
    _conoutSocketWorker: {
      dispose(): void;
      onReady(callback: () => void): { dispose(): void };
      _worker: EventEmitter & { threadId: number };
    };
  };
};

/** Exact node-pty 1.2.0-beta.15 adapter; no public kill's deferred PID-list sweep. */
export function ownedWindowsPty(native: NativePty, binding: { kill(id: number, useConptyDll: boolean): void }): OwnedPtyProcess {
  const agent = native._agent;
  const connection = agent?._conoutSocketWorker;
  const worker = connection?._worker;
  const baton = native._pty;
  if (!worker || typeof worker.on !== 'function' || typeof connection.dispose !== 'function' || typeof connection.onReady !== 'function' || typeof agent.onError !== 'function' || typeof agent._clearConnectionTimeout !== 'function' || !Number.isInteger(baton)) {
    // Do not guess a PID or silently continue with an incompatible native package.
    if (Number.isInteger(baton)) binding.kill(baton, false);
    throw new Error('The installed terminal package does not support verified startup and owned worker cleanup.');
  }
  let workerExited = worker.threadId === -1;
  let resolveWorker!: () => void;
  let rejectReady!: (error: Error) => void;
  const workerExit = new Promise<void>(resolve => { resolveWorker = resolve; });
  if (workerExited) resolveWorker();
  worker.once('exit', () => {
    workerExited = true; resolveWorker();
    rejectReady?.(new Error('The terminal output worker exited before the shell was ready.'));
  });
  let readyListener: { dispose(): void } | undefined;
  let errorListener: { dispose(): void } | undefined;
  const failReady = (error: Error) => rejectReady(error);
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    if (workerExited) { reject(new Error('The terminal output worker has already exited.')); return; }
    if (Number.isSafeInteger(agent.innerPid) && agent.innerPid > 0) { resolve(); return; }
    errorListener = agent.onError(failReady);
    readyListener = connection.onReady(() => {
      // Vendor's earlier READY listener connects the shell before this listener.
      if (Number.isSafeInteger(agent.innerPid) && agent.innerPid > 0) resolve();
      else reject(new Error('The terminal worker became ready without a valid shell process.'));
    });
  });
  const clearReady = () => { readyListener?.dispose(); errorListener?.dispose(); };
  void ready.then(clearReady, clearReady);
  let killing: Promise<void> | undefined;
  return {
    // WindowsTerminal updates its public cached pid later at ready_datapipe.
    // The agent already holds the actual shell PID after its READY callback.
    get pid() { return agent.innerPid; }, ready,
    write: native.write.bind(native), resize: native.resize.bind(native),
    onData: native.onData.bind(native), onExit: native.onExit.bind(native),
    kill: () => {
      if (killing) return killing;
      // Cancel the held agent's pending connect before disposing its held worker.
      agent._pendingPtyInfo = undefined;
      agent._clearConnectionTimeout();
      rejectReady(new Error('Terminal startup was cancelled.'));
      let failure: unknown;
      try { binding.kill(baton, false); } catch (error) { failure = error; }
      try { connection.dispose(); } catch (error) { failure ??= error; }
      if (agent.innerPid <= 0) { agent._inSocket.destroy(); agent._outSocket.destroy(); }
      // dispose() schedules a drain and asynchronous terminate(); its void return
      // is not proof of release. Wait for THIS captured Worker's actual exit.
      killing = workerExit.then(() => { if (failure) throw failure; });
      return killing;
    },
  };
}
