/**
 * What HomeBot can do right now — and the fix for whatever it cannot.
 *
 * HomeBot fails quietly, and today produced three demonstrations of it: web
 * search returned nothing once DuckDuckGo started answering HTTP 202 and the
 * app advised different search terms; the Claude subscription could not be
 * turned on and the local model answered instead with no explanation; and an
 * automation quietly stopped using n8n forever after one failed run.
 *
 * None of those was visible anywhere. This is the screen where they would have
 * been.
 *
 * Three states, deliberately, because they need different actions: it works,
 * you have not set it up yet, or it is not there. A fourth — "we do not know" —
 * is shown honestly rather than rounded up to working.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Capability } from '../../shared/capability-report';

const STATE_ICON: Record<Capability['state'], string> = {
  ready: '✅',
  needs_setup: '⚙️',
  missing: '❌',
  unknown: '❔',
};

const STATE_LABEL: Record<Capability['state'], string> = {
  ready: 'Working',
  needs_setup: 'Needs setting up',
  missing: 'Not installed',
  unknown: 'Not checked',
};

export default function CapabilityReport() {
  const [capabilities, setCapabilities] = useState<Capability[] | null>(null);
  const [summary, setSummary] = useState<{ ready: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electron?.getCapabilityReport?.();
      if (!res?.success) {
        setError(res?.error || 'Could not check.');
        setCapabilities(null);
        return;
      }
      setCapabilities(res.capabilities || []);
      setSummary(res.summary ? { ready: res.summary.ready, total: res.summary.total } : null);
    } catch {
      setError('Could not check.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !capabilities) {
    return (
      <div className="dashboard-recent-section" data-testid="capability-report">
        <h2 className="dashboard-section-title">What's working</h2>
        <p className="cap-loading">Checking…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-recent-section" data-testid="capability-report">
        <h2 className="dashboard-section-title">What's working</h2>
        <p className="cap-error">{error}</p>
      </div>
    );
  }

  const all = capabilities || [];
  // Anything not working comes first and is shown by default; the working ones
  // are the reassuring majority and can wait behind a toggle. A screen that
  // opens on eight green ticks buries the one thing that needs attention.
  const attention = all.filter(c => c.state !== 'ready');
  const working = all.filter(c => c.state === 'ready');
  const shown = showAll ? [...attention, ...working] : attention;

  return (
    <div className="dashboard-recent-section" data-testid="capability-report">
      <h2 className="dashboard-section-title">
        What's working
        {summary && (
          <span className="cap-summary" data-testid="capability-summary">
            {' '}— {summary.ready} of {summary.total}
          </span>
        )}
        <button type="button" className="cap-refresh" onClick={load} disabled={loading}>
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </h2>

      {attention.length === 0 && !showAll && (
        <p className="cap-all-good">Everything is working.</p>
      )}

      <ul className="cap-list">
        {shown.map(cap => (
          <li key={cap.id} className={`cap-item cap-${cap.state}`} data-testid={`cap-${cap.id}`}>
            <div className="cap-head">
              <span className="cap-icon" aria-hidden="true">{STATE_ICON[cap.state]}</span>
              <span className="cap-label">{cap.label}</span>
              <span className="cap-state">{STATE_LABEL[cap.state]}</span>
            </div>
            <p className="cap-detail">{cap.detail}</p>
            {cap.fix && (
              // The remedy, not just the diagnosis. A status with no fix is a
              // shrug, and the app already had plenty of those.
              <p className="cap-fix"><strong>Fix:</strong> {cap.fix}</p>
            )}
          </li>
        ))}
      </ul>

      {working.length > 0 && (
        <button type="button" className="cap-toggle" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Hide what is working' : `Show the ${working.length} that are working`}
        </button>
      )}
    </div>
  );
}
