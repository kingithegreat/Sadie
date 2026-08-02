/**
 * trust-ipc.ts (Phase 2 — trust layer)
 *
 * Read-only IPC surface for the Trust panel:
 *   - homebot:get-supervisor-status → live health of ollama/n8n/qdrant from
 *     the Phase 0 supervisor (null when supervision is off, e.g. E2E)
 *   - homebot:get-crm-activity     → recent CRM audit_log rows summarized to
 *     human activity items by the CI-gated root src/trust module
 *
 * Both handlers only read; nothing here can mutate state. Failures degrade to
 * { success: false } rather than throwing across the IPC boundary.
 */

import { ipcMain } from 'electron';
import { summarizeAuditLog, TrustActivityItem } from '../../../src/trust/activity';
import { SupervisorStatus } from '../../../src/supervisor/types';

export const TRUST_CHANNELS = {
  GET_SUPERVISOR_STATUS: 'homebot:get-supervisor-status',
  GET_CRM_ACTIVITY: 'homebot:get-crm-activity',
} as const;

const ACTIVITY_LIMIT_DEFAULT = 50;
const ACTIVITY_LIMIT_MAX = 200;

export interface SupervisorStatusResult {
  success: boolean;
  status: SupervisorStatus | null;
  error?: string;
}

export interface CrmActivityResult {
  success: boolean;
  items: TrustActivityItem[];
  error?: string;
}

/**
 * Register the trust IPC handlers. Call once after the supervisor service has
 * started; `getSupervisorStatus` closes over the live handle (returning null
 * when supervision is disabled). Re-registration replaces prior handlers so
 * tests can call this repeatedly.
 */
export function registerTrustIpc(getSupervisorStatus: () => SupervisorStatus | null): void {
  ipcMain.removeHandler(TRUST_CHANNELS.GET_SUPERVISOR_STATUS);
  ipcMain.removeHandler(TRUST_CHANNELS.GET_CRM_ACTIVITY);

  ipcMain.handle(TRUST_CHANNELS.GET_SUPERVISOR_STATUS, async (): Promise<SupervisorStatusResult> => {
    try {
      return { success: true, status: getSupervisorStatus() };
    } catch (e) {
      return { success: false, status: null, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    TRUST_CHANNELS.GET_CRM_ACTIVITY,
    async (_event, rawLimit?: unknown): Promise<CrmActivityResult> => {
      try {
        const requested = typeof rawLimit === 'number' && isFinite(rawLimit) ? Math.floor(rawLimit) : ACTIVITY_LIMIT_DEFAULT;
        const limit = Math.min(Math.max(requested, 1), ACTIVITY_LIMIT_MAX);
        // Lazy import: keeps this module import-side-effect-free and defers
        // the CRM store (whose constructor lazily loads better-sqlite3) until
        // a renderer actually asks for activity.
        const { getCrmStore } = await import('./tools/crm');
        const items = summarizeAuditLog(getCrmStore().getAuditLog(limit));
        return { success: true, items };
      } catch (e) {
        return { success: false, items: [], error: e instanceof Error ? e.message : String(e) };
      }
    }
  );
}
