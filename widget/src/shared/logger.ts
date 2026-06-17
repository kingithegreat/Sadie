// Simple logger wrapper so we can toggle debug logs in production/dev

/** Catch handler for fire-and-forget ops — uses stderr to avoid infinite recursion in logger */
function safeCatch(e: unknown) { try { process.stderr?.write?.(`[HomeBot-LOGGER] ${String(e)}\n`); } catch {} }

const isDebug = (() => {
  try {
    // In main process, process.env may be set
    if (typeof process !== 'undefined' && process?.env && (process.env.HOMEBOT_DEBUG === 'true' || process.env.NODE_ENV !== 'production')) return true;
  } catch (e) { safeCatch(e); }
  try {
    // In renderer, allow localStorage toggle
    if (typeof window !== 'undefined' && (window as any).localStorage) {
      const v = (window as any).localStorage.getItem('homebot:debug');
      if (v === 'true') return true;
    }
  } catch (e) { safeCatch(e); }
  return false;
})();

export const debug = (...args: any[]) => {
  if (!isDebug) return;
  try { console.debug('[HomeBot]', ...args); } catch (e) { safeCatch(e); }
};

export const info = (...args: any[]) => {
  try { console.info('[HomeBot]', ...args); } catch (e) { safeCatch(e); }
};

export const warn = (...args: any[]) => {
  try { console.warn('[HomeBot]', ...args); } catch (e) { safeCatch(e); }
};

export const error = (...args: any[]) => {
  try { console.error('[HomeBot]', ...args); } catch (e) { safeCatch(e); }
};

export default { debug, info, warn, error };
