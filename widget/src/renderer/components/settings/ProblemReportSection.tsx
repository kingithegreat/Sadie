/**
 * Settings → Report a problem. Creates a local text report (main/problem-report.ts)
 * with secrets removed; nothing is sent anywhere. The tester opens the file and
 * shares it however they like.
 */

import { useState } from 'react';

export default function ProblemReportSection() {
  const api = (window as any).electron;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null); setSaved(null);
    try {
      const res = await api?.createProblemReport?.(note);
      if (res?.success && res.path) setSaved(res.path);
      else setError(res?.error || 'Could not create the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting-group problem-report" aria-label="Report a problem">
      <label className="setting-label" htmlFor="problem-report-note">🩺 Report a problem</label>
      <textarea id="problem-report-note" className="setting-input" rows={3} value={note} disabled={busy}
        placeholder="What were you doing, and what went wrong? (optional)"
        onChange={e => setNote(e.target.value)} />
      <div>
        <button type="button" className="sp-btn" onClick={() => void create()} disabled={busy}>
          {busy ? 'Creating report…' : 'Create report'}
        </button>
      </div>
      <small className="setting-hint">
        Saves a text file with app and system details, recent logs and settings. API keys, tokens and passwords are
        removed. Nothing is sent — you choose whether to share the file.
      </small>
      {saved && (
        <p role="status" className="setting-hint">
          Saved: {saved}{' '}
          <button type="button" className="sp-btn" onClick={() => void api?.showProblemReport?.(saved)}>Show file</button>
        </p>
      )}
      {error && <p role="alert" className="setting-hint">{error}</p>}
    </div>
  );
}
