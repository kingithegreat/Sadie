import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { recordPermissionDecision } from './permission-audit-log';

type PermissionResponse = { requestId: string; decision: 'allow_once'|'always_allow'|'cancel'; missingPermissions?: string[] };

const pending = new Map<string, (resp: PermissionResponse) => void>();

if (ipcMain && typeof ipcMain.on === 'function') {
  ipcMain.on('homebot:permission-response', (_ev: IpcMainEvent, data: PermissionResponse) => {
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
}

export const permissionRequester = {
  async request(sender: WebContents, streamId: string | undefined, missingPermissions: string[], reason: string) {
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    return new Promise<PermissionResponse>((resolve) => {
      let settled = false;
      // Record every decision to the audit log exactly once, then resolve.
      // 'expired' distinguishes a timed-out prompt from an explicit Cancel;
      // both still deny, but the history should show which happened.
      const finish = (resp: PermissionResponse, audit: 'allow_once'|'always_allow'|'cancel'|'expired') => {
        if (settled) return;
        settled = true;
        recordPermissionDecision({ permissions: missingPermissions, reason, decision: audit, streamId });
        resolve(resp);
      };

      const timeout = setTimeout(() => {
        pending.delete(requestId);
        finish({ requestId, decision: 'cancel' }, 'expired');
      }, 60000);

      pending.set(requestId, (resp: PermissionResponse) => {
        clearTimeout(timeout);
        finish(resp, resp.decision);
      });

      try {
        sender.send('homebot:permission-request', { requestId, missingPermissions, reason, streamId });
      } catch (e) {
        // If sending fails, resolve as cancel
        clearTimeout(timeout);
        pending.delete(requestId);
        finish({ requestId, decision: 'cancel' }, 'cancel');
      }
    });
  }
};
