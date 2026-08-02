/**
 * Production console gate.
 *
 * The main process makes 460+ raw `console.log/debug/info` calls. In a packaged
 * build these ship to end users as startup/runtime noise and needless work with
 * no benefit — the important diagnostics already go through the file logger
 * (`logger.ts`) and telemetry logs. This gate silences verbose console output in
 * production while always preserving `console.warn` and `console.error`.
 *
 * Escape hatch: set `HOMEBOT_DEBUG_CONSOLE=1` to keep full console output in a
 * packaged build when debugging a user-reported issue.
 *
 * Call `installConsoleGate()` once, as early as possible in main startup.
 */

let installed = false;
let restoreFn: (() => void) | null = null;

export interface ConsoleGateOptions {
  /** Force production (true) or dev (false) behavior. Auto-detected when omitted. */
  production?: boolean;
  /** Keep full console output even in production (overrides suppression). */
  forceVerbose?: boolean;
}

/**
 * Whether we're running as a packaged/production build. Detects via NODE_ENV or
 * Electron's `app.isPackaged`. Electron is required lazily so this stays usable
 * (and testable) outside an Electron context.
 */
export function isProductionRuntime(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (electron && electron.app && electron.app.isPackaged) return true;
  } catch {
    // Not running inside Electron — treat as non-production.
  }
  return false;
}

/**
 * Install the gate. In production (and when not force-verbose) this replaces
 * `console.log/debug/info` with no-ops, leaving `warn`/`error` intact. Returns
 * `true` if suppression was applied, `false` otherwise (dev, verbose, or already
 * installed). Idempotent.
 */
export function installConsoleGate(opts: ConsoleGateOptions = {}): boolean {
  if (installed) return false;

  const verbose = opts.forceVerbose ?? process.env.HOMEBOT_DEBUG_CONSOLE === '1';
  const production = isProductionRuntime(opts.production);

  if (!production || verbose) {
    // Dev build, or explicitly verbose: leave the console untouched.
    return false;
  }

  const original = {
    log: console.log,
    debug: console.debug,
    info: console.info,
  };
  const noop = (): void => {};

  console.log = noop;
  console.debug = noop;
  console.info = noop;
  // console.warn and console.error are intentionally preserved.

  restoreFn = () => {
    console.log = original.log;
    console.debug = original.debug;
    console.info = original.info;
  };
  installed = true;
  return true;
}

/** Test-only: restore the original console methods and reset install state. */
export function __resetConsoleGate(): void {
  if (restoreFn) restoreFn();
  restoreFn = null;
  installed = false;
}
