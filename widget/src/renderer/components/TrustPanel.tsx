import { useEffect, useState } from 'react';

/**
 * TrustPanel (Phase 2 — trust layer, slice 1: Activity & Health)
 *
 * Read-only surface answering two questions in one place:
 *   1. "Is everything SADIE depends on actually up right now?" — live service
 *      health from the Phase 0 supervisor (ollama / n8n / qdrant), updated in
 *      real time from `homebot:supervisor-status` pushes.
 *   2. "What has SADIE changed in my CRM?" — the append-only audit trail,
 *      summarized to human lines with expandable field-level diffs.
 *
 * Mirrors PermissionHistory's modal pattern and styles.
 */

interface ServiceStatusView {
  name: string;
  health: 'healthy' | 'degraded' | 'recovering' | 'down';
  required: boolean;
  totalRecoveries: number;
  lastOkAt: number | null;
}

interface ActivityChange {
  field: string;
  from: string;
  to: string;
}

interface ActivityItem {
  id: number;
  at: string;
  summary: string;
  toolName: string;
  actor: string;
  changes: ActivityChange[];
}

interface BatchCallOutcomeView {
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

interface BatchSummaryView {
  kind: 'executed' | 'blocked';
  at: string;
  total: number;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
  calls: BatchCallOutcomeView[];
  missingPermissions?: string[];
}

interface TrustPanelProps {
  open: boolean;
  onClose: () => void;
}

const MAX_BATCHES_SHOWN = 20;

function formatBatchDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function batchLine(b: BatchSummaryView): string {
  const tools = `${b.total} tool${b.total === 1 ? '' : 's'}`;
  if (b.kind === 'blocked') {
    return `Blocked — ${tools} needed: ${(b.missingPermissions ?? []).join(', ') || 'permissions'}`;
  }
  if (b.failed === 0) return `${tools} ran, all ok in ${formatBatchDuration(b.totalDurationMs)}`;
  const firstFail = b.calls.find((c) => !c.ok);
  return `${tools} ran: ${b.succeeded} ok, ${b.failed} failed${firstFail ? ` (${firstFail.name})` : ''} in ${formatBatchDuration(b.totalDurationMs)}`;
}

const HEALTH_DOT: Record<ServiceStatusView['health'], string> = {
  healthy: '🟢',
  degraded: '🟡',
  recovering: '🔵',
  down: '🔴',
};

function agoLabel(ts: number | null): string {
  if (ts === null) return 'not yet probed';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return `ok ${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `ok ${m}m ago` : `ok ${Math.round(m / 60)}h ago`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function TrustPanel({ open, onClose }: TrustPanelProps) {
  const [services, setServices] = useState<ServiceStatusView[]>([]);
  const [supervisionOff, setSupervisionOff] = useState(false);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [batches, setBatches] = useState<BatchSummaryView[]>([]);
  const [expandedBatch, setExpandedBatch] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [statusR, activityR, batchesR] = await Promise.all([
        (window as any).electron.getSupervisorStatus?.(),
        (window as any).electron.getCrmActivity?.(50),
        (window as any).electron.getBatchSummaries?.(),
      ]);
      if (statusR && statusR.success) {
        if (statusR.status && Array.isArray(statusR.status.services)) {
          setServices(statusR.status.services);
          setSupervisionOff(false);
        } else {
          setServices([]);
          setSupervisionOff(true);
        }
      }
      setItems(activityR && activityR.success && Array.isArray(activityR.items) ? activityR.items : []);
      setBatches(
        batchesR && batchesR.success && Array.isArray(batchesR.summaries)
          ? batchesR.summaries.slice(0, MAX_BATCHES_SHOWN)
          : []
      );
    } catch {
      setServices([]);
      setItems([]);
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  // Load on open; live-update the health strip from supervisor pushes.
  useEffect(() => {
    if (!open) return;
    void refresh();
    const unsubscribe = (window as any).electron.onSupervisorStatus?.(() => {
      // A state change happened — re-pull the full snapshot (cheap, read-only).
      (window as any).electron
        .getSupervisorStatus?.()
        .then((r: any) => {
          if (r && r.success && r.status && Array.isArray(r.status.services)) {
            setServices(r.status.services);
          }
        })
        .catch(() => undefined);
    });
    const unsubscribeBatch = (window as any).electron.onBatchSummary?.((summary: BatchSummaryView) => {
      setBatches((prev) => [summary, ...prev].slice(0, MAX_BATCHES_SHOWN));
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      if (typeof unsubscribeBatch === 'function') unsubscribeBatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="notification-history-overlay" onClick={onClose} data-role="trust-panel">
      <div
        className="notification-history-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Trust — activity and health"
      >
        <div className="notification-history-header">
          <h2>Activity &amp; Health</h2>
          <div className="notification-history-actions">
            <button className="notif-clear-btn" onClick={() => void refresh()}>Refresh</button>
            <button className="close-btn" onClick={onClose} aria-label="Close activity and health">×</button>
          </div>
        </div>

        <div className="perm-allow-section" aria-label="Service health">
          <div className="perm-allow-title">Services HomeBot depends on</div>
          {supervisionOff ? (
            <div className="perm-allow-item"><span className="perm-allow-name">Supervision is off in this mode</span></div>
          ) : services.length === 0 ? (
            <div className="perm-allow-item"><span className="perm-allow-name">Loading service health…</span></div>
          ) : (
            services.map((s) => (
              <div key={s.name} className="perm-allow-item" data-service={s.name} data-health={s.health}>
                <span className="perm-allow-name">
                  {HEALTH_DOT[s.health] ?? '⚪'} {s.name} — {s.health}
                  {s.required ? '' : ' (optional)'}
                </span>
                <span className="setting-hint">
                  {agoLabel(s.lastOkAt)}
                  {s.totalRecoveries > 0 ? ` · auto-recovered ×${s.totalRecoveries}` : ''}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="perm-allow-section" aria-label="Recent tool batches">
          <div className="perm-allow-title">Recent tool batches</div>
          {batches.length === 0 ? (
            <div className="perm-allow-item">
              <span className="perm-allow-name">No tool batches this session.</span>
            </div>
          ) : (
            batches.map((b, i) => (
              <div key={`${b.at}-${i}`} className="perm-allow-item" data-batch-kind={b.kind}>
                <div style={{ flex: 1 }}>
                  <div className="perm-allow-name">{b.kind === 'blocked' ? '⛔ ' : ''}{batchLine(b)}</div>
                  <div className="setting-hint">{timeLabel(b.at)}</div>
                  {expandedBatch === i && (
                    <div className="setting-hint" data-role="batch-calls">
                      {b.calls.map((c, j) => (
                        <div key={`${c.name}-${j}`}>
                          {c.ok ? '✓' : '✗'} {c.name} · {formatBatchDuration(c.durationMs)}
                          {c.error ? ` — ${c.error}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {b.calls.length > 0 && (
                  <button
                    className="perm-allow-revoke"
                    onClick={() => setExpandedBatch(expandedBatch === i ? null : i)}
                    aria-label={`${expandedBatch === i ? 'Hide' : 'Show'} batch detail`}
                  >
                    {expandedBatch === i ? 'Hide' : 'Detail'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="notification-history-list" aria-label="CRM activity">
          {loading ? (
            <div className="perm-allow-item"><span className="perm-allow-name">Loading activity…</span></div>
          ) : items.length === 0 ? (
            <div className="perm-allow-item">
              <span className="perm-allow-name">No CRM activity yet — every change HomeBot makes will show here.</span>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="perm-allow-item" data-activity-id={item.id}>
                <div style={{ flex: 1 }}>
                  <div className="perm-allow-name">{item.summary}</div>
                  <div className="setting-hint">
                    {timeLabel(item.at)} · {item.toolName}
                  </div>
                  {expandedId === item.id && item.changes.length > 0 && (
                    <div className="setting-hint" data-role="activity-changes">
                      {item.changes.map((c) => (
                        <div key={c.field}>
                          {c.field}: {c.from} → {c.to}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {item.changes.length > 0 && (
                  <button
                    className="perm-allow-revoke"
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    aria-label={`${expandedId === item.id ? 'Hide' : 'Show'} changed fields`}
                  >
                    {expandedId === item.id ? 'Hide' : `${item.changes.length} field${item.changes.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
