/**
 * MediaStudioPanel — the Content Command Center from the Media Studio plan.
 *
 * Phase 1's UI: the queue, the stage each video has reached, and the approval
 * gate. It is a work surface rather than a document, so what needs attention
 * comes first: anything awaiting approval sits at the top, because that is the
 * only thing in the pipeline that cannot proceed without the person looking at
 * this screen.
 *
 * Every action goes through the same state machine the chat tools use. The UI
 * cannot approve anything the rules would refuse — approving is an IPC call
 * that sets the human-decision flag, not a direct write.
 */

import React, { useCallback, useEffect, useState } from 'react';

type MediaJobState =
  | 'idea' | 'researching' | 'script_draft' | 'script_qa' | 'media_production'
  | 'render_qa' | 'awaiting_approval' | 'approved' | 'scheduled' | 'published'
  | 'analysing' | 'blocked' | 'failed' | 'needs_revision' | 'rejected';

interface MediaJobEvent { at: string; from: string; to: string; by: string; note?: string }
interface MediaJob {
  id: string;
  title: string;
  format: 'short' | 'long';
  state: MediaJobState;
  brief?: string;
  createdAt: string;
  updatedAt: string;
  history: MediaJobEvent[];
}

const FAILURE: MediaJobState[] = ['blocked', 'failed', 'needs_revision', 'rejected'];

/** The stage a job moves to when it simply carries on. */
const NEXT_STAGE: Partial<Record<MediaJobState, MediaJobState>> = {
  idea: 'researching',
  researching: 'script_draft',
  script_draft: 'script_qa',
  script_qa: 'media_production',
  media_production: 'render_qa',
  render_qa: 'awaiting_approval',
  approved: 'scheduled',
  scheduled: 'published',
  published: 'analysing',
  needs_revision: 'script_draft',
};

const label = (s: string) => s.replace(/_/g, ' ');

function stateClass(s: MediaJobState): string {
  if (s === 'awaiting_approval') return 'ms-state ms-state--attention';
  if (FAILURE.includes(s)) return 'ms-state ms-state--bad';
  if (s === 'published' || s === 'analysing') return 'ms-state ms-state--done';
  return 'ms-state';
}

export const MediaStudioPanel: React.FC = () => {
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<'short' | 'long'>('short');

  const api = () => (window as any).electron;

  const refresh = useCallback(async () => {
    try {
      const list = await api()?.mediaList?.();
      setJobs(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load the Media Studio.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** Every mutation reports the state machine's own refusal text verbatim. */
  const run = async (id: string, fn: () => Promise<any>) => {
    setBusy(id); setError(null);
    try {
      const res = await fn();
      if (res && res.ok === false) setError(res.error || 'That move was refused.');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    await run('new', () => api()?.mediaCreate?.({ title: t, format }));
    setTitle('');
  };

  const awaiting = jobs.filter(j => j.state === 'awaiting_approval');
  const active = jobs.filter(j => j.state !== 'awaiting_approval' && !FAILURE.includes(j.state));
  const stalled = jobs.filter(j => FAILURE.includes(j.state));

  const renderJob = (j: MediaJob, showApproval: boolean) => (
    <li key={j.id} className="ms-job">
      <div className="ms-job-main">
        <span className="ms-job-title">{j.title}</span>
        <span className="ms-job-format">{j.format === 'long' ? 'long-form' : 'short'}</span>
      </div>
      <span className={stateClass(j.state)}>{label(j.state)}</span>
      <div className="ms-job-actions">
        {showApproval ? (
          <>
            <button
              className="ms-btn ms-btn--approve"
              disabled={busy === j.id}
              onClick={() => run(j.id, () => api()?.mediaApprove?.(j.id))}
            >Approve</button>
            <button
              className="ms-btn"
              disabled={busy === j.id}
              onClick={() => run(j.id, () => api()?.mediaReject?.(j.id, true))}
            >Send back</button>
            <button
              className="ms-btn ms-btn--reject"
              disabled={busy === j.id}
              onClick={() => run(j.id, () => api()?.mediaReject?.(j.id, false))}
            >Reject</button>
          </>
        ) : NEXT_STAGE[j.state] ? (
          <button
            className="ms-btn"
            disabled={busy === j.id}
            onClick={() => run(j.id, () => api()?.mediaAdvance?.(j.id, NEXT_STAGE[j.state]!))}
          >
            Move to {label(NEXT_STAGE[j.state]!)}
          </button>
        ) : (
          <span className="ms-job-terminal">no further steps</span>
        )}
      </div>
    </li>
  );

  return (
    <div className="media-studio">
      <header className="ms-header">
        <h2>Media Studio</h2>
        <p className="ms-sub">
          Nothing is published without your approval. Videos waiting on you appear first.
        </p>
      </header>

      {error && <div className="ms-error" role="alert">{error}</div>}

      <div className="ms-new">
        <input
          className="ms-input"
          placeholder="Working title, e.g. One-Minute Bible: Jonah"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') create(); }}
          aria-label="New video title"
        />
        <select
          className="ms-select"
          value={format}
          onChange={e => setFormat(e.target.value as 'short' | 'long')}
          aria-label="Video format"
        >
          <option value="short">Short (30–60s)</option>
          <option value="long">Long (5–12 min)</option>
        </select>
        <button className="ms-btn ms-btn--primary" onClick={create} disabled={!title.trim() || busy === 'new'}>
          Add video
        </button>
      </div>

      {jobs.length === 0 && (
        <p className="ms-empty">
          No videos yet. Add one above, or ask in chat — “start a short video called …”.
        </p>
      )}

      {awaiting.length > 0 && (
        <section className="ms-section ms-section--attention">
          <h3>Waiting for you ({awaiting.length})</h3>
          <ul className="ms-list">{awaiting.map(j => renderJob(j, true))}</ul>
        </section>
      )}

      {active.length > 0 && (
        <section className="ms-section">
          <h3>In progress ({active.length})</h3>
          <ul className="ms-list">{active.map(j => renderJob(j, false))}</ul>
        </section>
      )}

      {stalled.length > 0 && (
        <section className="ms-section">
          <h3>Needs attention ({stalled.length})</h3>
          <ul className="ms-list">{stalled.map(j => renderJob(j, false))}</ul>
        </section>
      )}
    </div>
  );
};

export default MediaStudioPanel;
