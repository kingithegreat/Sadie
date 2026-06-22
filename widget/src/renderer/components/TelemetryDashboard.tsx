import { useEffect, useState, useMemo } from 'react';

type Tab = 'overview' | 'tools' | 'events' | 'conversations';

interface PerToolStats {
  count: number;
  success: number;
  errors: number;
  cancelled: number;
  p50_ms: number;
  p95_ms: number;
  errorTypes: Record<string, number>;
}

interface ToolCallStats {
  totalCalls: number;
  successRate: number;
  perTool: Record<string, PerToolStats>;
}

interface AnalyticsSummary {
  conversationCount: number;
  totalMessages: number;
  avgMessagesPerConversation: number;
  oldestConversation: string | null;
  toolCallStats?: ToolCallStats;
}

export default function TelemetryDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<any[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const [telemetry, analytics] = await Promise.all([
          (window as any).electron.readTelemetryEvents?.(),
          (window as any).electron.getAnalyticsSummary?.(),
        ]);
        if (telemetry && telemetry.success && Array.isArray(telemetry.events)) {
          setEvents(telemetry.events.reverse());
        } else {
          setEvents([]);
        }
        if (analytics && analytics.success && analytics.summary) {
          setSummary(analytics.summary);
        }
      } catch (e: any) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const counts = useMemo(() =>
    events.reduce((acc: Record<string, number>, ev) => {
      acc[ev.event] = (acc[ev.event] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  [events]);

  const toolBreakdown = useMemo(() => {
    const tools: Record<string, number> = {};
    for (const ev of events) {
      if (ev.event === 'tool_call' && ev.details?.tool) {
        tools[ev.details.tool] = (tools[ev.details.tool] || 0) + 1;
      }
    }
    return Object.entries(tools).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const hourlyActivity = useMemo(() => {
    const now = Date.now();
    const buckets = new Array(24).fill(0);
    for (const ev of events) {
      const t = new Date(ev.timestamp).getTime();
      const hoursAgo = Math.floor((now - t) / 3600000);
      if (hoursAgo >= 0 && hoursAgo < 24) {
        buckets[23 - hoursAgo]++;
      }
    }
    return buckets;
  }, [events]);
  const maxHourly = Math.max(1, ...hourlyActivity);

  const uptime = useMemo(() => {
    if (events.length === 0) return null;
    const earliest = events[events.length - 1]?.timestamp;
    if (!earliest) return null;
    const ms = Date.now() - new Date(earliest).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }, [events]);

  if (!open) return null;

  const tabClass = (t: Tab) => `td-tab ${tab === t ? 'td-tab-active' : ''}`;

  return (
    <div className="td-overlay" data-testid="analytics-overlay">
      <div className="td-container">
        {/* Header */}
        <div className="td-header">
          <div className="td-header-info">
            <div className="td-title">📊 Analytics Dashboard</div>
            <div className="td-subtitle">Local analytics — all data stays on your machine</div>
          </div>
          <button className="td-close-btn" onClick={onClose}>Close</button>
        </div>

        {/* Tabs */}
        <div className="td-tab-bar">
          <button className={tabClass('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button className={tabClass('tools')} onClick={() => setTab('tools')}>Tools</button>
          <button className={tabClass('events')} onClick={() => setTab('events')}>Events</button>
          <button className={tabClass('conversations')} onClick={() => setTab('conversations')}>Conversations</button>
        </div>

        {/* Content */}
        <div className="td-content">
          {loading && <div className="td-empty">Loading…</div>}
          {error && <div className="td-rate-bad">{error}</div>}

          {!loading && !error && tab === 'overview' && (
            <>
              {/* Stat cards */}
              <div className="td-stat-grid td-stat-grid-4">
                <div className="td-stat-card">
                  <div className="td-stat-label">Total events</div>
                  <div className="td-stat-value">{events.length}</div>
                </div>
                <div className="td-stat-card">
                  <div className="td-stat-label">Stream failures</div>
                  <div className="td-stat-value">{counts['stream_failure'] || 0}</div>
                </div>
                <div className="td-stat-card">
                  <div className="td-stat-label">Tool calls</div>
                  <div className="td-stat-value">{counts['tool_call'] || 0}</div>
                </div>
                <div className="td-stat-card">
                  <div className="td-stat-label">Unique event types</div>
                  <div className="td-stat-value">{Object.keys(counts).length}</div>
                </div>
              </div>

              {/* Uptime */}
              {uptime && (
                <div className="td-uptime">
                  <span className="td-uptime-label">Session uptime:</span>
                  <span className="td-uptime-value">{uptime}</span>
                </div>
              )}

              {/* Activity timeline */}
              <div className="td-section">
                <div className="td-section-label">Activity — last 24 hours</div>
                <div className="td-activity-chart" data-testid="activity-chart">
                  {hourlyActivity.map((val, i) => (
                    <div
                      key={i}
                      className="td-activity-bar"
                      style={{ height: `${(val / maxHourly) * 100}%`, minHeight: val > 0 ? 2 : 0, opacity: val > 0 ? 1 : 0.15 }}
                      title={`${val} events`}
                    />
                  ))}
                </div>
                <div className="td-activity-labels">
                  <span>24h ago</span><span>now</span>
                </div>
              </div>

              {/* Top tools */}
              {toolBreakdown.length > 0 && (
                <div className="td-section">
                  <div className="td-section-label">Top tools</div>
                  <div className="td-tool-list">
                    {toolBreakdown.slice(0, 8).map(([name, count]) => (
                      <div key={name} className="td-tool-row">
                        <span className="td-tool-name" title={name}>{name}</span>
                        <div className="td-tool-bar-track">
                          <div className="td-tool-bar-fill" style={{ width: `${(count / toolBreakdown[0][1]) * 100}%` }} />
                        </div>
                        <span className="td-tool-count">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Event type distribution */}
              {Object.keys(counts).length > 0 && (
                <div className="td-section">
                  <div className="td-section-label">Event distribution</div>
                  <div className="td-event-pills">
                    {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                      <span key={name} className="td-event-pill">
                        {name}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && !error && tab === 'tools' && (
            <>
              {summary?.toolCallStats && summary.toolCallStats.totalCalls > 0 ? (
                <>
                  <div className="td-stat-grid td-stat-grid-2">
                    <div className="td-stat-card">
                      <div className="td-stat-label">Total tool calls</div>
                      <div className="td-stat-value">{summary.toolCallStats.totalCalls}</div>
                    </div>
                    <div className="td-stat-card">
                      <div className="td-stat-label">Overall success rate</div>
                      <div className="td-stat-value">
                        {(summary.toolCallStats.successRate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="td-section-label">Per-tool breakdown</div>
                  <div className="td-table-wrap" data-testid="tool-aggregates-table">
                    <table className="td-table">
                      <thead>
                        <tr>
                          <th>Tool</th>
                          <th className="td-align-right">Calls</th>
                          <th className="td-align-right">Success</th>
                          <th className="td-align-right">Errors</th>
                          <th className="td-align-right">Cancelled</th>
                          <th className="td-align-right">p50</th>
                          <th className="td-align-right">p95</th>
                          <th>Error types</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(summary.toolCallStats.perTool)
                          .sort((a, b) => b[1].count - a[1].count)
                          .map(([name, t]) => {
                            const rate = t.count > 0 ? t.success / t.count : 0;
                            const rateClass = rate >= 0.95 ? 'td-rate-good' : rate >= 0.8 ? 'td-rate-warn' : 'td-rate-bad';
                            const errList = Object.entries(t.errorTypes || {})
                              .sort((a, b) => b[1] - a[1])
                              .map(([k, v]) => `${k}:${v}`)
                              .join(', ');
                            return (
                              <tr key={name}>
                                <td className="td-truncate" title={name}>{name}</td>
                                <td className="td-align-right">{t.count}</td>
                                <td className={`td-align-right ${rateClass}`}>
                                  {t.success} ({(rate * 100).toFixed(0)}%)
                                </td>
                                <td className="td-align-right">{t.errors}</td>
                                <td className="td-align-right td-muted">{t.cancelled}</td>
                                <td className="td-align-right td-muted">{t.p50_ms}ms</td>
                                <td className="td-align-right td-muted">{t.p95_ms}ms</td>
                                <td className="td-error-types td-truncate" title={errList}>{errList || '—'}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="td-empty">No tool calls recorded yet. Run some queries and come back.</div>
              )}
            </>
          )}

          {!loading && !error && tab === 'events' && (
            <>
              <div className="td-section-label">Recent events (most recent first)</div>
              <div className="td-event-list-wrap">
                {events.length === 0 && <div className="td-empty">No telemetry events recorded.</div>}
                {events.map((e, idx) => (
                  <div key={idx} className="td-event-item">
                    <div><span className="td-event-timestamp">{new Date(e.timestamp).toLocaleString()}</span> — <span className="td-event-name">{e.event}</span></div>
                    <pre className="td-event-pre">{JSON.stringify(e.details || {}, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </>
          )}

          {!loading && !error && tab === 'conversations' && (
            <>
              {summary ? (
                <div className="td-stat-grid td-stat-grid-2">
                  <div className="td-stat-card">
                    <div className="td-stat-label">Total conversations</div>
                    <div className="td-stat-value">{summary.conversationCount}</div>
                  </div>
                  <div className="td-stat-card">
                    <div className="td-stat-label">Total messages</div>
                    <div className="td-stat-value">{summary.totalMessages}</div>
                  </div>
                  <div className="td-stat-card">
                    <div className="td-stat-label">Avg messages / conversation</div>
                    <div className="td-stat-value">{summary.avgMessagesPerConversation}</div>
                  </div>
                  <div className="td-stat-card">
                    <div className="td-stat-label">First conversation</div>
                    <div className="td-stat-value-lg">{summary.oldestConversation ? new Date(summary.oldestConversation).toLocaleDateString() : '—'}</div>
                  </div>
                </div>
              ) : (
                <div className="td-empty">No conversation data available.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
