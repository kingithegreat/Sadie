import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { recordPermissionDecision } from './permission-audit-log';

/** Read the permission-prompt timeout from settings, clamped to a sane range.
 *  Defensive: any failure (e.g. settings not readable in a test) → 60s default.
 *  Uses a lazy require so this security-critical module has no load-time
 *  dependency on config-manager. */
function resolvePromptTimeoutMs(): number {
  const DEFAULT = 60000;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSettings } = require('./config-manager');
    const raw = (getSettings() as any)?.permissionPromptTimeoutMs;
    if (typeof raw !== 'number' || !isFinite(raw)) return DEFAULT;
    return Math.min(Math.max(raw, 5000), 600000);
  } catch {
    return DEFAULT;
  }
}

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

      // Resolved once so the renderer can tell the user the real deadline —
      // the modal's "declined automatically after about a minute" copy must
      // describe the same timeout that actually fires here.
      const timeoutMs = resolvePromptTimeoutMs();
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        finish({ requestId, decision: 'cancel' }, 'expired');
      }, timeoutMs);

      pending.set(requestId, (resp: PermissionResponse) => {
        clearTimeout(timeout);
        finish(resp, resp.decision);
      });

      try {
        sender.send('homebot:permission-request', { requestId, missingPermissions, reason, streamId, timeoutMs });
      } catch (e) {
        // If sending fails, resolve as cancel
        clearTimeout(timeout);
        pending.delete(requestId);
        finish({ requestId, decision: 'cancel' }, 'cancel');
      }
    });
  }
};
