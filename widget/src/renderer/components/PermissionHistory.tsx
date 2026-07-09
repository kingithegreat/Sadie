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
 * for and how the user responded. The transparency counterpart to the in-the-
 * moment PermissionModal (issue #6). Data comes from the main-process audit log
 * via electron.readPermissionAudit(); "Clear all" wipes it.
 */
export default function PermissionHistory({ open, onClose }: PermissionHistoryProps) {
  const [entries, setEntries] = useState<PermissionAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await (window as any).electron.readPermissionAudit?.();
        if (cancelled) return;
        if (r && r.success && Array.isArray(r.events)) {
          // Newest first for review.
          setEntries([...r.events].reverse());
        } else {
          setEntries([]);
        }
      } catch {
        if (!cancelled) setEntries([]);
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
            {entries.length > 0 && (
              <button className="notif-clear-btn" onClick={clear}>Clear all</button>
            )}
            <button className="close-btn" onClick={onClose} aria-label="Close permission history">×</button>
          </div>
        </div>
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
