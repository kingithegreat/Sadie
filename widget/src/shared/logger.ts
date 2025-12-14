// Simple logger wrapper so we can toggle debug logs in production/dev
const isDebug = (() => {
  try {
    // In main process, process.env may be set
    if (typeof process !== 'undefined' && process?.env && (process.env.SADIE_DEBUG === 'true' || process.env.NODE_ENV !== 'production')) return true;
  } catch (e) {}
  try {
    // In renderer, allow localStorage toggle
    if (typeof window !== 'undefined' && (window as any).localStorage) {
      const v = (window as any).localStorage.getItem('sadie:debug');
      if (v === 'true') return true;
    }
  } catch (e) {}
  return false;
})();

export const debug = (...args: any[]) => {
  if (!isDebug) return;
  try { console.debug('[SADIE]', ...args); } catch (e) {}
};

export const info = (...args: any[]) => {
  try { console.info('[SADIE]', ...args); } catch (e) {}
};

export const warn = (...args: any[]) => {
  try { console.warn('[SADIE]', ...args); } catch (e) {}
};

export const error = (...args: any[]) => {
  try { console.error('[SADIE]', ...args); } catch (e) {}
};

export default { debug, info, warn, error };
