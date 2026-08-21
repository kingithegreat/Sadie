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
import { useConfirmDestructive } from './ConfirmDestructive';
import { episodeToJobInput } from '../../shared/podcast-recap';
import type { FeedEpisode } from '../../shared/podcast-recap';

type MediaJobState =
  | 'idea' | 'researching' | 'script_draft' | 'script_qa' | 'media_production'
  | 'render_qa' | 'awaiting_approval' | 'approved' | 'scheduled' | 'published'
  | 'analysing' | 'blocked' | 'failed' | 'needs_revision' | 'rejected';

interface MediaJobEvent { at: string; from: string; to: string; by: string; note?: string }

/** What homebot:media:parse-feed returns — see main/podcast-feed.ts. */
interface ParsedFeedView { showTitle: string; showDescription: string; episodes: FeedEpisode[] }
interface MediaJob {
  id: string;
  title: string;
  format: 'short' | 'long';
  state: MediaJobState;
  brief?: string;
  script?: string;
  /** Set once narration has been recorded; absolute path to the MP3. */
  narrationPath?: string;
  /**
   * Set once the render stage has produced a file; absolute path to the MP4.
   *
   * This arrived over IPC from the first day rendering existed and the panel
   * dropped it, so the approval gate asked a person to approve a video they had
   * no way to watch — while the render tool's own reply said "watch it before
   * approving".
   */
  renderPath?: string;
  /**
   * The generated slides, in running order. `null` marks a scene whose image
   * failed and which reuses its neighbour in the video.
   *
   * Same shape of omission as `renderPath` above: these paths were computed,
   * written into the ffmpeg concat file and thrown away, so the approval gate
   * asked a person to approve slides they had never seen.
   */
  scenePaths?: Array<string | null>;
  /** Measured from the audio, not estimated from word count. */
  durationSeconds?: number;
  /** The id or link the platform gave it. Only ever set after publishing. */
  videoId?: string;
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
  // `scheduled → published` is deliberately NOT here. Reaching `published`
  // needs the id the platform assigned, which only the publish flow below
  // collects — a generic "Move to published" set the state with no id, which is
  // precisely the "looks published and is not" case the state machine warns
  // about, and it left the double-publish guard (keyed on videoId) dead.
  published: 'analysing',
  needs_revision: 'script_draft',
};

/** States from which a video can be recorded as having gone out. */
const PUBLISHABLE: MediaJobState[] = ['approved', 'scheduled'];

const label = (s: string) => s.replace(/_/g, ' ');

function stateClass(s: MediaJobState): string {
  if (s === 'awaiting_approval') return 'ms-state ms-state--attention';
  if (FAILURE.includes(s)) return 'ms-state ms-state--bad';
  if (s === 'published' || s === 'analysing') return 'ms-state ms-state--done';
  return 'ms-state';
}

export const MediaStudioPanel: React.FC = () => {
  const [confirmDialog, confirm] = useConfirmDestructive();
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * What the busy job is doing, in the user's words.
   *
   * Writing a script or recording narration takes 30–60s on a local model.
   * With only a disabled button to look at, that is indistinguishable from a
   * click that did nothing — the panel has to say it is working, and say what
   * it is working on.
   */
  const [busyLabel, setBusyLabel] = useState<string>('');
  const [done, setDone] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<'short' | 'long'>('short');
  // "From a podcast…" — collapsed until asked for, so the ordinary create row
  // stays as simple as it was.
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feed, setFeed] = useState<ParsedFeedView | null>(null);
  /** Which job is currently being asked for its published link, if any. */
  const [publishingFor, setPublishingFor] = useState<string | null>(null);
  const [publishedLink, setPublishedLink] = useState('');

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
  const run = async (id: string, fn: () => Promise<any>, label = '') => {
    setBusy(id); setBusyLabel(label); setError(null); setDone(null);
    try {
      const res = await fn();
      if (res && res.ok === false) setError(res.error || 'That move was refused.');
      else if (res && res.message) setDone(String(res.message).split('\n')[0]);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(null); setBusyLabel('');
    }
  };

  /** Stages that call a model, the TTS service or ffmpeg — the slow ones. */
  const stageAction = (j: MediaJob): { label: string; action: 'script' | 'narrate' | 'render' } | null => {
    if (j.state === 'idea' || j.state === 'researching' || j.state === 'needs_revision') {
      return { label: 'Write script', action: 'script' };
    }
    if (j.state === 'script_draft' || j.state === 'script_qa') {
      return { label: 'Record narration', action: 'narrate' };
    }
    // Rendering used to be reachable only by asking in chat — the panel walked
    // a video all the way to media_production and then went quiet.
    if (j.state === 'media_production') {
      return { label: 'Make the video', action: 'render' };
    }
    return null;
  };

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    await run('new', () => api()?.mediaCreate?.({ title: t, format }));
    setTitle('');
  };

  const loadFeed = async () => {
    const u = feedUrl.trim();
    if (!u) return;
    setFeedLoading(true);
    setFeedError(null);
    setFeed(null);
    try {
      const res = await api()?.mediaParseFeed?.(u);
      if (res?.ok && res.feed) setFeed(res.feed);
      else setFeedError(res?.error || 'Could not read that feed.');
    } catch (e: any) {
      setFeedError(e?.message || 'Could not read that feed.');
    } finally {
      setFeedLoading(false);
    }
  };

  /**
   * Record the video as published, with the link the user pastes back.
   *
   * Deliberately not an upload: HomeBot has no uploader, and pretending
   * otherwise is what the old "Move to published" button did.
   */
  const markPublished = async (j: MediaJob) => {
    const link = publishedLink.trim();
    if (!link) return;
    await run(j.id, () => api()?.mediaMarkPublished?.(j.id, link), 'Saving');
    setPublishingFor(null);
    setPublishedLink('');
  };

  /** One episode → one ordinary job, via the shared composition. */
  const createFromEpisode = async (ep: FeedEpisode) => {
    await run('new', () => api()?.mediaCreate?.(
      episodeToJobInput(feed?.showTitle || 'this podcast', ep),
    ));
  };

  const awaiting = jobs.filter(j => j.state === 'awaiting_approval');
  const active = jobs.filter(j => j.state !== 'awaiting_approval' && !FAILURE.includes(j.state));
  const stalled = jobs.filter(j => FAILURE.includes(j.state));

  const renderJob = (j: MediaJob, showApproval: boolean) => (
    <li key={j.id} className="ms-job">
      <div className="ms-job-main">
        <span className="ms-job-title">{j.title}</span>
        <span className="ms-job-format">
          {j.format === 'long' ? 'long-form' : 'short'}
          {j.durationSeconds ? ` · ${j.durationSeconds}s recorded` : ''}
        </span>
        {/* The script and the slides, before you commit to watching.
            Both were already produced and neither was ever shown: `script` has
            been on the job all along, and the scene image paths were built,
            written into the ffmpeg concat file and discarded. Approving a video
            you can only judge by playing it is slower than reading it. Closed
            by default so a list of jobs stays a list. */}
        {j.script ? (
          <details className="ms-preview">
            <summary className="ms-preview-toggle">Script</summary>
            <p className="ms-script">{j.script}</p>
          </details>
        ) : null}

        {j.scenePaths?.length ? (
          <details className="ms-preview">
            <summary className="ms-preview-toggle">
              Slides ({j.scenePaths.length})
              {j.scenePaths.some(p => !p)
                ? ` · ${j.scenePaths.filter(p => !p).length} reused a neighbour`
                : ''}
            </summary>
            <div className="ms-slides" data-testid={`ms-slides-${j.id}`}>
              {j.scenePaths.map((p, i) => (
                p ? (
                  <img
                    key={i}
                    className="ms-slide"
                    loading="lazy"
                    alt={`Slide ${i + 1} of ${j.scenePaths!.length}`}
                    src={`file:///${p.replace(/\\/g, '/')}`}
                  />
                ) : (
                  /* Named rather than hidden: a gap the user cannot explain
                     reads as a bug, and this one is expected and harmless. */
                  <span key={i} className="ms-slide ms-slide-missing" title={`Slide ${i + 1} had no image and reuses the one before it`}>
                    {i + 1}
                  </span>
                )
              ))}
            </div>
          </details>
        ) : null}

        {/* Seeing the video is the only way to judge it, and this panel is
            where it gets approved. Once a render exists the video replaces the
            audio player — the narration is inside it, so offering both is two
            controls for one job. */}
        {j.renderPath ? (
          <video
            className="ms-video"
            controls
            preload="metadata"
            data-testid={`ms-video-${j.id}`}
            src={`file:///${j.renderPath.replace(/\\/g, '/')}`}
          />
        ) : j.narrationPath ? (
          /* Hearing the narration is the only way to judge it before there is
             a picture. file:// works because the renderer loads from disk. */
          <audio
            className="ms-audio"
            controls
            preload="none"
            src={`file:///${j.narrationPath.replace(/\\/g, '/')}`}
          />
        ) : null}
        {j.videoId && (
          <span className="ms-job-published">Published as {j.videoId}</span>
        )}
      </div>
      <span className={stateClass(j.state)}>
        {busy === j.id ? (busyLabel || 'Working…') : label(j.state)}
      </span>
      <div className="ms-job-actions">
        {/* Working state comes first: while a stage runs, the only honest thing
            to show is that it is running and roughly how long it takes. */}
        {busy === j.id ? (
          <span className="ms-working" role="status" aria-live="polite">
            <span className="ms-spinner" aria-hidden="true" />
            {busyLabel || 'Working'} — this can take up to a minute
          </span>
        ) : showApproval ? (
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
            {/* `rejected` is deliberately terminal in the state machine — "a
                rejected idea is closed, not silently revived" (media-studio.ts).
                That is a reasonable product decision, but it sits one button
                away from "Send back", which IS recoverable, and nothing on
                screen said which was which. So: ask, and name the difference. */}
            <button
              className="ms-btn ms-btn--reject"
              disabled={busy === j.id}
              onClick={() => confirm({
                title: `Reject “${j.title || 'this video'}” for good?`,
                body: (
                  <p>
                    Rejecting closes this video permanently — it cannot be reopened or
                    picked back up later. If you want changes instead, use
                    {' '}<strong>Send back</strong>, which returns it for another pass.
                  </p>
                ),
                confirmLabel: 'Reject it',
                onConfirm: () => run(j.id, () => api()?.mediaReject?.(j.id, false)),
              })}
            >Reject</button>
          </>
        ) : stageAction(j) ? (
          // The stage that does real work, rather than only changing state.
          <button
            className="ms-btn ms-btn--primary"
            onClick={() => {
              const a = stageAction(j)!;
              run(j.id, () => api()?.mediaRun?.(j.id, a.action), a.label);
            }}
          >
            {stageAction(j)!.label}
          </button>
        ) : PUBLISHABLE.includes(j.state) ? (
          /* Publishing asks for the link, because HomeBot does not upload.
             The old button set the state to `published` and stopped, so the
             app claimed to have published something it had never sent
             anywhere — and with no id, the guard against publishing twice had
             nothing to compare. */
          publishingFor === j.id ? (
            <span className="ms-publish">
              <input
                className="ms-input ms-publish-input"
                placeholder="Paste the link or video id"
                aria-label={`Link or video id for ${j.title}`}
                value={publishedLink}
                autoFocus
                onChange={e => setPublishedLink(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') markPublished(j); }}
              />
              <button
                className="ms-btn ms-btn--primary"
                disabled={!publishedLink.trim()}
                onClick={() => markPublished(j)}
              >Save</button>
              <button
                className="ms-btn"
                onClick={() => { setPublishingFor(null); setPublishedLink(''); }}
              >Cancel</button>
            </span>
          ) : (
            <>
              {NEXT_STAGE[j.state] && (
                <button
                  className="ms-btn"
                  onClick={() => run(j.id, () => api()?.mediaAdvance?.(j.id, NEXT_STAGE[j.state]!), 'Moving')}
                >
                  Move to {label(NEXT_STAGE[j.state]!)}
                </button>
              )}
              <button
                className="ms-btn ms-btn--primary"
                onClick={() => { setPublishingFor(j.id); setPublishedLink(''); }}
              >
                Mark as published…
              </button>
            </>
          )
        ) : NEXT_STAGE[j.state] ? (
          <button
            className="ms-btn"
            onClick={() => run(j.id, () => api()?.mediaAdvance?.(j.id, NEXT_STAGE[j.state]!), 'Moving')}
          >
            Move to {label(NEXT_STAGE[j.state]!)}
          </button>
        ) : (
          <span className="ms-job-terminal">no further steps</span>
        )}
        {/* Removing a video was chat-only, so the queue could only ever grow
            and renders piled up on disk with nothing in the UI to clear them.
            Irreversible, so it asks — the same rule the Reject button follows. */}
        {busy !== j.id && publishingFor !== j.id && (
          <button
            className="ms-btn ms-btn--reject"
            aria-label={`Delete ${j.title}`}
            onClick={() => confirm({
              title: `Delete “${j.title || 'this video'}”?`,
              body: (
                <p>
                  This removes it from the list and deletes its files — narration,
                  captions, scene images and the rendered video. It cannot be undone.
                </p>
              ),
              confirmLabel: 'Delete it',
              onConfirm: () => run(j.id, () => api()?.mediaDelete?.(j.id), 'Deleting'),
            })}
          >Delete</button>
        )}
      </div>
    </li>
  );

  return (
    <div className="media-studio">
      {confirmDialog}
      <header className="ms-header">
        <h2>Media Studio</h2>
        <p className="ms-sub">
          Nothing is published without your approval. Videos waiting on you appear first.
        </p>
      </header>

      {error && <div className="ms-error" role="alert">{error}</div>}
      {done && <div className="ms-done" role="status">{done}</div>}

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

      {/* A second source: recap an episode of a podcast. Ported from the
          ideamake pipeline — the feed's episode notes become the job's brief,
          so the script stage works from what the episode actually says instead
          of model recall. The job it creates is ordinary: same state machine,
          same approval gate. */}
      <div className="ms-feed">
        {!feedOpen ? (
          <button type="button" className="ms-btn" onClick={() => setFeedOpen(true)}>
            From a podcast…
          </button>
        ) : (
          <>
            <div className="ms-feed-row">
              <input
                className="ms-input"
                placeholder="Paste a podcast feed link (ends in .rss or .xml, or labelled “RSS”)"
                value={feedUrl}
                onChange={e => setFeedUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadFeed(); }}
                aria-label="Podcast feed link"
              />
              <button
                className="ms-btn ms-btn--primary"
                onClick={loadFeed}
                disabled={!feedUrl.trim() || feedLoading}
              >
                {feedLoading ? 'Looking…' : 'Show episodes'}
              </button>
              <button
                type="button"
                className="ms-btn"
                onClick={() => { setFeedOpen(false); setFeed(null); setFeedError(null); }}
                aria-label="Close podcast section"
              >✕</button>
            </div>
            {feedError && <div className="ms-error" role="alert">{feedError}</div>}
            {feed && (
              <ul className="ms-feed-episodes" aria-label={`Episodes of ${feed.showTitle}`}>
                {feed.episodes.map((ep, i) => (
                  <li key={i} className="ms-feed-episode">
                    <div className="ms-feed-ep-main">
                      <span className="ms-feed-ep-title">{ep.title}</span>
                      <span className="ms-feed-ep-meta">
                        {[ep.published, ep.duration && `${ep.duration} long`].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <button
                      className="ms-btn ms-btn--primary"
                      disabled={busy === 'new'}
                      onClick={() => createFromEpisode(ep)}
                    >
                      Make a recap
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
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
