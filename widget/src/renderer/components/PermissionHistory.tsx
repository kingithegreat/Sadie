import { useEffect, useState } from 'react';
import type { PermissionAuditEntry } from '../../shared/types';

interface PermissionHistoryProps {
  open: boolean;
  onClose: () => void;
}

const DECISION_META: Record<
  PermissionAuditEntry['decision'],
  { label: string; icon: string; type: string }
> = {
  always_allow: { label: 'Always allowed', icon: '✅', type: 'success' },
  allow_once:   { label: 'Allowed once',   icon: '☑️', type: 'info' },
  cancel:       { label: 'Denied',         icon: '❌', type: 'error' },
  expired:      { label: 'Timed out',      icon: '⌛', type: 'warning' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Permission History — a reviewable log of every permission HomeBot has asked
 * for and how the user responded, plus management of the "always allow" grants:
 *  - revoke any permission currently remembered via Always allow
 *  - export the full decision log to a JSON file
 *  - clear the log
 * The transparency + control counterpart to the in-the-moment PermissionModal
 * (issue #6).
 */
export default function PermissionHistory({ open, onClose }: PermissionHistoryProps) {
  const [entries, setEntries] = useState<PermissionAuditEntry[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setExportMsg(null);
    (async () => {
      try {
        const [auditR, settings] = await Promise.all([
          (window as any).electron.readPermissionAudit?.(),
          (window as any).electron.getSettings?.(),
        ]);
        if (cancelled) return;

        const events: PermissionAuditEntry[] =
          auditR && auditR.success && Array.isArray(auditR.events) ? auditR.events : [];
        setEntries([...events].reverse()); // newest first

        // "Always allowed" management set = permissions the user granted via the
        // modal (they appear as always_allow in the log) AND that are still
        // enabled in settings. This naturally excludes read-only safe defaults,
        // which never trigger a permission prompt.
        const grantedViaModal = new Set(
          events.filter((e) => e.decision === 'always_allow').flatMap((e) => e.permissions || []),
        );
        const perms = (settings && settings.permissions) || {};
        setAllowed(
          Object.keys(perms).filter((k) => perms[k] === true && grantedViaModal.has(k)).sort(),
        );
      } catch {
        if (!cancelled) { setEntries([]); setAllowed([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const clear = async () => {
    try {
      await (window as any).electron.clearPermissionAudit?.();
    } catch {
      /* ignore — worst case the list simply doesn't clear */
    }
    setEntries([]);
  };

  const doExport = async () => {
    try {
      const r = await (window as any).electron.exportPermissionAudit?.();
      setExportMsg(r && r.success ? `Exported to ${r.path}` : `Export failed${r?.error ? `: ${r.error}` : ''}`);
    } catch (e) {
      setExportMsg('Export failed');
    }
  };

  const revoke = async (perm: string) => {
    try {
      const settings = await (window as any).electron.getSettings?.();
      const perms = { ...((settings && settings.permissions) || {}) };
      perms[perm] = false;
      await (window as any).electron.saveSettings?.({ permissions: perms });
      setAllowed((prev) => prev.filter((p) => p !== perm));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="notification-history-overlay" onClick={onClose} data-role="permission-history">
      <div
        className="notification-history-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Permission history"
      >
        <div className="notification-history-header">
          <h2>Permission History</h2>
          <div className="notification-history-actions">
            <button className="notif-clear-btn" onClick={doExport}>Export</button>
            {entries.length > 0 && (
              <button className="notif-clear-btn" onClick={clear}>Clear all</button>
            )}
            <button className="close-btn" onClick={onClose} aria-label="Close permission history">×</button>
          </div>
        </div>

        {exportMsg && <div className="perm-hist-export-msg">{exportMsg}</div>}

        {allowed.length > 0 && (
          <div className="perm-allow-section" aria-label="Always-allowed permissions">
            <div className="perm-allow-title">Always allowed — HomeBot won't ask again</div>
            {allowed.map((p) => (
              <div key={p} className="perm-allow-item">
                <span className="perm-allow-name">{p.replace(/_/g, ' ')}</span>
                <button className="perm-allow-revoke" onClick={() => revoke(p)} aria-label={`Revoke ${p.replace(/_/g, ' ')}`}>Revoke</button>
              </div>
            ))}
          </div>
        )}

        <div className="notification-history-list">
          {loading ? (
            <div className="notif-empty">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="notif-empty">No permission requests recorded yet</div>
          ) : (
            entries.map((e) => {
              const meta = DECISION_META[e.decision] || DECISION_META.cancel;
              const perms = (e.permissions || []).map((p) => p.replace(/_/g, ' ')).join(', ') || '—';
              return (
                <div key={e.id} className={`notif-item notif-${meta.type}`}>
                  <span className="notif-icon" aria-hidden="true">{meta.icon}</span>
                  <span className="notif-message">
                    <strong>{perms}</strong> — {meta.label}
                    {e.reason ? <span className="perm-hist-reason"> · {e.reason}</span> : null}
                  </span>
                  <span className="notif-time">{formatTime(e.timestamp)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
