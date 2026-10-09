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
    _ptyNative: { kill(id: number, useConptyDll: boolean): void };
    readonly innerPid: number;
    onError(callback: (error: Error) => void): { dispose(): void };
    _pendingPtyInfo?: unknown;
    _clearConnectionTimeout(): void;
    _inSocket: { destroy(): void };
    _outSocket: { destroy(): void };
    _conoutSocketWorker: {
      dispose(): void;
      onReady(callback: () => void): { dispose(): void };
      _worker: EventEmitter & { threadId: number; terminate(): Promise<number> };
    };
  };
};

/** Exact node-pty 1.2.0-beta.15 adapter; no public kill's deferred PID-list sweep. */
export function ownedWindowsPty(native: NativePty, binding: { kill(id: number, useConptyDll: boolean): void }): OwnedPtyProcess {
  const agent = native._agent;
  const connection = agent?._conoutSocketWorker;
  const worker = connection?._worker;
  const baton = native._pty;
  const incompatible = new Error('The installed terminal package does not support verified startup and owned worker cleanup.');
  const nativeKill = binding.kill;
  let consoleClosed = false;
  let observesVendorClose = false;
  const closeConsole = () => {
    if (!observesVendorClose || !Number.isInteger(baton)) throw incompatible;
    if (consoleClosed) return;
    nativeKill.call(binding, baton, false);
    // Only a successfully observed call owns this receipt. Vendor errors are
    // swallowed before onError, so that event alone cannot prove native close.
    consoleClosed = true;
  };
  // beta.15 closes the console itself before reporting failed connection or
  // worker startup. Interpose only THIS agent's binding reference, leaving the
  // shared addon untouched; later owned cleanup must not close its HPCON twice.
  const vendorBinding = agent && Object.getOwnPropertyDescriptor(agent, '_ptyNative');
  if (vendorBinding?.value === binding && vendorBinding.writable === true && typeof nativeKill === 'function') {
    try {
      const facade = Object.create(null) as typeof binding;
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(binding))) {
        if (name === 'kill') continue;
        const original = descriptor.value;
        Object.defineProperty(facade, name, typeof original === 'function'
          ? { ...descriptor, value: (...args: unknown[]) => Reflect.apply(original, binding, args) }
          : descriptor);
      }
      Object.defineProperty(facade, 'kill', { value: (id: number, useConptyDll: boolean) => {
        if (id !== baton || useConptyDll !== false) throw incompatible;
        closeConsole();
      } });
      Object.defineProperty(agent, '_ptyNative', { ...vendorBinding, value: facade });
      observesVendorClose = agent._ptyNative === facade;
    } catch { /* Unknown immutable agent binding cannot grant a close receipt. */ }
  }
  const hasWorker = !!worker && typeof worker.once === 'function' && typeof worker.threadId === 'number';
  const compatible = observesVendorClose && hasWorker && typeof connection.dispose === 'function' && typeof connection.onReady === 'function' && typeof agent.onError === 'function' && typeof agent._clearConnectionTimeout === 'function' && Number.isInteger(baton);
  // An incompatible spawn still has ownership: return a failed ready adapter so
  // the manager retains and joins its available captured worker on cleanup.
  let workerExited = hasWorker && worker.threadId === -1;
  let resolveWorker!: () => void;
  let rejectReady!: (error: Error) => void;
  const workerExit = new Promise<void>(resolve => { resolveWorker = resolve; });
  if (workerExited) resolveWorker();
  if (hasWorker) worker.once('exit', () => {
    workerExited = true; resolveWorker();
    rejectReady?.(new Error('The terminal output worker exited before the shell was ready.'));
  });
  let readyListener: { dispose(): void } | undefined;
  let errorListener: { dispose(): void } | undefined;
  const failReady = (error: Error) => rejectReady(error);
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    if (!compatible) { reject(incompatible); return; }
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
  let disposal: Promise<void> | undefined;
  let disposeFailed = false;
  return {
    // WindowsTerminal updates its public cached pid later at ready_datapipe.
    // The agent already holds the actual shell PID after its READY callback.
    get pid() { return agent?.innerPid ?? native.pid; }, ready,
    write: (...args) => native.write(...args), resize: (...args) => native.resize(...args),
    onData: (...args) => native.onData(...args), onExit: (...args) => native.onExit(...args),
    kill: () => {
      if (killing) return killing;
      // Cancel the held agent's pending connect before disposing its held worker.
      if (agent) agent._pendingPtyInfo = undefined;
      if (typeof agent?._clearConnectionTimeout === 'function') agent._clearConnectionTimeout();
      rejectReady(new Error('Terminal startup was cancelled.'));
      let failure: unknown;
      let termination: Promise<number> | undefined;
      try {
        if (!consoleClosed) {
          closeConsole();
        }
      } catch (error) { failure = error; }
      try {
        if (!hasWorker) throw new Error('The spawned terminal worker cannot be identified. Its cleanup ownership is retained.');
        if (!disposal) {
          if (!disposeFailed && typeof connection?.dispose === 'function' && connection._worker === worker) connection.dispose();
          else if (typeof worker.terminate === 'function') termination = worker.terminate();
          else throw incompatible;
          const release = termination ? termination.then(() => workerExit) : workerExit;
          disposal = release;
          void release.catch(() => { if (disposal === release) disposal = undefined; });
        }
      } catch (error) { disposeFailed = true; failure ??= error; }
      if ((agent?.innerPid ?? native.pid) <= 0) { agent?._inSocket?.destroy(); agent?._outSocket?.destroy(); }
      // dispose() schedules a drain and asynchronous terminate(); its void return
      // is not proof of release. Wait for THIS captured Worker's actual exit.
      // Failed cleanup can be retried against these SAME captured objects.
      // Successful/pending disposal stays memoized, so it is not terminated twice.
      const attempt = failure ? Promise.reject<void>(failure) : disposal!;
      killing = attempt;
      void attempt.catch(() => { if (killing === attempt) killing = undefined; });
      return attempt;
    },
  };
}
