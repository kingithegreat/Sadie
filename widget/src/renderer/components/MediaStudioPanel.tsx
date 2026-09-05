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
import { chatIdeaToJobInput, deriveIdeaTitle } from '../../shared/chat-idea';
import { NARRATION_ENGINES, KOKORO_VOICES } from '../../shared/narration';

type MediaJobState =
  | 'idea' | 'researching' | 'script_draft' | 'script_qa' | 'media_production'
  | 'render_qa' | 'awaiting_approval' | 'approved' | 'scheduled' | 'published'
  | 'blocked' | 'failed' | 'needs_revision' | 'rejected';

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
  /** Which engine actually narrated ('edge' | 'kokoro') — a silent fallback
   *  must be visible here, not discoverable by ear after publishing. */
  narratedWith?: string;
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
  // `published → analysing` was removed with the analysing state itself: it
  // offered a button into a terminal dead end that no code consumed.
  needs_revision: 'script_draft',
};

/** States from which a video can be recorded as having gone out. */
const PUBLISHABLE: MediaJobState[] = ['approved', 'scheduled'];

const label = (s: string) => s.replace(/_/g, ' ');

function stateClass(s: MediaJobState): string {
  if (s === 'awaiting_approval') return 'ms-state ms-state--attention';
  if (FAILURE.includes(s)) return 'ms-state ms-state--bad';
  if (s === 'published') return 'ms-state ms-state--done';
  return 'ms-state';
}

export interface MediaStudioPanelProps {
  /**
   * Context handed over when the assistant or chat sends the user here,
   * so Media Studio opens with what was just discussed (title, topic, format,
   * podcast feed, Ancient Pathways episode, or existing job) rather than blank.
   */
  navContext?: Record<string, unknown> | null;
}

export const MediaStudioPanel: React.FC<MediaStudioPanelProps> = ({ navContext }) => {
  const [confirmDialog, confirm] = useConfirmDestructive();
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null);
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
  // "From chat…" — recent user messages as video ideas. Same collapsed
  // pattern; the messages only load when the section is opened.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatIdeas, setChatIdeas] = useState<Array<{ id: string; content: string; createdAt: number }> | null>(null);
  // Narration voice picker. Voices load lazily with the first narrate action;
  // sampling renders a short clip to a temp file and plays it. The ENGINE is
  // persisted (narrationEngine) and the voice list follows it — an Edge voice
  // name means nothing to the local model, so offering it next to "record"
  // would be a silent mismatch waiting to ship.
  const [voices, setVoices] = useState<Array<{ name: string; friendlyName?: string; locale?: string }> | null>(null);
  const [narrateVoice, setNarrateVoice] = useState('');
  const [narrateEngine, setNarrateEngine] = useState<'' | 'edge' | 'kokoro'>('');
  const [sampling, setSampling] = useState<string | null>(null);
  /** Last rendered voice sample, played inline via file:// like the previews. */
  const [samplePath, setSamplePath] = useState<string | null>(null);
  /** Which job is currently being asked for its published link, if any. */
  const [publishingFor, setPublishingFor] = useState<string | null>(null);
  const [publishedLink, setPublishedLink] = useState('');

  // "From Ancient Pathways…" — 2D animated history series
  const [apOpen, setApOpen] = useState(false);
  const [apLoading, setApLoading] = useState(false);
  const [apError, setApError] = useState<string | null>(null);
  const [apEpisodes, setApEpisodes] = useState<Array<{
    id: string;
    code: string;
    season: number;
    title: string;
    era: string;
    mainCharacter: string;
    sceneCount: number;
    emoji?: string;
    summary?: string;
  }> | null>(null);
  const [apStatus, setApStatus] = useState<{
    available: boolean;
    lock?: { locked: boolean; message?: string };
  } | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<number>(0);
  const [apSearch, setApSearch] = useState<string>('');
  const [apDoctorChecks, setApDoctorChecks] = useState<Record<string, { checks: Array<{ name: string; ok: boolean; detail: string }>; failed: number; loading: boolean }>>({});

  // Showrunner: free-first autonomous prompt-to-movie production
  const [showrunnerPrompt, setShowrunnerPrompt] = useState('');
  const [showrunnerDuration, setShowrunnerDuration] = useState(60);
  const [showrunnerCharacters, setShowrunnerCharacters] = useState('');
  const [showrunnerName, setShowrunnerName] = useState('');
  const [showrunnerBusy, setShowrunnerBusy] = useState(false);

  // Generation Router — shot-level routing through the 5-provider GenerationRouter
  const [movieProjects, setMovieProjects] = useState<Array<Record<string, unknown>> | null>(null);
  const [movieRunning, setMovieRunning] = useState(false);
  const [movieResult, setMovieResult] = useState<string | null>(null);
  const [movieError, setMovieError] = useState<string | null>(null);

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

  /**
   * The video engine. Rendering is the one stage with a dependency the app does
   * not ship, and the old answer to a missing one was to tell the user to run
   * `winget install Gyan.FFmpeg` — a package manager, aimed at someone the
   * product says outright is not technical. Now the panel offers to do it.
   */
  const [engine, setEngine] = useState<{ ready: boolean; supported: boolean } | null>(null);
  const [engineNote, setEngineNote] = useState<string>('');
  const [engineBusy, setEngineBusy] = useState(false);

  const checkEngine = useCallback(async () => {
    try {
      const s = await api()?.mediaFfmpegStatus?.();
      if (s) setEngine({ ready: !!s.ready, supported: s.supported !== false });
    } catch { /* leave it unknown rather than claiming it is missing */ }
  }, []);

  useEffect(() => { checkEngine(); }, [checkEngine]);

  // Progress arrives on a push channel because the download is long enough that
  // a spinner alone is indistinguishable from a hang.
  useEffect(() => {
    const off = api()?.onMediaFfmpegProgress?.((p: any) => {
      const mb = p?.receivedMB != null && p?.totalMB
        ? ` ${p.receivedMB} of ${p.totalMB} MB`
        : '';
      setEngineNote(`${p?.note ?? 'Working…'}${mb}`);
    });
    return () => { try { off?.(); } catch { /* nothing to detach */ } };
  }, []);

  // Ancient Pathways episode stage progress streaming
  useEffect(() => {
    const off = api()?.onMediaAncientPathwaysProgress?.((p: any) => {
      if (p?.note) {
        setBusyLabel(`Ancient Pathways: ${p.note}`);
      }
    });
    return () => { try { off?.(); } catch { /* nothing to detach */ } };
  }, []);

  const setUpEngine = async () => {
    setEngineBusy(true);
    setEngineNote('Starting…');
    setError(null);
    try {
      const res = await api()?.mediaFfmpegSetup?.();
      if (res?.ok) {
        setEngineNote('');
        setDone(res.message || 'Ready — videos can now be made on this PC.');
        await checkEngine();
      } else {
        setEngineNote('');
        setError(res?.error || 'The video engine could not be set up.');
      }
    } catch (e: any) {
      setEngineNote('');
      setError(e?.message || 'The video engine could not be set up.');
    } finally {
      setEngineBusy(false);
    }
  };

  /** Every mutation reports the state machine's own refusal text verbatim. */
  /**
   * Let go of a job's video and audio before touching its files.
   *
   * Reported as "Delete keeps failing". A `<video>` or `<audio>` pointed at a
   * `file:///` source keeps an open handle on it, and on Windows an open handle
   * makes the file undeletable — so `rmSync` on the job folder fails with EBUSY
   * every single time for any job whose render or narration is on screen. Which
   * is every job worth deleting.
   *
   * Clearing `src` and calling `load()` drops the handle. The await yields a
   * frame so the release lands before main tries to remove the directory.
   */
  const releaseMediaThen = async (id: string, fn: () => Promise<any>) => {
    try {
      const nodes = document.querySelectorAll<HTMLMediaElement>(
        `[data-testid="ms-video-${id}"], [data-testid="ms-audio-${id}"]`
      );
      nodes.forEach(el => {
        try { el.pause(); } catch { /* not playing */ }
        el.removeAttribute('src');
        try { el.load(); } catch { /* already torn down */ }
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    } catch {
      // Releasing is best-effort; main retries too, and a delete that works
      // anyway must not be blocked by this.
    }
    return fn();
  };

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
    // Offer what is MISSING, not what the state implies.
    //
    // "Move to …" advances the state and does none of the work, so a job can
    // sit in script_draft with no script. Going by state alone offered "Record
    // narration", which answered "has no script yet" — and scripting refused
    // too, for being past the scripting stage. Reported live on a job called
    // "is there a god", which had no way forward at all.
    if ((j.state === 'script_draft' || j.state === 'script_qa') && !j.script?.trim()) {
      return { label: 'Write script', action: 'script' };
    }
    if (j.state === 'script_draft' || j.state === 'script_qa') {
      return { label: 'Record narration', action: 'narrate' };
    }
    // Same shape one stage later: media_production without narration audio.
    if (j.state === 'media_production' && !j.narrationPath) {
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

  const loadFeed = async (overrideUrl?: unknown) => {
    const u = (typeof overrideUrl === 'string' ? overrideUrl : feedUrl).trim();
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

  /**
   * Recent user messages, newest first, as candidate video ideas.
   *
   * Only user messages: the brief contract in chat-idea.ts is built on the
   * idea being the user's own words. Length-capped so a pasted essay does not
   * dominate the list; the full text still travels into the job's brief.
   */
  const loadChatIdeas = async () => {
    setChatLoading(true);
    setChatError(null);
    try {
      const res = await api()?.loadConversations?.();
      // homebot:load-conversations returns MemoryResult: { success, data }.
      // The fallback covers a bare-store shape in case the envelope changes.
      const store = res?.data ?? res;
      const all: Array<{ id: string; content: string; createdAt: number }> = [];
      const seen = new Set<string>();
      const conversations = store?.conversations;
      if (Array.isArray(conversations)) {
        for (const conv of conversations) {
          for (const m of (conv.messages || [])) {
            if (m.role !== 'user') continue;
            const text = String(m.content || '').trim();
            if (text.length < 12) continue; // "ok", "thanks" — not ideas
            // The same words re-sent or repeated across conversations are one
            // idea, not two — and two jobs from it would be indistinguishable.
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            all.push({ id: m.id || `${conv.id}-${all.length}`, content: text, createdAt: m.createdAt || 0 });
          }
        }
      }
      all.sort((a, b) => b.createdAt - a.createdAt);
      setChatIdeas(all.slice(0, 15));
    } catch (e: any) {
      setChatError(e?.message || 'Could not read the conversation history.');
    } finally {
      setChatLoading(false);
    }
  };

  const openChatSection = () => {
    setChatOpen(true);
    if (!chatIdeas) loadChatIdeas();
  };

  /** One idea → one ordinary job, via the shared composition. */
  const createFromChatIdea = async (idea: { id: string; content: string; createdAt: number }) => {
    await run('new', () => api()?.mediaCreate?.(chatIdeaToJobInput(idea)));
  };

  /** Ancient Pathways episode catalogue & status loader */
  const loadAncientPathways = async () => {
    setApLoading(true);
    setApError(null);
    try {
      const res = await api()?.mediaAncientPathwaysEpisodes?.();
      if (res?.ok && Array.isArray(res.episodes)) {
        setApEpisodes(res.episodes);
      } else {
        setApError(res?.error || 'Could not load Ancient Pathways episodes.');
      }
      const st = await api()?.mediaAncientPathwaysStatus?.();
      if (st) setApStatus(st);
    } catch (e: any) {
      setApError(e?.message || 'Could not connect to Ancient Pathways.');
    } finally {
      setApLoading(false);
    }
  };

  const openApSection = () => {
    setApOpen(true);
    if (!apEpisodes) loadAncientPathways();
  };

  const produceAncientPathwaysEpisode = async (episodeId: string) => {
    await run('new', async () => {
      const res = await api()?.mediaAncientPathwaysRun?.(episodeId);
      if (res?.ok) {
        setDone(`Episode complete: ${res.renderPath ? '1080p master video ready to review' : 'Finished'}`);
      }
      return res;
    }, `Producing ${episodeId} episode…`);
  };

  const runShowrunner = async () => {
    if (!showrunnerPrompt.trim() || !showrunnerCharacters.trim() || !showrunnerName.trim()) {
      setError('Please fill in prompt, characters, and a production name.');
      return;
    }
    setShowrunnerBusy(true);
    setError(null);
    try {
      const res = await api()?.mediaAncientPathwaysShowrunner?.({
        prompt: showrunnerPrompt,
        duration: showrunnerDuration,
        characters: showrunnerCharacters,
        name: showrunnerName,
      });
      if (res?.ok) {
        setDone(`Showrunner complete: ${res.renderPath ? '1080p master video ready to review' : 'Finished'}`);
        setShowrunnerPrompt('');
        setShowrunnerCharacters('');
        setShowrunnerName('');
      } else {
        setError(res?.error || 'Showrunner failed.');
      }
      return res;
    } catch (e: any) {
      setError(e?.message || 'Failed to start showrunner.');
    } finally {
      setShowrunnerBusy(false);
    }
  };

    const runMovieRouter = async (projectDir: string) => {
    setMovieRunning(true);
    setMovieError(null);
    setMovieResult(null);
    try {
      const res = await api()?.mediaMovieRun?.({ projectDir });
      if (res?.ok && res.report) {
        const r = res.report;
        const msg = [];
        if (r.completedShots > 0) msg.push(`${r.completedShots} shot(s) generated`);
        if (r.skippedShots > 0) msg.push(`${r.skippedShots} skipped (already done)`);
        if (r.deferredShots > 0) msg.push(`${r.deferredShots} deferred to worker`);
        if (r.failedShots > 0) msg.push(`${r.failedShots} failed`);
        setMovieResult(msg.join(', ') || 'Pipeline complete');
      } else {
        setMovieError(res?.error || 'Generation router failed.');
      }
    } catch (e: any) {
      setMovieError(e?.message || 'Failed to run generation router.');
    } finally {
      setMovieRunning(false);
    }
  };

  const loadMovieProjects = async () => {
    if (!movieProjects) {
      try {
        const res = await api()?.mediaMovieListProjects?.();
        if (res?.ok) {
          setMovieProjects(res.projects ?? []);
        } else {
          setMovieError(res?.error || 'Could not list movie projects.');
        }
      } catch (e: any) {
        setMovieError(e?.message || 'Could not list movie projects.');
      }
    }
  };

const runDoctorCheck = async (episodeId: string) => {
    setApDoctorChecks(prev => ({
      ...prev,
      [episodeId]: { ...(prev[episodeId] || { checks: [], failed: 0 }), loading: true }
    }));
    try {
      const res = await api()?.mediaAncientPathwaysDoctor?.(episodeId);
      if (res?.ok) {
        setApDoctorChecks(prev => ({
          ...prev,
          [episodeId]: { checks: res.checks || [], failed: res.failed || 0, loading: false }
        }));
      } else {
        setApDoctorChecks(prev => ({
          ...prev,
          [episodeId]: { checks: [], failed: 1, loading: false }
        }));
      }
    } catch {
      setApDoctorChecks(prev => ({
        ...prev,
        [episodeId]: { checks: [], failed: 1, loading: false }
      }));
    }
  };

  /** Neural voices for the narration picker — loaded once, on first use. */
  const ensureVoices = async () => {
    if (voices || narrateEngine === 'kokoro') return; // kokoro's list is local, nothing to fetch
    try {
      const res = await api()?.ttsListVoices?.();
      const list = res?.result?.voices;
      if (Array.isArray(list)) setVoices(list);
    } catch { /* picker stays on "Default voice" — narration still works */ }
  };

  // The saved engine preference loads once; changing it here persists it, so
  // tomorrow's videos keep the voice you chose today.
  useEffect(() => {
    let cancelled = false;
    api()?.getSettings?.().then((s: any) => {
      if (!cancelled && s?.narrationEngine === 'kokoro') setNarrateEngine('kokoro');
    }).catch(() => { /* default Edge applies */ });
    return () => { cancelled = true; };
  }, []);

  const changeNarrateEngine = (engine: '' | 'edge' | 'kokoro') => {
    setNarrateEngine(engine);
    setNarrateVoice(''); // an Edge voice name is meaningless under Kokoro
    try { api()?.saveSettings?.({ narrationEngine: engine === 'kokoro' ? 'kokoro' : 'edge' }); } catch { /* preference stays session-local */ }
  };

  /** Render a short sample of a voice to a temp file and play it inline.
   *  Routed through the SAME engine that will record — approving by ear a
   *  sample from the other engine would approve a voice never shipped. */
  const sampleVoice = async (voice: string) => {
    setSampling(voice);
    try {
      const res = await api()?.ttsSampleVoice?.(
        narrateEngine === 'kokoro' ? (voice || 'af_heart') : voice,
        undefined,
        narrateEngine === 'kokoro' ? 'kokoro' : undefined,
      );
      if (res?.success && res.path) {
        // Same file:// playback the job previews use — no extra channel.
        setSamplePath(res.path);
      } else {
        setError(res?.error || 'Could not render the voice sample.');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not render the voice sample.');
    } finally {
      setSampling(null);
    }
  };

  // Context handed over when chat or the assistant sent the user to Media Studio.
  // Without this, the handoff is only a redirect to an empty panel.
  useEffect(() => {
    if (!navContext) return;

    const targetJobId = typeof navContext.jobId === 'string'
      ? navContext.jobId.trim()
      : (typeof navContext.id === 'string' ? navContext.id.trim() : '');
    if (targetJobId) {
      setHighlightedJobId(targetJobId);
    }

    const t = typeof navContext.title === 'string' ? navContext.title.trim() : (
      typeof navContext.topic === 'string' ? navContext.topic.trim() : (
        typeof navContext.idea === 'string' ? navContext.idea.trim() : ''
      )
    );
    if (t) setTitle(prev => prev || t);

    if (navContext.format === 'short' || navContext.format === 'long') {
      setFormat(navContext.format);
    }

    const source = typeof navContext.source === 'string' ? navContext.source.trim().toLowerCase() : '';
    const episodeId = typeof navContext.episodeId === 'string' ? navContext.episodeId.trim() : '';
    const search = typeof navContext.search === 'string' ? navContext.search.trim() : '';

    if (source === 'ancient-pathways' || episodeId || search) {
      setApOpen(true);
      loadAncientPathways();
      if (episodeId) setApSearch(episodeId);
      else if (search) setApSearch(search);
    } else if (source === 'chat') {
      setChatOpen(true);
      loadChatIdeas();
    }

    const feed = typeof navContext.feedUrl === 'string' ? navContext.feedUrl.trim() : (
      typeof navContext.url === 'string' && (source === 'podcast' || source === 'feed') ? navContext.url.trim() : ''
    );
    if (feed) {
      setFeedOpen(true);
      setFeedUrl(feed);
      loadFeed(feed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navContext]);

  // Scroll to and highlight a specific job when targeted by navigation or creation handoff
  useEffect(() => {
    if (!highlightedJobId || !jobs.length) return;
    const el = document.querySelector(`[data-job-id="${highlightedJobId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ms-job--highlighted');
      const timer = setTimeout(() => {
        el.classList.remove('ms-job--highlighted');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightedJobId, jobs]);

  const getJobProgressStep = (j: MediaJob): number => {
    if (['idea', 'researching', 'script_draft', 'script_qa'].includes(j.state)) return 1;
    if (j.state === 'media_production') {
      if (!j.narrationPath) return 2;
      if (!j.renderPath) return 3;
      return 4;
    }
    if (['render_qa', 'awaiting_approval', 'approved', 'scheduled', 'published'].includes(j.state)) return 4;
    if (j.renderPath) return 4;
    if (j.narrationPath) return 3;
    if (j.script) return 2;
    return 1;
  };

  const awaiting = jobs.filter(j => j.state === 'awaiting_approval');
  const active = jobs.filter(j => j.state !== 'awaiting_approval' && !FAILURE.includes(j.state));
  const stalled = jobs.filter(j => FAILURE.includes(j.state));

  const renderJob = (j: MediaJob, showApproval: boolean) => (
    <li
      key={j.id}
      className={`ms-job ${highlightedJobId === j.id ? 'ms-job--highlighted' : ''}`}
      data-job-id={j.id}
    >
      <div className="ms-job-main">
        <span className="ms-job-title">{j.title}</span>
        <span className="ms-job-format">
          {j.format === 'long' ? 'long-form' : 'short'}
          {j.durationSeconds ? ` · ${j.durationSeconds}s recorded` : ''}
          {j.narratedWith ? ` · narrated: ${j.narratedWith}` : ''}
        </span>

        {/* 4-Step User-Friendly Progress Stepper */}
        {(() => {
          const currentStep = getJobProgressStep(j);
          const steps = [
            { num: 1, label: 'Story & Script' },
            { num: 2, label: 'Voice & Audio' },
            { num: 3, label: 'Animation & Visuals' },
            { num: 4, label: '1080p Video' },
          ];
          return (
            <div className="ms-stepper" aria-label={`Progress: Step ${currentStep} of 4`}>
              {steps.map((s, idx) => {
                const isDone = currentStep > s.num || j.state === 'published';
                const isActive = currentStep === s.num && j.state !== 'published';
                return (
                  <React.Fragment key={s.num}>
                    <div className={`ms-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
                      <span className="ms-step-dot" />
                      <span>{s.num}. {s.label}</span>
                    </div>
                    {idx < steps.length - 1 && <div className="ms-step-line" />}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}

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
          <>
            <div className="ms-ready-banner" role="status">
              <span style={{ fontSize: '1.2rem' }}>🎉</span>
              <div>
                <strong>Your episode is ready to watch!</strong> Play the video below, then approve below to publish.
              </div>
            </div>
            <video
              className="ms-video"
              controls
              preload="metadata"
              data-testid={`ms-video-${j.id}`}
              src={`file:///${j.renderPath.replace(/\\/g, '/')}`}
            />
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="ms-btn"
                onClick={() => api()?.showInFolder?.(j.renderPath!)}
                title="Reveal MP4 in Windows File Explorer"
              >
                📂 Open file location
              </button>
            </div>
          </>
        ) : j.narrationPath ? (
          /* Hearing the narration is the only way to judge it before there is
             a picture. file:// works because the renderer loads from disk. */
          <audio
            className="ms-audio"
            controls
            preload="none"
            data-testid={`ms-audio-${j.id}`}
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
          // Narration offers the voice picker inline: pick, hear a sample,
          // then record — without a trip to Settings.
          <>
            {stageAction(j)!.action === 'narrate' && (
              <select
                className="ms-input ms-engine-select"
                value={narrateEngine}
                onChange={e => changeNarrateEngine(e.target.value as '' | 'edge' | 'kokoro')}
                aria-label="Narration engine"
              >
                {NARRATION_ENGINES.map(e => (
                  <option key={e.label} value={e.value}>{e.label}</option>
                ))}
              </select>
            )}
            {stageAction(j)!.action === 'narrate' && narrateEngine !== 'kokoro' && (
              <select
                className="ms-input ms-voice-select"
                value={narrateVoice}
                onChange={e => setNarrateVoice(e.target.value)}
                onFocus={ensureVoices}
                aria-label="Narration voice"
              >
                <option value="">Default voice</option>
                {(voices || []).map(v => (
                  <option key={v.name} value={v.name}>{v.friendlyName || v.name}</option>
                ))}
              </select>
            )}
            {stageAction(j)!.action === 'narrate' && narrateEngine === 'kokoro' && (
              <select
                className="ms-input ms-voice-select"
                value={narrateVoice}
                onChange={e => setNarrateVoice(e.target.value)}
                aria-label="Kokoro narration voice"
              >
                <option value="">Heart (default)</option>
                {KOKORO_VOICES.map(v => (
                  <option key={v.name} value={v.name}>{v.label}</option>
                ))}
              </select>
            )}
            {stageAction(j)!.action === 'narrate' && (narrateVoice || narrateEngine === 'kokoro') && (
              <button
                className="ms-btn"
                disabled={sampling !== null}
                onClick={() => sampleVoice(narrateVoice)}
              >
                {sampling !== null ? 'Rendering…' : '▶ Sample'}
              </button>
            )}
            <button
              className="ms-btn ms-btn--primary"
              onClick={() => {
                const a = stageAction(j)!;
                run(j.id, () => api()?.mediaRun?.(j.id, a.action, a.action === 'narrate'
                  ? {
                      voice: narrateVoice || undefined,
                      engine: narrateEngine === 'kokoro' ? 'kokoro' : undefined,
                    }
                  : undefined), a.label);
              }}
            >
              {stageAction(j)!.label}
            </button>
          </>
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
              onConfirm: () => run(j.id, () => releaseMediaThen(j.id, () => api()?.mediaDelete?.(j.id)), 'Deleting'),
            })}
          >Delete</button>
        )}
      </div>
    </li>
  );

  const filteredEpisodes = (apEpisodes || []).filter(ep => {
    if (seasonFilter !== 0 && ep.season !== seasonFilter) return false;
    if (!apSearch.trim()) return true;
    const q = apSearch.toLowerCase();
    return (
      (ep.code && ep.code.toLowerCase().includes(q)) ||
      (ep.id && ep.id.toLowerCase().includes(q)) ||
      ep.title.toLowerCase().includes(q) ||
      ep.era.toLowerCase().includes(q) ||
      ep.mainCharacter.toLowerCase().includes(q) ||
      (ep.summary && ep.summary.toLowerCase().includes(q))
    );
  });

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

      {/* The one dependency the app does not ship. Shown before anything fails,
          so the wall is hit at "here is the button" rather than at the end of a
          pipeline the user already spent a minute on. */}
      {engine && !engine.ready && (
        <div className="ms-engine" role="status">
          {engineBusy ? (
            <span className="ms-working" aria-live="polite">
              <span className="ms-spinner" aria-hidden="true" />
              {engineNote || 'Setting up the video engine…'}
            </span>
          ) : (
            <>
              <span className="ms-engine-text">
                Making videos needs a one-off download (about 160 MB). Scripts, narration
                and captions all work without it.
              </span>
              {engine.supported ? (
                <button className="ms-btn ms-btn--primary" onClick={setUpEngine}>
                  Set it up for me
                </button>
              ) : (
                <a
                  className="ms-btn"
                  href="https://ffmpeg.org/download.html"
                  target="_blank"
                  rel="noreferrer"
                >Show me how</a>
              )}
            </>
          )}
        </div>
      )}

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
          <button type="button" className="ms-btn ms-btn-icon-podcast" onClick={() => setFeedOpen(true)}>
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
                onClick={() => loadFeed()}
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

      {/* A third source: an idea already brainstormed in chat. The user's own
          words become the job's brief (chat-idea.ts), so the script stage works
          from what they actually said. Same ordinary job, same approval gate. */}
      <div className="ms-feed">
        {!chatOpen ? (
          <button type="button" className="ms-btn ms-btn-icon-chat" onClick={openChatSection}>
            From chat…
          </button>
        ) : (
          <>
            <div className="ms-feed-row">
              <span className="ms-feed-ep-meta" style={{ alignSelf: 'center' }}>
                Recent messages you sent, newest first.
              </span>
              <button
                type="button"
                className="ms-btn"
                onClick={() => { setChatOpen(false); setChatIdeas(null); setChatError(null); }}
                aria-label="Close chat ideas section"
              >✕</button>
            </div>
            {chatError && <div className="ms-error" role="alert">{chatError}</div>}
            {chatLoading && <div className="ms-feed-ep-meta">Looking…</div>}
            {chatIdeas && chatIdeas.length === 0 && (
              <div className="ms-feed-ep-meta">No recent messages long enough to be an idea.</div>
            )}
            {chatIdeas && chatIdeas.length > 0 && (
              <ul className="ms-feed-episodes" aria-label="Recent chat ideas">
                {chatIdeas.map(idea => (
                  <li key={idea.id} className="ms-feed-episode">
                    <div className="ms-feed-ep-main">
                      <span className="ms-feed-ep-title">{deriveIdeaTitle(idea.content)}</span>
                      <span className="ms-feed-ep-meta">
                        {idea.content.length > 90 ? `${idea.content.slice(0, 90)}…` : idea.content}
                      </span>
                    </div>
                    <button
                      className="ms-btn ms-btn--primary"
                      disabled={busy === 'new'}
                      onClick={() => createFromChatIdea(idea)}
                    >
                      Make a video
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Ancient Pathways: Broadcast-grade animated historical video essay series */}
      <div className="ms-feed">
        {!apOpen ? (
          <button type="button" className="ms-btn ms-btn-icon-ap" onClick={openApSection}>
            From Ancient Pathways…
          </button>
        ) : (
          <div className="ms-ap-showcase">
            <div className="ms-ap-hero">
              <div>
                <h3>🏛️ Ancient Pathways: Leila &amp; Flappy 2D Animated History</h3>
                <p>
                  Produce broadcast-ready 2D animated history documentaries with voice acting,
                  historical backgrounds, and sound design in 1 click.
                </p>
              </div>
              <button
                type="button"
                className="ms-btn"
                onClick={() => { setApOpen(false); setApError(null); }}
                aria-label="Close Ancient Pathways section"
              >✕ Close</button>
             </div>

             {/* Showrunner: free-first autonomous prompt-to-movie production */}
             <div className="ms-ap-showrunner">
               <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>🎬 Showrunner — Generate a Scene</h4>
               <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#888' }}>
                 One-click autonomous production: type a prompt, pick characters, and the full pipeline
                 (storyboard → voices → animation → broadcast audio mix) runs at 100% free cost.
               </p>
               <div className="ms-ap-showrunner-form">
                 <textarea
                   className="ms-input ms-ap-showrunner-prompt"
                   placeholder="Prompt: e.g. 'Imhotep approaches and enters the great temple of Karnak at golden hour'"
                   value={showrunnerPrompt}
                   onChange={e => setShowrunnerPrompt(e.target.value)}
                   disabled={showrunnerBusy || !!apStatus?.lock?.locked}
                   rows={3}
                   aria-label="Showrunner prompt"
                 />
                 <div className="ms-ap-showrunner-row">
                   <input
                     type="number"
                     className="ms-input ms-ap-showrunner-duration"
                     placeholder="Duration (seconds)"
                     value={showrunnerDuration}
                     onChange={e => setShowrunnerDuration(Number(e.target.value) || 60)}
                     min={5}
                     max={600}
                     disabled={showrunnerBusy}
                     aria-label="Duration in seconds"
                   />
                   <input
                     type="text"
                     className="ms-input ms-ap-showrunner-chars"
                     placeholder="Characters (e.g. IMHOTEP,LEILA)"
                     value={showrunnerCharacters}
                     onChange={e => setShowrunnerCharacters(e.target.value)}
                     disabled={showrunnerBusy || !!apStatus?.lock?.locked}
                     aria-label="Character names"
                   />
                   <input
                     type="text"
                     className="ms-input ms-ap-showrunner-name"
                     placeholder="Production name"
                     value={showrunnerName}
                     onChange={e => setShowrunnerName(e.target.value)}
                     disabled={showrunnerBusy || !!apStatus?.lock?.locked}
                     aria-label="Production name"
                   />
                 </div>
                 <button
                   type="button"
                   className="ms-btn ms-btn--primary ms-ap-showrunner-btn"
                   disabled={showrunnerBusy || !showrunnerPrompt.trim() || !!apStatus?.lock?.locked}
                   onClick={runShowrunner}
                 >
                   {showrunnerBusy ? 'Generating…' : 'Generate Scene'}
                 </button>
                 {showrunnerBusy && (
                   <span className="ms-working" style={{ marginLeft: 8 }}>
                     <span className="ms-spinner" /> Producing broadcast-master scene…
                   </span>
                 )}
               </div>
             </div>

              {/* Generation Router -- shot-level routing through all 5 providers */}
              <div className="ms-ap-movie-router">
                <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Generation Router</h4>
                <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#888' }}>
                  Route individual shots through the best-available free provider:
                  Ancient Pathways 2D, Colab T4 IP-Adapter, Pollinations, Imagen 3, or Local SD 1.5.
                </p>
                <button
                  type="button"
                  className="ms-btn ms-btn--secondary"
                  disabled={movieRunning || !!movieProjects}
                  onClick={loadMovieProjects}
                >
                  {movieProjects ? 'Projects Loaded' : (movieRunning ? 'Loading...' : 'Load Projects')}
                </button>
                {movieProjects && movieProjects.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {movieProjects.map((p: any) => {
                      const label = p.name || p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="ms-btn"
                          style={{ marginRight: 8, marginTop: 4 }}
                          disabled={movieRunning}
                          onClick={() => runMovieRouter((p as any).projectDir || p.id)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {movieRunning && (
                  <span className="ms-working" style={{ marginLeft: 8 }}>
                    <span className="ms-spinner" /> Running generation router...
                  </span>
                )}
                {movieResult && (
                  <div className="ms-state ms-state--ok" style={{ marginTop: 8, padding: '8px 12px' }}>
                    {movieResult}
                  </div>
                )}
                {movieError && (
                  <div className="ms-error" role="alert" style={{ marginTop: 8 }}>
                    {movieError}
                  </div>
                )}
              </div>


             {apStatus?.lock?.locked && (
              <div className="ms-state ms-state--bad" style={{ marginBottom: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🔒</span>
                <span>{apStatus.lock.message || 'Another render is active (PID 4444)'}</span>
              </div>
            )}

            {apError && <div className="ms-error" role="alert">{apError}</div>}
            {apLoading && <span className="ms-working"><span className="ms-spinner" />Looking for episodes…</span>}
            {apEpisodes && (
              <>
                <div className="ms-ap-controls">
                  <div className="ms-ap-pills" role="radiogroup" aria-label="Filter by season">
                    <button
                      type="button"
                      className={`ms-ap-pill ${seasonFilter === 0 ? 'active' : ''}`}
                      onClick={() => setSeasonFilter(0)}
                    >
                      All Episodes ({apEpisodes.length})
                    </button>
                    <button
                      type="button"
                      className={`ms-ap-pill ${seasonFilter === 1 ? 'active' : ''}`}
                      onClick={() => setSeasonFilter(1)}
                    >
                      Season 1: Ancient Wonders ({apEpisodes.filter(e => e.season === 1).length})
                    </button>
                    <button
                      type="button"
                      className={`ms-ap-pill ${seasonFilter === 2 ? 'active' : ''}`}
                      onClick={() => setSeasonFilter(2)}
                    >
                      Season 2: Empires &amp; Builders ({apEpisodes.filter(e => e.season === 2).length})
                    </button>
                  </div>
                  <input
                    type="text"
                    className="ms-input ms-ap-search"
                    placeholder="Search civilizations, heroes…"
                    value={apSearch}
                    onChange={e => setApSearch(e.target.value)}
                    aria-label="Search episodes"
                  />
                </div>

                <ul className="ms-feed-episodes ms-ap-grid" aria-label="Ancient Pathways episodes">
                  {filteredEpisodes.map(ep => (
                    <li key={ep.id} className="ms-ap-card">
                      <div className="ms-ap-card-top">
                        <div className="ms-ap-avatar" aria-hidden="true">
                          {ep.emoji || '🏛️'}
                        </div>
                        <div className="ms-ap-card-details">
                          <span className="ms-job-format" style={{ alignSelf: 'flex-start', marginBottom: 2 }}>
                            Season {ep.season} · {ep.code}
                          </span>
                          <span className="ms-ap-card-title">{ep.title}</span>
                          <span className="ms-ap-card-meta">
                            {ep.era} · {ep.mainCharacter} · {ep.sceneCount} scenes
                          </span>
                        </div>
                      </div>
                      {ep.summary && (
                        <p className="ms-ap-card-summary">{ep.summary}</p>
                      )}
                      {apDoctorChecks[ep.id] && (
                        <div className="ms-ap-card-doctor">
                          {apDoctorChecks[ep.id].loading ? (
                            <span className="ms-working"><span className="ms-spinner" />Checking quality...</span>
                          ) : apDoctorChecks[ep.id].failed > 0 ? (
                            <div className="ms-ap-doctor-fail">
                              <span className="ms-doctor-status">⚠️ {apDoctorChecks[ep.id].failed} check(s) failed</span>
                              <details style={{ marginTop: 4 }}>
                                <summary style={{ cursor: 'pointer', color: '#666' }}>View details</summary>
                                <ul style={{ margin: 4, paddingLeft: 20 }}>
                                  {apDoctorChecks[ep.id].checks.filter(c => !c.ok).map((check, i) => (
                                    <li key={i} style={{ fontSize: 12, marginBottom: 2 }}>{check.name}: {check.detail}</li>
                                  ))}
                                </ul>
                              </details>
                            </div>
                          ) : (
                            <span className="ms-ap-doctor-pass">✓ All quality checks passed</span>
                          )}
                        </div>
                      )}
                      <button
                        className="ms-btn ms-ap-doctor-btn"
                        style={{ marginTop: 4 }}
                        onClick={() => runDoctorCheck(ep.id)}
                        disabled={busy !== null || apDoctorChecks[ep.id]?.loading}
                      >
                        {apDoctorChecks[ep.id]?.loading ? 'Checking…' : 'Run Quality Check'}
                      </button>
                      <button
                        className="ms-btn ms-btn--primary ms-ap-card-btn"
                        disabled={busy !== null || !!apStatus?.lock?.locked}
                        onClick={() => produceAncientPathwaysEpisode(ep.id)}
                      >
                        Produce Episode
                      </button>
                    </li>
                  ))}
                  {filteredEpisodes.length === 0 && (
                    <li className="ms-feed-ep-meta" style={{ padding: 16 }}>
                      No episodes match your search.
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {jobs.length === 0 && (
        <p className="ms-empty">
          No videos yet. Add one above, or ask in chat — “start a short video called …”.
        </p>
      )}

      {/* A rendered voice sample, played inline — hear it before recording. */}
      {samplePath && (
        <audio
          className="ms-audio"
          controls
          autoPlay
          src={`file:///${samplePath.replace(/\\/g, '/')}`}
        />
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
