import { useEffect, useState } from 'react';

export default function TelemetryDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const r = await (window as any).electron.readTelemetryEvents();
        if (r && r.success && Array.isArray(r.events)) {
          setEvents(r.events.reverse());
        } else {
          setEvents([]);
        }
      } catch (e: any) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const counts = events.reduce((acc: Record<string, number>, ev) => { acc[ev.event] = (acc[ev.event] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 p-6">
      <div className="w-full max-w-3xl bg-zinc-900 rounded shadow-lg border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Telemetry Dashboard</div>
            <div className="text-sm text-zinc-400">Local telemetry-events.log summary (anonymous)</div>
          </div>
          <div>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="p-4">
          {loading && <div>Loading…</div>}
          {error && <div className="text-red-400">{error}</div>}
          {!loading && !error && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-4">
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Total events</div>
                  <div className="text-2xl font-semibold">{events.length}</div>
                </div>
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Stream failures</div>
                  <div className="text-2xl font-semibold">{counts['stream_failure'] || 0}</div>
                </div>
                <div className="p-3 bg-zinc-800 rounded">
                  <div className="text-sm text-zinc-400">Unique event types</div>
                  <div className="text-2xl font-semibold">{Object.keys(counts).length}</div>
                </div>
              </div>

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
        </div>
      </div>
    </div>
  );
}
