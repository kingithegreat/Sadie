import { ipcMain } from 'electron';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[HomeBot-CATCH]', e); }

export function applyIpcHandlePatch() {
  // Avoid reapplying the patch
  if ((global as any).__HOMEBOT_IPC_HANDLE_PATCHED) return;

  const originalHandle = (ipcMain as any).handle.bind(ipcMain);
  const registered = new Set<string>();

  (ipcMain as any).handle = (channel: string, listener: any) => {
    if (registered.has(channel)) {
      console.warn(`[IPC] Ignoring duplicate handler registration for '${channel}'`);
      try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER.push(`[IPC] Ignoring duplicate handler registration for '${channel}'`); } catch (e) { safeCatch(e); }
      return;
    }
    registered.add(channel);
    return originalHandle(channel, listener);
  };

  (global as any).__HOMEBOT_IPC_HANDLE_PATCHED = true;
}
