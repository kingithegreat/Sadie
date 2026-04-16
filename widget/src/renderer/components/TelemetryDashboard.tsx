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

  // Tool call events breakdown
  const toolBreakdown = useMemo(() => {
    const tools: Record<string, number> = {};
    for (const ev of events) {
      if (ev.event === 'tool_call' && ev.details?.tool) {
        tools[ev.details.tool] = (tools[ev.details.tool] || 0) + 1;
      }
    }
    return Object.entries(tools).sort((a, b) => b[1] - a[1]);
  }, [events]);

  // Activity timeline — messages per hour over last 24h
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

  // Session uptime (time since first event in this session)
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

  const tabStyle = (t: Tab) =>
    `analytics-tab ${tab === t ? 'analytics-tab-active' : ''}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 p-6" data-testid="analytics-overlay">
      <div className="w-full max-w-4xl bg-zinc-900 rounded shadow-lg border border-zinc-800 overflow-hidden" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between" style={{ flexShrink: 0 }}>
          <div>
            <div className="text-lg font-semibold">📊 Analytics Dashboard</div>
            <div className="text-sm text-zinc-400">Local analytics — all data stays on your machine</div>
          </div>
          <div>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-2 border-b border-zinc-800 flex gap-1" style={{ flexShrink: 0 }}>
          <button className={tabStyle('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button className={tabStyle('tools')} onClick={() => setTab('tools')}>Tools</button>
          <button className={tabStyle('events')} onClick={() => setTab('events')}>Events</button>
          <button className={tabStyle('conversations')} onClick={() => setTab('conversations')}>Conversations</button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
          {loading && <div>Loading…</div>}
          {error && <div className="text-red-400">{error}</div>}

          {!loading && !error && tab === 'overview' && (
            <>
              {/* Stat cards */}
              <div className="mb-4 grid grid-cols-4 gap-3">
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Total events</div>
                  <div className="text-2xl font-semibold">{events.length}</div>
                </div>
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Stream failures</div>
                  <div className="text-2xl font-semibold">{counts['stream_failure'] || 0}</div>
                </div>
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Tool calls</div>
                  <div className="text-2xl font-semibold">{counts['tool_call'] || 0}</div>
                </div>
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Unique event types</div>
                  <div className="text-2xl font-semibold">{Object.keys(counts).length}</div>
                </div>
              </div>

              {/* Uptime */}
              {uptime && (
                <div className="mb-4 p-3 bg-zinc-800 rounded inline-block">
                  <span className="text-sm text-zinc-400 mr-2">Session uptime:</span>
                  <span className="font-semibold">{uptime}</span>
                </div>
              )}

              {/* Activity timeline (24h bar chart) */}
              <div className="mb-4">
                <div className="text-sm text-zinc-400 mb-2">Activity — last 24 hours</div>
                <div className="flex items-end gap-px" style={{ height: 64 }} data-testid="activity-chart">
                  {hourlyActivity.map((val, i) => (
                    <div
                      key={i}
                      className="bg-cyan-500 rounded-t"
                      style={{ flex: 1, height: `${(val / maxHourly) * 100}%`, minHeight: val > 0 ? 2 : 0, opacity: val > 0 ? 1 : 0.15 }}
                      title={`${val} events`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-zinc-500 mt-1">
                  <span>24h ago</span><span>now</span>
                </div>
              </div>

              {/* Top tools */}
              {toolBreakdown.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm text-zinc-400 mb-2">Top tools</div>
                  <div className="space-y-1">
                    {toolBreakdown.slice(0, 8).map(([name, count]) => (
                      <div key={name} className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-300 w-40 truncate" title={name}>{name}</span>
                        <div className="flex-1 bg-zinc-800 rounded h-4 overflow-hidden">
                          <div className="bg-cyan-600 h-full rounded" style={{ width: `${(count / toolBreakdown[0][1]) * 100}%` }} />
                        </div>
                        <span className="text-zinc-400 w-8 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Event type distribution */}
              {Object.keys(counts).length > 0 && (
                <div>
                  <div className="text-sm text-zinc-400 mb-2">Event distribution</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                      <span key={name} className="px-2 py-1 bg-zinc-800 rounded text-xs">
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
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div className="p-3 bg-zinc-800 rounded">
                      <div className="text-sm text-zinc-400">Total tool calls</div>
                      <div className="text-2xl font-semibold">{summary.toolCallStats.totalCalls}</div>
                    </div>
                    <div className="p-3 bg-zinc-800 rounded">
                      <div className="text-sm text-zinc-400">Overall success rate</div>
                      <div className="text-2xl font-semibold">
                        {(summary.toolCallStats.successRate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="text-sm text-zinc-400 mb-2">Per-tool breakdown</div>
                  <div className="rounded border border-zinc-800 overflow-hidden" data-testid="tool-aggregates-table">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-800 text-zinc-400">
                        <tr>
                          <th className="text-left px-3 py-2">Tool</th>
                          <th className="text-right px-3 py-2">Calls</th>
                          <th className="text-right px-3 py-2">Success</th>
                          <th className="text-right px-3 py-2">Errors</th>
                          <th className="text-right px-3 py-2">Cancelled</th>
                          <th className="text-right px-3 py-2">p50</th>
                          <th className="text-right px-3 py-2">p95</th>
                          <th className="text-left px-3 py-2">Error types</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(summary.toolCallStats.perTool)
                          .sort((a, b) => b[1].count - a[1].count)
                          .map(([name, t]) => {
                            const rate = t.count > 0 ? t.success / t.count : 0;
                            const rateColor = rate >= 0.95 ? 'text-emerald-400' : rate >= 0.8 ? 'text-yellow-400' : 'text-red-400';
                            const errList = Object.entries(t.errorTypes || {})
                              .sort((a, b) => b[1] - a[1])
                              .map(([k, v]) => `${k}:${v}`)
                              .join(', ');
                            return (
                              <tr key={name} className="border-t border-zinc-800">
                                <td className="px-3 py-2 text-zinc-200 truncate" title={name}>{name}</td>
                                <td className="px-3 py-2 text-right">{t.count}</td>
                                <td className={`px-3 py-2 text-right ${rateColor}`}>
                                  {t.success} ({(rate * 100).toFixed(0)}%)
                                </td>
                                <td className="px-3 py-2 text-right">{t.errors}</td>
                                <td className="px-3 py-2 text-right text-zinc-400">{t.cancelled}</td>
                                <td className="px-3 py-2 text-right text-zinc-400">{t.p50_ms}ms</td>
                                <td className="px-3 py-2 text-right text-zinc-400">{t.p95_ms}ms</td>
                                <td className="px-3 py-2 text-xs text-zinc-500 truncate" title={errList}>{errList || '—'}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="text-zinc-500">No tool calls recorded yet. Run some queries and come back.</div>
              )}
            </>
          )}

          {!loading && !error && tab === 'events' && (
            <>
              <div className="mb-3 text-sm text-zinc-400">Recent events (most recent first)</div>
              <div className="rounded bg-zinc-900 border border-zinc-800 p-2 telemetry-event-list">
                {events.length === 0 && <div className="text-zinc-500">No telemetry events recorded.</div>}
                {events.map((e, idx) => (
                  <div key={idx} className="p-2 border-b border-zinc-800 last:border-b-0 text-sm">
                    <div className="text-zinc-400">{new Date(e.timestamp).toLocaleString()} — <strong>{e.event}</strong></div>
                    <pre className="telemetry-event-pre">{JSON.stringify(e.details || {}, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </>
          )}

          {!loading && !error && tab === 'conversations' && (
            <>
              {summary ? (
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="p-3 bg-zinc-800 rounded">
                    <div className="text-sm text-zinc-400">Total conversations</div>
                    <div className="text-2xl font-semibold">{summary.conversationCount}</div>
                  </div>
                  <div className="p-3 bg-zinc-800 rounded">
                    <div className="text-sm text-zinc-400">Total messages</div>
                    <div className="text-2xl font-semibold">{summary.totalMessages}</div>
                  </div>
                  <div className="p-3 bg-zinc-800 rounded">
                    <div className="text-sm text-zinc-400">Avg messages / conversation</div>
                    <div className="text-2xl font-semibold">{summary.avgMessagesPerConversation}</div>
                  </div>
                  <div className="p-3 bg-zinc-800 rounded">
                    <div className="text-sm text-zinc-400">First conversation</div>
                    <div className="text-lg font-semibold">{summary.oldestConversation ? new Date(summary.oldestConversation).toLocaleDateString() : '—'}</div>
                  </div>
                </div>
              ) : (
                <div className="text-zinc-500">No conversation data available.</div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        .analytics-tab {
          padding: 6px 14px;
          font-size: 13px;
          border-radius: 6px 6px 0 0;
          background: transparent;
          color: #a1a1aa;
          border: 1px solid transparent;
          border-bottom: none;
          cursor: pointer;
          transition: background 0.15s;
        }
        .analytics-tab:hover { background: rgba(255,255,255,0.04); }
        .analytics-tab-active {
          background: #27272a;
          color: #e4e4e7;
          border-color: #3f3f46;
        }
      `}</style>
    </div>
  );
}
