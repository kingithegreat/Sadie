import { ipcMain, IpcMainEvent, WebContents } from 'electron';

type PermissionResponse = { requestId: string; decision: 'allow_once'|'always_allow'|'cancel'; missingPermissions?: string[] };

const pending = new Map<string, (resp: PermissionResponse) => void>();

ipcMain.on('sadie:permission-response', (_ev: IpcMainEvent, data: PermissionResponse) => {
  try {
    const resolver = pending.get(data.requestId);
    if (resolver) {
      resolver(data);
      pending.delete(data.requestId);
    }
  } catch (e) {
    // ignore
  }
});

export const permissionRequester = {
  async request(sender: WebContents, streamId: string | undefined, missingPermissions: string[], reason: string) {
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    return new Promise<PermissionResponse>((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        resolve({ requestId, decision: 'cancel' });
      }, 60000);

      pending.set(requestId, (resp: PermissionResponse) => {
        clearTimeout(timeout);
        resolve(resp);
      });

      try {
        sender.send('sadie:permission-request', { requestId, missingPermissions, reason, streamId });
      } catch (e) {
        // If sending fails, resolve as cancel
        clearTimeout(timeout);
        pending.delete(requestId);
        resolve({ requestId, decision: 'cancel' });
      }
    });
  }
};
