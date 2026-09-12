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
import { useTimelinePlayback } from './useTimelinePlayback';
import { MultiPlaneStage } from './MultiPlaneStage';
import {
  type CameraMotion,
  type StageFraming,
  type SettingLighting,
  LIGHTING_PRESETS,
} from '../../shared/multi-plane-stage';

/**
 * Safely format local filesystem paths into valid file:/// URLs for Chromium.
 * Handles backslashes, spaces, and escapes # (%23) and ? (%3F) so that
 * file paths containing hash symbols or special characters do not break.
 */
export function toMediaFileUrl(filePath: string | null | undefined): string {
  if (!filePath) return '';
  if (filePath.startsWith('data:')) return filePath;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return encodeURI(`file:///${normalized}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

/**
 * Maps Timeline Color Grade LUT presets to GPU-accelerated live CSS preview filters.
 */
export function getLutCssFilter(lut: 'rec709' | 'warm_nile' | 'teal_orange' | 'nocturne'): string {
  switch (lut) {
    case 'warm_nile':
      return 'sepia(0.35) contrast(1.1) saturate(1.2) brightness(0.95)';
    case 'teal_orange':
      return 'contrast(1.15) hue-rotate(-10deg) saturate(1.25)';
    case 'nocturne':
      return 'brightness(0.75) contrast(1.2) hue-rotate(180deg) saturate(0.6)';
    case 'rec709':
    default:
      return 'none';
  }
}

export const DEFAULT_STAGE_BG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080' viewBox='0 0 1920 1080'><defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='%231a2035'/><stop offset='60%' stop-color='%232c3e55'/><stop offset='100%' stop-color='%234a5d6e'/></linearGradient><linearGradient id='floor' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='%23232733'/><stop offset='100%' stop-color='%2312141a'/></linearGradient></defs><rect width='1920' height='720' fill='url(%23sky)'/><rect y='720' width='1920' height='360' fill='url(%23floor)'/><path d='M0 720 L1920 720' stroke='%23d97706' stroke-width='3'/><circle cx='960' cy='420' r='180' fill='%23fbbf24' opacity='0.15'/><rect x='280' y='220' width='90' height='500' fill='%23334155' rx='8'/><rect x='1550' y='220' width='90' height='500' fill='%23334155' rx='8'/><rect x='520' y='280' width='70' height='440' fill='%231e293b' rx='6'/><rect x='1330' y='280' width='70' height='440' fill='%231e293b' rx='6'/></svg>";

export const DEFAULT_STAGE_FG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080' viewBox='0 0 1920 1080'><rect x='150' y='820' width='320' height='260' fill='%230f172a' rx='12' opacity='0.95'/><rect x='1450' y='780' width='380' height='300' fill='%230f172a' rx='12' opacity='0.95'/><path d='M100 880 L520 880' stroke='%23475569' stroke-width='8'/><path d='M1400 840 L1880 840' stroke='%23475569' stroke-width='8'/></svg>";

/** Mirrors ImageGenerator.tsx's local shape — same IPC contract, not shared. */
interface SDCppStatus {
  ready: boolean;
  hasBinary: boolean;
  hasModel: boolean;
  dir: string;
  modelsDir: string;
}

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

const DIRECTOR_PRESETS = [
  { label: '🏛️ Ancient Egypt', genre: 'historical_epic', prompt: 'Imhotep unrolls the Great Pyramid blueprints under the golden dusk of Giza as the stone masons raise the massive granite pillars.' },
  { label: '🤖 Cyberpunk 2088', genre: 'cyberpunk_scifi', prompt: 'A cybernetic detective in a rain-soaked neon alley tracks an encrypted AI memory core hidden in an abandoned terminal.' },
  { label: '🚀 Deep Space', genre: 'cyberpunk_scifi', prompt: 'An astronaut ventures outside the orbital station to investigate an ancient glowing alien beacon drifting in Saturn’s rings.' },
  { label: '🐆 Nature Wildlife', genre: 'documentary_nature', prompt: 'A snow leopard stalks silently across the Himalayan mountain ridge at dawn, eyes fixed on the distant prey.' },
  { label: '🕵️ Film Noir', genre: 'noir_thriller', prompt: 'Detective Malone sits in a smoke-filled office in 1948 when a mysterious shadowed figure slips a blackmail envelope under the door.' },
];

export const MediaStudioPanel: React.FC<MediaStudioPanelProps> = ({ navContext }) => {
  const [confirmDialog, confirm] = useConfirmDestructive();
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  // Workspace Mode: 'director' | 'timeline' | 'stage' | 'router' | 'ap' | 'storyboard'
  const [activeWorkspace, setActiveWorkspace] = useState<'director' | 'timeline' | 'stage' | 'router' | 'ap' | 'storyboard'>('director');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // CapCut Timeline State
  const [timelineTime, setTimelineTime] = useState<number>(0);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [timelineLoop, setTimelineLoop] = useState<boolean>(true);
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [timelineMediaDuration, setTimelineMediaDuration] = useState<number | null>(null);
  const [clipCuts, setClipCuts] = useState<number[]>([]);
  const [selectedClipIndex, setSelectedClipIndex] = useState<number | null>(0);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [snappingEnabled, setSnappingEnabled] = useState<boolean>(true);
  const [trackMuted, setTrackMuted] = useState<Record<string, boolean>>({ V1: false, A1: false, A2: false, A3: false, T1: false });
  const [trackLocked, setTrackLocked] = useState<Record<string, boolean>>({ V1: false, A1: false, A2: false, A3: false, T1: false });
  const [trackHidden, setTrackHidden] = useState<Record<string, boolean>>({ V1: false, A1: false, A2: false, A3: false, T1: false });
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'transitions' | 'audio' | 'export'>('properties');
  const [clipSpeed, setClipSpeed] = useState<number>(1.0);
  const [clipFraming, setClipFraming] = useState<'WIDE' | 'MED' | 'CU' | 'EXTREME CU'>('WIDE');
  const [selectedTransition, setSelectedTransition] = useState<'none' | 'cross_dissolve' | 'fade_black' | 'whip_pan' | 'glitch'>('none');
  const [colorGradeLut, setColorGradeLut] = useState<'rec709' | 'warm_nile' | 'teal_orange' | 'nocturne'>('rec709');
  const [bgmDuckingLevel, setBgmDuckingLevel] = useState<number>(-18);
  const [voiceGain, setVoiceGain] = useState<number>(100);

  // Blender Viewport & Camera Stage State
  const [stageAspectRatio, setStageAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [stageOverlays, setStageOverlays] = useState<boolean>(true);
  const [stageSafeAreas, setStageSafeAreas] = useState<boolean>(true);
  const [stageGrid, setStageGrid] = useState<boolean>(true);
  const [stageReticle, setStageReticle] = useState<boolean>(true);
  const [stageCameraPreset, setStageCameraPreset] = useState<'35mm' | '50mm' | '85mm'>('35mm');
  const [stageMotionPreset, setStageMotionPreset] = useState<'static' | 'pan' | 'zoom' | 'orbit'>('static');
  const [stageLightingPreset, setStageLightingPreset] = useState<'dawn' | 'torch' | 'noon' | 'neon'>('dawn');
  const [stageScrubProgress, setStageScrubProgress] = useState<number>(0.5);
  const [selectedSeriesId] = useState<string>('ancient-pathways');
  const [selectedSettingId, setSelectedSettingId] = useState<string>('');
  const [availableSettings, setAvailableSettings] = useState<Array<{ id: string; name: string; hasForeground: boolean }>>([]);
  const [activeSettingBundle, setActiveSettingBundle] = useState<any>(null);
  const [isSegmenting, setIsSegmenting] = useState<boolean>(false);
  const [renderedMovieJobId, setRenderedMovieJobId] = useState<string | null>(null);
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

  // YouTube upload dialog state
  const [youtubeStatus, setYoutubeStatus] = useState<import('../../shared/youtube-connection').YouTubeConnectionStatus | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadPrivacy, setUploadPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [uploadUseThumbnail, setUploadUseThumbnail] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Local image generation (sd.cpp) readiness — same shape and IPC surface as
  // ImageGenerator.tsx's "/Image" mode, which already has a working one-click
  // setup. "Make the video" (media_production's render stage) was silently
  // going straight to network image providers (Pollinations, Stable Horde —
  // unSLA'd, nondeterministic, prompt egress) whenever nothing local was
  // installed. This surfaces the choice instead of deciding it for the user.
  const [sdCppStatus, setSdCppStatus] = useState<SDCppStatus | null>(null);
  /** The job id whose "Make the video" click is paused on this choice, if any. */
  const [sdCppPromptFor, setSdCppPromptFor] = useState<string | null>(null);
  const [sdCppSetup, setSdCppSetup] = useState<{ phase: string; note: string; receivedMB?: number; totalMB?: number | null } | null>(null);
  const sdCppSetupRunning = !!sdCppSetup && sdCppSetup.phase !== 'done' && sdCppSetup.phase !== 'error';

  useEffect(() => {
    (window as any).electron?.sdCppStatus?.().then((s: SDCppStatus) => setSdCppStatus(s));
    const off = (window as any).electron?.onSdCppSetupProgress?.((p: any) => setSdCppSetup(p));
    return () => off?.();
  }, []);
  void sdCppStatus;
  void sdCppPromptFor;
  void setSdCppPromptFor;
  void sdCppSetupRunning;

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

  // Visual Storyboard Deck State
  const [storyboardProjects, setStoryboardProjects] = useState<Array<{
    projectId: string;
    title: string;
    createdAt: string;
    notes?: string;
    totalShots: number;
    renderedFrames: number;
    totalDurationSec: number;
    projectDir: string;
  }> | null>(null);
  const [selectedStoryboardId, setSelectedStoryboardId] = useState<string | null>(null);
  const [selectedStoryboardSceneId, setSelectedStoryboardSceneId] = useState<string | null>(null);
  const [activeStoryboard, setActiveStoryboard] = useState<{
    project: Record<string, any>;
    scenes: Array<{
      sceneId: string;
      title?: string;
      shots: Array<{
        shotId: string;
        order: number;
        prompt: string;
        framing: string;
        lens: string;
        movement: string;
        durationSec: number;
        narration: string;
        status: string;
        frameImagePath: string | null;
        /** True when a frame exists but its prompt has changed since it was generated. */
        frameStale?: boolean;
      }>;
    }>;
    projectDir: string;
  } | null>(null);
  const [storyboardLoading, setStoryboardLoading] = useState<boolean>(false);
  const [storyboardSaving, setStoryboardSaving] = useState<boolean>(false);
  const [generatingShotId, setGeneratingShotId] = useState<string | null>(null);
  const [newStoryboardTitle, setNewStoryboardTitle] = useState<string>('');
  const [newStoryboardNotes, setNewStoryboardNotes] = useState<string>('');
  const [isCreatingStoryboard, setIsCreatingStoryboard] = useState<boolean>(false);
  const [storyboardMessage, setStoryboardMessage] = useState<string | null>(null);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);

  // Script-to-Storyboard Director State
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorPrompt, setDirectorPrompt] = useState('');
  const [directorGenre, setDirectorGenre] = useState('auto');
  const [directorShotCount, setDirectorShotCount] = useState(4);
  const [directorTitle, setDirectorTitle] = useState('');
  const [directorAutoFrames, setDirectorAutoFrames] = useState(false);
  const [directorBusy, setDirectorBusy] = useState(false);

  // Animatic Player State
  const [animaticOpen, setAnimaticOpen] = useState(false);
  const [animaticPlaying, setAnimaticPlaying] = useState(false);
  const [animaticIndex, setAnimaticIndex] = useState(0);
  const [animaticElapsedSec, setAnimaticElapsedSec] = useState(0);
  const [animaticLoop, setAnimaticLoop] = useState(false);
  const [storyboardRendering, setStoryboardRendering] = useState(false);
  const [renderedMoviePath, setRenderedMoviePath] = useState<string | null>(null);
  const activeStoryboardScene = activeStoryboard?.scenes.find(scene => scene.sceneId === selectedStoryboardSceneId)
    || activeStoryboard?.scenes[0];
  const storyboardBusy = storyboardRendering || storyboardSaving || generatingShotId !== null;

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

  const loadSeriesSettings = useCallback(async (seriesId: string) => {
    try {
      const res = await api()?.mediaSeriesSettingsList?.(seriesId);
      if (res?.ok && Array.isArray(res.settings)) {
        setAvailableSettings(res.settings);
        if (res.settings.length > 0 && !selectedSettingId) {
          const firstId = res.settings[0].id;
          setSelectedSettingId(firstId);
          const bundleRes = await api()?.mediaSeriesSettingsGet?.(seriesId, firstId);
          if (bundleRes?.ok && bundleRes.bundle) {
            setActiveSettingBundle(bundleRes.bundle);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }, [selectedSettingId]);

  useEffect(() => {
    if (activeWorkspace === 'stage') {
      loadSeriesSettings(selectedSeriesId);
    }
  }, [activeWorkspace, selectedSeriesId, loadSeriesSettings]);

  const handleSelectSetting = async (settingId: string) => {
    setSelectedSettingId(settingId);
    if (!settingId) {
      setActiveSettingBundle(null);
      return;
    }
    try {
      const res = await api()?.mediaSeriesSettingsGet?.(selectedSeriesId, settingId);
      if (res?.ok && res.bundle) {
        setActiveSettingBundle(res.bundle);
      }
    } catch {
      /* ignore */
    }
  };

  const handleExtractForegroundRmbg = async () => {
    setError(null);
    if (!activeSettingBundle?.bgPath) {
      setDone('To extract foreground layers with CPU RMBG, select a custom setting plate first.');
      setTimeout(() => setDone(null), 4000);
      return;
    }
    setIsSegmenting(true);
    setBusy('rmbg-segment');
    setBusyLabel('Extracting foreground occlusion layer via CPU RMBG neural model (0 MB VRAM)...');
    try {
      const res = await api()?.mediaSeriesSettingsSegment?.({
        imageBase64: '',
        preferCpu: true,
      });
      if (res?.ok) {
        setDone('✓ Successfully extracted foreground occlusion layer using CPU RMBG!');
        await loadSeriesSettings(selectedSeriesId);
      } else {
        setError(res?.error || 'Foreground segmentation completed with no plate changes.');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to extract foreground plate.');
    } finally {
      setIsSegmenting(false);
      setBusy(null);
      setBusyLabel('');
    }
  };

  // Deep linking and cross-workspace handoff (e.g. from Chat or external tool invocation)
  useEffect(() => {
    if (navContext) {
      const workspace = (navContext.workspace as string) || '';
      if (workspace === 'storyboard') {
        setActiveWorkspace('storyboard');
        loadStoryboardProjects();
        if (navContext.storyboardId || navContext.projectId) {
          const id = (navContext.storyboardId || navContext.projectId) as string;
          setSelectedStoryboardId(id);
          loadStoryboard(id);
        }
        if (navContext.renderedMoviePath) {
          setRenderedMoviePath(navContext.renderedMoviePath as string);
        }

      } else if (workspace === 'timeline') {
        setActiveWorkspace('timeline');
      } else if (workspace === 'stage') {
        setActiveWorkspace('stage');
      } else if (workspace === 'router') {
        setActiveWorkspace('router');
        loadMovieProjects();
      } else if (workspace === 'ap') {
        setActiveWorkspace('ap');
        openApSection();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navContext]);

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

  /**
   * The actual stage-advancing call `.ms-job-actions`'s primary button makes.
   * Pulled out of the button's onClick so the sd.cpp prompt card can trigger
   * the same call after "Set it up for me" or "Continue with online instead"
   * — the original one-liner inlined this, which meant the render call could
   * only ever happen from the one place that used to make it immediately.
   */
  const runJobStage = (jobId: string, a: { label: string; action: 'script' | 'narrate' | 'render' }) => {
    run(jobId, () => api()?.mediaRun?.(jobId, a.action, a.action === 'narrate'
      ? {
          voice: narrateVoice || undefined,
          engine: narrateEngine === 'kokoro' ? 'kokoro' : undefined,
        }
      : undefined), a.label);
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

  const checkYouTubeStatus = useCallback(async () => {
    try {
      const res = await api()?.youtubeConnectionStatus?.();
      if (res?.ok && res.status) {
        setYoutubeStatus(res.status);
      }
    } catch { /* ignore */ }
  }, []);

  const openUploadDialog = (j: MediaJob) => {
    setUploadingFor(j.id);
    setUploadTitle(j.title || '');
    setUploadDesc(j.brief || (j.script ? j.script.slice(0, 500) : ''));
    setUploadTags('homebot, video');
    setUploadPrivacy('private');
    setUploadUseThumbnail(!!(j.scenePaths && j.scenePaths[0]));
    setUploadError(null);
    void checkYouTubeStatus();
  };

  const submitYouTubeUpload = async (j: MediaJob) => {
    if (!uploadTitle.trim()) {
      setUploadError('Please enter a video title.');
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    try {
      const thumb = uploadUseThumbnail && j.scenePaths?.[0] ? j.scenePaths[0] : undefined;
      const res = await api()?.youtubeUpload?.(j.id, {
        title: uploadTitle.trim(),
        description: uploadDesc.trim(),
        tags: uploadTags.split(',').map((t: string) => t.trim()).filter(Boolean),
        privacyStatus: uploadPrivacy,
        thumbnailPath: thumb,
      });
      if (res?.ok) {
        setDone(`🎉 Uploaded to YouTube! ${res.url || `ID: ${res.videoId}`}`);
        setUploadingFor(null);
        await refresh();
      } else {
        setUploadError(res?.error || 'Failed to upload video to YouTube.');
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload video to YouTube.');
    } finally {
      setUploadBusy(false);
    }
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

  const loadStoryboardProjects = async () => {
    setStoryboardLoading(true);
    setStoryboardError(null);
    try {
      const res = await api()?.mediaStoryboardList?.();
      if (res?.ok && Array.isArray(res.storyboards)) {
        setStoryboardProjects(res.storyboards);
        if (res.storyboards.length > 0 && !selectedStoryboardId) {
          const firstId = res.storyboards[0].projectId;
          setSelectedStoryboardId(firstId);
          await loadStoryboard(firstId);
        }
      } else {
        setStoryboardError(res?.error || 'Could not list storyboard projects.');
      }
    } catch (e: any) {
      setStoryboardError(e?.message || 'Could not list storyboard projects.');
    } finally {
      setStoryboardLoading(false);
    }
  };

  const loadStoryboard = async (projectId: string) => {
    setStoryboardLoading(true);
    setStoryboardError(null);
    try {
      const res = await api()?.mediaStoryboardGet?.(projectId);
      if (res?.ok && res.result) {
        setActiveStoryboard(res.result);
        setSelectedStoryboardId(projectId);
        setSelectedStoryboardSceneId(res.result.scenes?.[0]?.sceneId || null);
        setAnimaticPlaying(false);
        setAnimaticOpen(false);
        setRenderedMoviePath(res.result.renderedMoviePath || null);
      } else {
        setStoryboardError(res?.error || `Could not load storyboard: ${projectId}`);
      }
    } catch (e: any) {
      setStoryboardError(e?.message || `Could not load storyboard: ${projectId}`);
    } finally {
      setStoryboardLoading(false);
    }
  };

  const handleCreateStoryboard = async () => {
    if (!newStoryboardTitle.trim()) {
      setStoryboardError('Please enter a title for the new storyboard.');
      return;
    }
    const slug = newStoryboardTitle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-') + '-' + Date.now().toString(36).slice(-4);
    setStoryboardLoading(true);
    setStoryboardError(null);
    try {
      const initialShots = [
        {
          shotId: 'shot_001',
          title: 'Opening Establishing Shot',
          prompt: `${newStoryboardTitle}: cinematic wide establishing shot, atmospheric lighting, detailed background`,
          framing: 'wide',
          lens: '24mm',
          movement: 'slow push in',
          durationSec: 5,
          narration: `Establishing the scene for ${newStoryboardTitle}.`,
        },
        {
          shotId: 'shot_002',
          title: 'Main Subject / Action',
          prompt: `${newStoryboardTitle}: medium shot of subject performing key action, expressive lighting`,
          framing: 'medium',
          lens: '35mm',
          movement: 'static',
          durationSec: 5,
          narration: 'The action unfolds as the primary conflict or subject takes center stage.',
        },
        {
          shotId: 'shot_003',
          title: 'Climactic Detail / Close-up',
          prompt: `${newStoryboardTitle}: dramatic close up detail shot, shallow depth of field, high contrast cinematic`,
          framing: 'close',
          lens: '50mm',
          movement: 'tilt up',
          durationSec: 4,
          narration: 'A critical revelation or reaction caps the sequence.',
        },
      ];
      const res = await api()?.mediaStoryboardCreate?.({
        projectId: slug,
        title: newStoryboardTitle.trim(),
        notes: newStoryboardNotes.trim(),
        shots: initialShots,
        freeOnly: true,
      });
      if (res?.ok) {
        setNewStoryboardTitle('');
        setNewStoryboardNotes('');
        setIsCreatingStoryboard(false);
        setStoryboardMessage(`Created storyboard "${res.result?.title || slug}"!`);
        await loadStoryboardProjects();
        await loadStoryboard(slug);
      } else {
        setStoryboardError(res?.error || 'Failed to create storyboard.');
      }
    } catch (e: any) {
      setStoryboardError(e?.message || 'Failed to create storyboard.');
    } finally {
      setStoryboardLoading(false);
    }
  };

  const handleAutoDirectStoryboard = async () => {
    if (!directorPrompt.trim()) {
      setStoryboardError('Please enter a story prompt, scene description, or script to direct.');
      return;
    }
    setDirectorBusy(true);
    setStoryboardError(null);
    try {
      const res = await api()?.mediaStoryboardBreakdown?.({
        script: directorPrompt.trim(),
        genre: directorGenre !== 'auto' ? directorGenre : undefined,
        shotCount: directorShotCount,
        title: directorTitle.trim() || undefined,
        autoGenerateFrames: directorAutoFrames,
      });
      if (res?.ok && res.projectId) {
        setDirectorOpen(false);
        setDirectorPrompt('');
        setDirectorTitle('');
        setStoryboardMessage(`🎉 Directed "${res.title}" with ${res.shots?.length || directorShotCount} shots (${res.genre || 'Cinematic'})!`);
        await loadStoryboardProjects();
        await loadStoryboard(res.projectId);
      } else {
        setStoryboardError(res?.error || 'Failed to auto-direct storyboard.');
      }
    } catch (err: any) {
      setStoryboardError(err?.message || 'Failed to auto-direct storyboard.');
    } finally {
      setDirectorBusy(false);
    }
  };

  const handleUpdateShot = (shotId: string, updates: Record<string, any>) => {
    if (!activeStoryboard) return;
    setActiveStoryboard(prev => {
      if (!prev) return null;
      const scenes = prev.scenes.map(sc => sc.sceneId !== activeStoryboardScene?.sceneId ? sc : ({
        ...sc,
        shots: sc.shots.map(s => s.shotId === shotId ? { ...s, ...updates } : s),
      }));
      return { ...prev, scenes };
    });
  };

  const handleSaveStoryboard = async (showMessage = true): Promise<boolean> => {
    if (!activeStoryboard || !selectedStoryboardId) return false;
    setStoryboardSaving(true);
    setStoryboardError(null);
    try {
      for (const scene of activeStoryboard.scenes) {
        const res = await api()?.mediaStoryboardSave?.({
          projectId: selectedStoryboardId,
          sceneId: scene.sceneId,
          shots: scene.shots,
        });
        if (!res?.ok) throw new Error(res?.error || `Failed to save ${scene.sceneId}.`);
      }
      if (showMessage) {
        setStoryboardMessage('Storyboard saved successfully.');
        setTimeout(() => setStoryboardMessage(null), 3000);
      }
      return true;
    } catch (e: any) {
      setStoryboardError(e?.message || 'Failed to save storyboard.');
      return false;
    } finally {
      setStoryboardSaving(false);
    }
  };

  const handleGenerateFrame = async (shotId: string, prompt?: string) => {
    if (!selectedStoryboardId) return;
    setGeneratingShotId(shotId);
    setStoryboardError(null);
    try {
      const res = await api()?.mediaStoryboardGenerateFrame?.({
        projectId: selectedStoryboardId,
        sceneId: activeStoryboardScene?.sceneId || 'scene_01',
        shotId,
        prompt,
      });
      if (res?.ok && res.result?.frameImagePath) {
        handleUpdateShot(shotId, {
          frameImagePath: res.result.frameImagePath,
          status: 'COMPLETED',
        });
        setStoryboardMessage(`Generated keyframe for ${shotId} (${res.result.provider || 'Free'}).`);
        setTimeout(() => setStoryboardMessage(null), 3500);
      } else {
        setStoryboardError(res?.error || `Could not generate frame for ${shotId}`);
      }
    } catch (e: any) {
      setStoryboardError(e?.message || `Could not generate frame for ${shotId}`);
    } finally {
      setGeneratingShotId(null);
    }
  };

  const handleGenerateAllMissingFrames = async () => {
    if (!activeStoryboard || !selectedStoryboardId) return;
    const shots = activeStoryboardScene?.shots || [];
    const missing = shots.filter(s => !s.frameImagePath);
    if (missing.length === 0) {
      setStoryboardMessage('All shots already have generated frames!');
      setTimeout(() => setStoryboardMessage(null), 3000);
      return;
    }
    for (const shot of missing) {
      await handleGenerateFrame(shot.shotId, shot.prompt);
    }
  };

  const handleAddShot = () => {
    if (!activeStoryboard) return;
    setActiveStoryboard(prev => {
      if (!prev) return null;
      const scene = prev.scenes.find(sc => sc.sceneId === activeStoryboardScene?.sceneId);
      if (!scene) return prev;
      const count = scene.shots.length + 1;
      let nextId = count;
      while (scene.shots.some(shot => shot.shotId === `shot_${String(nextId).padStart(3, '0')}`)) nextId++;
      const shotId = `shot_${String(nextId).padStart(3, '0')}`;
      const newShot = {
        shotId,
        order: count,
        prompt: `Shot ${count}: cinematic angle, dynamic action, natural lighting`,
        framing: 'medium',
        lens: '35mm',
        movement: 'static',
        durationSec: 5,
        narration: '',
        status: 'PLANNED',
        frameImagePath: null,
      };
      const scenes = prev.scenes.map(sc => sc.sceneId === scene.sceneId ? { ...sc, shots: [...sc.shots, newShot] } : sc);
      return { ...prev, scenes };
    });
  };

  const handleDeleteShot = (shotId: string) => {
    if (!activeStoryboard) return;
    setActiveStoryboard(prev => {
      if (!prev) return null;
      const scene = prev.scenes.find(sc => sc.sceneId === activeStoryboardScene?.sceneId);
      if (!scene) return prev;
      const filtered = scene.shots.filter(s => s.shotId !== shotId).map((s, idx) => ({ ...s, order: idx + 1 }));
      return { ...prev, scenes: prev.scenes.map(sc => sc.sceneId === scene.sceneId ? { ...sc, shots: filtered } : sc) };
    });
  };

  const handleMoveShot = (index: number, direction: 'up' | 'down') => {
    if (!activeStoryboard) return;
    setActiveStoryboard(prev => {
      if (!prev) return null;
      const scene = prev.scenes.find(sc => sc.sceneId === activeStoryboardScene?.sceneId);
      if (!scene) return prev;
      const shots = [...scene.shots];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= shots.length) return prev;
      const temp = shots[index];
      shots[index] = shots[targetIndex];
      shots[targetIndex] = temp;
      const reordered = shots.map((s, idx) => ({ ...s, order: idx + 1 }));
      return { ...prev, scenes: prev.scenes.map(sc => sc.sceneId === scene.sceneId ? { ...sc, shots: reordered } : sc) };
    });
  };

  // Animatic Playback Timer
  useEffect(() => {
    if (!animaticOpen || !animaticPlaying || !activeStoryboardScene) return;
    const scene = activeStoryboardScene;
    const shots = scene?.shots || [];
    if (shots.length === 0) return;

    const interval = setInterval(() => {
      setAnimaticElapsedSec(prev => {
        const curShot = shots[animaticIndex];
        const maxDur = curShot?.durationSec || 5;
        const nextSec = prev + 0.1;
        if (nextSec >= maxDur) {
          if (animaticIndex < shots.length - 1) {
            setAnimaticIndex(idx => idx + 1);
            return 0;
          } else {
            if (animaticLoop) {
              setAnimaticIndex(0);
              return 0;
            } else {
              setAnimaticPlaying(false);
              return maxDur;
            }
          }
        }
        return nextSec;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [animaticOpen, animaticPlaying, animaticIndex, animaticLoop, activeStoryboardScene]);

  const handleEnhancePrompt = (shotId: string) => {
    if (!activeStoryboard) return;
    const scene = activeStoryboardScene;
    const shot = scene?.shots.find(s => s.shotId === shotId);
    if (!shot) return;

    let basePrompt = shot.prompt.trim();
    if (!basePrompt) {
      basePrompt = 'Scene subject in action';
    }

    const framingModifiers: Record<string, string> = {
      wide: 'cinematic wide establishing angle, deep atmospheric perspective, environmental storytelling',
      extreme_wide: 'epic panoramic vista, grand scale landscape, expansive dramatic horizon, 14mm anamorphic',
      medium: '35mm anamorphic film still, balanced rule-of-thirds composition, natural fill and rim lighting',
      close: 'striking character portrait close-up, 85mm f/1.4 lens, shallow depth of field, subtle facial catchlights',
      extreme_close: 'hyper-detailed macro shot, dramatic chiaroscuro contrast, tactile texture detail',
    };

    const lensModifiers: Record<string, string> = {
      '24mm': '24mm wide angle perspective, expansive field of view, crisp edge-to-edge clarity',
      '35mm': 'classic 35mm cinema lens, realistic human perspective, natural depth',
      '50mm': '50mm prime lens, clean natural geometry, subtle background falloff',
      '85mm': '85mm portrait telephoto, creamy soft bokeh, subject separation, flattering compression',
    };

    const movementModifiers: Record<string, string> = {
      'slow push in': 'dramatic forward push-in camera motion, building intensity',
      'pan right': 'horizontal panoramic camera sweep',
      'tilt up': 'low-angle upward camera tilt, sense of wonder and height',
      'tracking': 'dynamic tracking camera motion, kinetic energy, smooth gimbal flow',
      'static': 'stable locked-off tripod frame, formal balanced composition',
    };

    const framingCue = framingModifiers[shot.framing] || framingModifiers.medium;
    const lensCue = lensModifiers[shot.lens] || '';
    const moveCue = movementModifiers[shot.movement] || '';

    const additions: string[] = [];
    if (!basePrompt.toLowerCase().includes('lighting') && !basePrompt.toLowerCase().includes('cinematic')) {
      additions.push('cinematic lighting, Kodak Vision3 color grading, 8k resolution');
    }
    if (!basePrompt.toLowerCase().includes(shot.framing.replace('_', ' '))) {
      additions.push(framingCue);
    }
    if (lensCue && !basePrompt.toLowerCase().includes(shot.lens)) {
      additions.push(lensCue);
    }
    if (moveCue && !basePrompt.toLowerCase().includes(shot.movement)) {
      additions.push(moveCue);
    }

    const enhanced = additions.length > 0
      ? `${basePrompt}, ${additions.join(', ')}`
      : `${basePrompt}, cinematic lighting, photorealistic atmosphere, masterpiece`;

    handleUpdateShot(shotId, { prompt: enhanced });
    setStoryboardMessage(`Enhanced prompt for ${shotId}!`);
    setTimeout(() => setStoryboardMessage(null), 2500);
  };

  const handleExportStoryboardHtml = () => {
    if (!activeStoryboard) return;
    const shots = activeStoryboard.scenes.flatMap(scene => scene.shots);
    const totalDuration = shots.reduce((acc, s) => acc + (Number(s.durationSec) || 5), 0);
    const title = activeStoryboard.project?.name || selectedStoryboardId || 'Storyboard';
    const notes = activeStoryboard.project?.notes || '';

    const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)} — Visual Storyboard Sheet</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 24px; line-height: 1.5; }
  .header { border-bottom: 2px solid #00f0ff; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px; }
  h1 { margin: 0 0 4px 0; font-size: 1.8rem; color: #fff; }
  .meta { color: #94a3b8; font-size: 0.9rem; }
  .badges { display: flex; gap: 8px; margin-top: 8px; }
  .badge { background: #1e293b; border: 1px solid #334155; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; color: #38bdf8; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
  .card { background: #111827; border: 1px solid #1f2937; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
  .card-header { background: #1e293b; padding: 8px 12px; display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem; }
  .thumb { aspect-ratio: 16/9; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; border-bottom: 1px solid #1f2937; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .card-body { padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem; flex: 1; }
  .pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; color: #cbd5e1; }
  .pill-accent { border-color: #00f0ff; color: #00f0ff; }
  .label { font-size: 0.7rem; text-transform: uppercase; color: #64748b; font-weight: bold; margin-bottom: 2px; }
  .prompt-box { background: #0b0f19; padding: 8px; border-radius: 4px; border: 1px solid #1e293b; font-family: monospace; font-size: 0.8rem; color: #e2e8f0; }
  .narration-box { font-style: italic; color: #fbbf24; }
  @media print { body { background: #fff; color: #000; } .card { border: 1px solid #ccc; } .prompt-box { background: #f8fafc; color: #000; border-color: #e2e8f0; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>🎬 ${escapeHtml(title)}</h1>
    <div class="meta">${notes ? escapeHtml(notes) + ' • ' : ''}Generated by HomeBot Movie Studio</div>
  </div>
  <div class="badges">
    <span class="badge">${shots.length} SHOTS</span>
    <span class="badge">⏱ ${totalDuration}s TOTAL</span>
    <span class="badge">✓ $0.00 ZERO-COST</span>
  </div>
</div>
<div class="grid">
${shots.map((s, idx) => `
  <div class="card">
    <div class="card-header">
      <span>#${idx + 1} — ${escapeHtml(s.shotId)}</span>
      <span>⏱ ${s.durationSec || 5}s</span>
    </div>
    <div class="thumb">
      ${s.frameImagePath ? `<img src="${escapeHtml(toMediaFileUrl(s.frameImagePath))}" alt="${escapeHtml(s.shotId)}" />` : `<span style="color:#64748b;font-size:0.8rem;">[Frame Not Generated]</span>`}
    </div>
    <div class="card-body">
      <div class="pills">
        <span class="pill pill-accent">${escapeHtml(s.framing)}</span>
        <span class="pill">${escapeHtml(s.lens)}</span>
        <span class="pill">${escapeHtml(s.movement)}</span>
      </div>
      <div>
        <div class="label">Action Prompt:</div>
        <div class="prompt-box">${escapeHtml(s.prompt)}</div>
      </div>
      ${s.narration ? `
      <div>
        <div class="label">Narration:</div>
        <div class="narration-box">"${escapeHtml(s.narration)}"</div>
      </div>` : ''}
    </div>
  </div>
`).join('')}
</div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(selectedStoryboardId || 'storyboard').replace(/[^a-z0-9_-]/gi, '_')}-sheet.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStoryboardMessage('Exported HTML production shot sheet!');
    setTimeout(() => setStoryboardMessage(null), 3000);
  };

  const handleSendToTimeline = () => {
    if (!activeStoryboard) return;
    const scene = { shots: activeStoryboard.scenes.flatMap(sc => sc.shots) };
    if (scene && scene.shots.length > 0) {
      let accumulated = 0;
      const cuts: number[] = [];
      for (let i = 0; i < scene.shots.length - 1; i++) {
        accumulated += scene.shots[i].durationSec || 5;
        cuts.push(accumulated);
      }
      setClipCuts(cuts);
    }
    setActiveWorkspace('timeline');
    setDone(`Loaded storyboard sequence into CapCut timeline with ${scene?.shots?.length ? scene.shots.length - 1 : 0} edit cuts!`);
    setTimeout(() => setDone(null), 4000);
  };

  const handleRenderMovie = async () => {
    if (!selectedStoryboardId || !activeStoryboard || storyboardBusy) return;
    const previousExport = renderedMoviePath;
    setStoryboardRendering(true);
    setStoryboardError(null);
    setStoryboardMessage('Saving all scenes before rendering the complete movie...');
    try {
      if (!await handleSaveStoryboard(false)) {
        setStoryboardMessage(null);
        return;
      }
      setStoryboardMessage(`Rendering all ${activeStoryboard.scenes.length} scene(s) with narration and subtitles...`);
      const res = await releaseMediaThen('storyboard-export', () => {
        setRenderedMoviePath(null);
        return api()?.mediaStoryboardRender?.({
          projectId: selectedStoryboardId,
          motion: true,
          burnSubtitles: true,
        });
      });
      if (res?.ok && res.moviePath) {
        setRenderedMoviePath(res.moviePath);
        if (res.jobId) {
          setRenderedMovieJobId(res.jobId);
        }
        await refresh();
        setStoryboardMessage(`🎬 Successfully rendered 1080p movie (${res.durationSec}s, ${res.totalShots} shots)! Bridged to Director queue.`);
      } else {
        setRenderedMoviePath(previousExport);
        setStoryboardMessage(null);
        setStoryboardError(res?.error || 'Failed to render movie.');
      }
    } catch (e: any) {
      setRenderedMoviePath(previousExport);
      setStoryboardMessage(null);
      setStoryboardError(e?.message || 'Failed to render movie.');
    } finally {
      setStoryboardRendering(false);
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

  // Play the rendered mix, or narration before a video exists. Never play both.
  const currentSelectedJob = jobs.find(j => j.id === selectedJobId) || jobs[0] || null;
  const timelineMediaPath = currentSelectedJob?.renderPath || currentSelectedJob?.narrationPath || '';
  const timelineMediaSource = timelineMediaPath ? toMediaFileUrl(timelineMediaPath) : '';
  const timelineCanPlay = Boolean(timelineMediaSource || currentSelectedJob?.scenePaths?.some(Boolean));
  const activeDuration = timelineMediaDuration || currentSelectedJob?.durationSeconds || (
    currentSelectedJob?.scenePaths?.length ? currentSelectedJob.scenePaths.length * 5 : 30
  );

  const timelineMedia = useTimelinePlayback({
    active: activeWorkspace === 'timeline',
    source: timelineMediaSource,
    playing: timelinePlaying,
    duration: activeDuration,
    loop: timelineLoop,
    inPoint,
    outPoint,
    rate: clipSpeed,
    volume: voiceGain / 100,
    muted: trackMuted.A1,
    onTime: setTimelineTime,
    onPlaying: setTimelinePlaying,
    onDuration: setTimelineMediaDuration,
    onError: setError,
  });

  const { seek: seekTimelineMedia } = timelineMedia;

  const seekTimeline = useCallback((next: number | ((current: number) => number)) => {
    seekTimelineMedia(typeof next === 'function' ? next(timelineTime) : next);
  }, [seekTimelineMedia, timelineTime]);

  useEffect(() => {
    setTimelinePlaying(false);
    setTimelineTime(0);
    setInPoint(null);
    setOutPoint(null);
  }, [currentSelectedJob?.id, timelineMediaSource]);

  const formatTimecode = (sec: number) => {
    const safeSec = Math.max(0, sec || 0);
    const m = Math.floor(safeSec / 60);
    const s = Math.floor(safeSec % 60);
    const f = Math.floor((safeSec % 1) * 30);
    return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  useEffect(() => {
    // Image-only storyboard previews are explicitly silent. With media, its
    // decoder supplies time through useTimelinePlayback instead of this timer.
    if (activeWorkspace !== 'timeline' || !timelinePlaying || timelineMediaSource || !timelineCanPlay) return;
    const interval = setInterval(() => {
      setTimelineTime(t => {
        const next = t + 0.1 * clipSpeed;
        const maxBound = outPoint !== null && outPoint > (inPoint ?? 0) ? outPoint : activeDuration;
        const minBound = inPoint !== null && inPoint < maxBound ? inPoint : 0;
        if (next >= maxBound) {
          if (timelineLoop) return minBound;
          setTimelinePlaying(false);
          return maxBound;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [activeWorkspace, timelinePlaying, timelineLoop, activeDuration, inPoint, outPoint, timelineMediaSource, timelineCanPlay, clipSpeed]);

  // Pro NLE Keyboard Shortcuts
  useEffect(() => {
    if (activeWorkspace !== 'timeline') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (timelineCanPlay) setTimelinePlaying(p => !p);
      } else if (e.key === 'i' || e.key === 'I') {
        setInPoint(timelineTime);
        setDone(`In-point marked at ${formatTimecode(timelineTime)}`);
      } else if (e.key === 'o' || e.key === 'O') {
        setOutPoint(timelineTime);
        setDone(`Out-point marked at ${formatTimecode(timelineTime)}`);
      } else if (e.key === 'x' || e.key === 'X') {
        setInPoint(null);
        setOutPoint(null);
        setDone('In/Out selection cleared');
      } else if (e.key === 's' || e.key === 'S') {
        if (trackLocked.V1) {
          setError('Track V1 is locked. Unlock to split.');
        } else {
          setClipCuts(cuts => {
            const t = Math.round(timelineTime * 10) / 10;
            if (!cuts.includes(t) && t > 0.1 && t < activeDuration - 0.1) {
              return [...cuts, t].sort((a, b) => a - b);
            }
            return cuts;
          });
          setDone(`Split cut marker added at ${formatTimecode(timelineTime)}`);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (trackLocked.V1) {
          setError('Track V1 is locked.');
        } else {
          setClipCuts(cuts => {
            if (cuts.length === 0) return cuts;
            let closestIdx = 0;
            let minDiff = Math.abs(cuts[0] - timelineTime);
            for (let i = 1; i < cuts.length; i++) {
              const diff = Math.abs(cuts[i] - timelineTime);
              if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
              }
            }
            const removed = cuts[closestIdx];
            const next = cuts.filter((_, i) => i !== closestIdx);
            setDone(`Ripple deleted split at ${formatTimecode(removed)}`);
            return next;
          });
        }
      } else if (e.key === 'ArrowLeft') {
        seekTimeline(t => Math.max(0, t - 1));
      } else if (e.key === 'ArrowRight') {
        seekTimeline(t => Math.min(activeDuration, t + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeWorkspace, timelineTime, activeDuration, trackLocked.V1, timelineCanPlay, seekTimeline]);

  const renderJob = (j: MediaJob, showApproval: boolean) => (
    <li
      key={j.id}
      className={`ms-job ${highlightedJobId === j.id ? 'ms-job--highlighted' : ''}`}
      data-job-id={j.id}
    >
      <div className="ms-job-main">
        <div className="ms-job-header-row">
          <span className="ms-job-title">{j.title}</span>
          <div className="ms-job-quick-dcc">
            <button
              type="button"
              className="ms-btn ms-btn--dcc-pill"
              title="Inspect in CapCut Multi-Track Timeline"
              onClick={() => {
                setSelectedJobId(j.id);
                setActiveWorkspace('timeline');
              }}
            >
              ✂️ Timeline
            </button>
            <button
              type="button"
              className="ms-btn ms-btn--dcc-pill"
              title="Inspect in Blender Stage Viewport"
              onClick={() => {
                setSelectedJobId(j.id);
                setActiveWorkspace('stage');
              }}
            >
              🎭 Stage
            </button>
          </div>
        </div>
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
                    src={toMediaFileUrl(p)}
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
              src={toMediaFileUrl(j.renderPath)}
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
            src={toMediaFileUrl(j.narrationPath)}
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
            {stageAction(j)!.action === 'narrate' && (
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
                // "Make the video" is what actually calls generateSceneImages,
                // which goes straight to Pollinations/Stable Horde whenever
                // nothing local is installed — nondeterministic, no offline
                // rendering, prompts leaving the machine, with no ask. Ask
                // once, here, rather than deciding it silently.
                if (a.action === 'render' && sdCppStatus && !sdCppStatus.ready) {
                  setSdCppPromptFor(j.id);
                  return;
                }
                runJobStage(j.id, a);
              }}
            >
              {stageAction(j)!.label}
            </button>
            {sdCppPromptFor === j.id && (
              <div className="ms-sdcpp-prompt" role="dialog" aria-label="Choose where images are made">
                <div className="ms-sdcpp-prompt-text">
                  <strong>Make this video's images on this PC instead?</strong>
                  <p>
                    Nothing is installed yet, so this would currently use free online
                    services (Pollinations, Stable Horde) — that means the render time
                    depends on their queue, prompts leave this machine, and results are
                    not reproducible. Local generation is private and offline, and works
                    the same way every time. It is a one-time ~2&nbsp;GB download.
                  </p>
                </div>
                {sdCppSetup && (
                  <div className={`ms-sdcpp-prompt-progress${sdCppSetup.phase === 'error' ? ' ms-sdcpp-prompt-progress--error' : ''}`} role="status" aria-live="polite">
                    {sdCppSetup.note}
                    {sdCppSetup.receivedMB != null && sdCppSetup.phase !== 'done' && sdCppSetup.phase !== 'error' && (
                      <> {sdCppSetup.receivedMB}{sdCppSetup.totalMB ? ` of ${sdCppSetup.totalMB}` : ''} MB</>
                    )}
                  </div>
                )}
                <div className="ms-sdcpp-prompt-actions">
                  <button
                    type="button"
                    className="ms-btn ms-btn--primary"
                    disabled={sdCppSetupRunning}
                    onClick={async () => {
                      setSdCppSetup({ phase: 'resolving', note: 'Starting…' });
                      try {
                        const res = await (window as any).electron?.sdCppAutoSetup?.();
                        if (res?.success) {
                          const s = await (window as any).electron?.sdCppStatus?.();
                          setSdCppStatus(s);
                          setSdCppPromptFor(null);
                          setSdCppSetup(null);
                          runJobStage(j.id, stageAction(j)!);
                        } else if (res?.error) {
                          setSdCppSetup({ phase: 'error', note: res.error });
                        }
                      } catch (e: any) {
                        setSdCppSetup({ phase: 'error', note: e?.message || 'Setup failed.' });
                      }
                    }}
                  >
                    {sdCppSetupRunning ? 'Setting up…' : 'Set it up for me'}
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    disabled={sdCppSetupRunning}
                    onClick={() => {
                      setSdCppPromptFor(null);
                      runJobStage(j.id, stageAction(j)!);
                    }}
                  >
                    Continue with online instead
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    disabled={sdCppSetupRunning}
                    onClick={() => setSdCppPromptFor(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : PUBLISHABLE.includes(j.state) ? (
          uploadingFor === j.id ? (
            <div className="ms-youtube-upload-card" role="dialog" aria-label={`Upload ${j.title} to YouTube`}>
              <div className="ms-upload-header">
                <strong>Upload to YouTube</strong>
                {youtubeStatus?.signedIn && youtubeStatus.channels[0] && (
                  <span className="ms-upload-channel">
                    Channel: {youtubeStatus.channels[0].title}
                  </span>
                )}
              </div>
              {!youtubeStatus?.signedIn ? (
                <div className="ms-upload-auth-prompt">
                  <p>
                    YouTube is not connected or sign-in is required.
                    Connect with Google in Connections to enable direct publishing.
                  </p>
                  <div className="ms-upload-actions">
                    <button
                      type="button"
                      className="ms-btn ms-btn--primary"
                      onClick={async () => {
                        try {
                          await api()?.youtubeConnectUpload?.();
                          await checkYouTubeStatus();
                        } catch { /* ignore */ }
                      }}
                    >
                      Sign in with Google
                    </button>
                    <button
                      type="button"
                      className="ms-btn"
                      onClick={() => setUploadingFor(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ms-upload-form">
                  <label className="ms-field-label">
                    Video Title:
                    <input
                      className="ms-input"
                      value={uploadTitle}
                      onChange={e => setUploadTitle(e.target.value)}
                      placeholder="Title on YouTube"
                    />
                  </label>
                  <label className="ms-field-label">
                    Description:
                    <textarea
                      className="ms-input ms-upload-desc"
                      rows={3}
                      value={uploadDesc}
                      onChange={e => setUploadDesc(e.target.value)}
                      placeholder="Video description, links, and credits"
                    />
                  </label>
                  <div className="ms-upload-row">
                    <label className="ms-field-label">
                      Tags:
                      <input
                        className="ms-input"
                        value={uploadTags}
                        onChange={e => setUploadTags(e.target.value)}
                        placeholder="tag1, tag2, tag3"
                      />
                    </label>
                    <label className="ms-field-label">
                      Privacy:
                      <select
                        className="ms-select"
                        value={uploadPrivacy}
                        onChange={e => setUploadPrivacy(e.target.value as any)}
                      >
                        <option value="private">Private (Only you)</option>
                        <option value="unlisted">Unlisted (Anyone with link)</option>
                        <option value="public">Public (Everyone)</option>
                      </select>
                    </label>
                  </div>
                  {j.scenePaths?.[0] && (
                    <label className="ms-checkbox-label">
                      <input
                        type="checkbox"
                        checked={uploadUseThumbnail}
                        onChange={e => setUploadUseThumbnail(e.target.checked)}
                      />
                      Upload Slide 1 as custom thumbnail
                    </label>
                  )}
                  {uploadError && <div className="ms-error" role="alert">{uploadError}</div>}
                  {uploadBusy ? (
                    <div className="ms-working" role="status">
                      <span className="ms-spinner" aria-hidden="true" />
                      Uploading video to YouTube…
                    </div>
                  ) : (
                    <div className="ms-upload-actions">
                      <button
                        type="button"
                        className="ms-btn ms-btn--primary"
                        onClick={() => submitYouTubeUpload(j)}
                        disabled={!uploadTitle.trim()}
                      >
                        Upload to YouTube
                      </button>
                      <button
                        type="button"
                        className="ms-btn"
                        onClick={() => setUploadingFor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : publishingFor === j.id ? (
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
              {j.renderPath && (
                <button
                  className="ms-btn ms-btn--primary"
                  title="Upload this rendered video directly to YouTube"
                  onClick={() => openUploadDialog(j)}
                >
                  ▶ Upload to YouTube…
                </button>
              )}
              <button
                className="ms-btn"
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
        {busy !== j.id && publishingFor !== j.id && uploadingFor !== j.id && (
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


  /* CapCut Multi-Track Sequencer Workspace View */
  const renderTimelineWorkspace = () => {
    const job = currentSelectedJob;
    const duration = activeDuration;
    const playheadPercent = duration > 0 ? (timelineTime / duration) * 100 : 0;

    const validCuts = clipCuts.filter(c => c > 0.1 && c < duration - 0.1);
    const cutBoundaries = [0, ...validCuts, duration];

    const handleTrim = async () => {
      setError(null);
      if (trackLocked.V1) {
        setError('Track V1 is locked. Unlock to split.');
        return;
      }
      const cutTime = Math.round(timelineTime * 10) / 10;
      if (cutTime > 0.1 && cutTime < duration - 0.1) {
        setClipCuts(cuts => cuts.includes(cutTime) ? cuts : [...cuts, cutTime].sort((a, b) => a - b));
      }

      if (!job?.renderPath) {
        setDone(`Split marker added at ${formatTimecode(timelineTime)}. Segment ready for grading.`);
        return;
      }
      setBusy('trim');
      setBusyLabel('Trimming video...');
      try {
        const res = await api()?.mediaTrimClip?.({
          videoPath: job.renderPath,
          startSec: 0,
          durationSec: Math.min(timelineTime || 5, duration || 30),
        });
        if (res?.ok) {
          setDone(`Trimmed video saved to: ${String((res.result as any)?.path || 'output.mp4').split(/[\\/]/).pop()}`);
        } else {
          setError(res?.error || 'Trim failed.');
        }
      } catch (e: any) {
        setError(e?.message || 'Trim failed.');
      } finally {
        setBusy(null);
        setBusyLabel('');
      }
    };

    const handleRippleDelete = async () => {
      setError(null);
      if (trackLocked.V1) {
        setError('Track V1 is locked.');
        return;
      }
      if (clipCuts.length > 0) {
        let closestIdx = 0;
        let minDiff = Math.abs(clipCuts[0] - timelineTime);
        for (let i = 1; i < clipCuts.length; i++) {
          const diff = Math.abs(clipCuts[i] - timelineTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        const removed = clipCuts[closestIdx];
        setClipCuts(cuts => cuts.filter((_, i) => i !== closestIdx));
        setDone(`Ripple removed clip cut at ${formatTimecode(removed)}`);
        return;
      }
      setDone('No cut point near the playhead to remove — add a split with Trim first.');
    };

    const handleExportSelection = async () => {
      setError(null);
      const startSec = inPoint !== null ? inPoint : 0;
      const endSec = outPoint !== null ? outPoint : duration;
      const rangeSec = Math.max(0.5, Math.abs(endSec - startSec));
      const minSec = Math.min(startSec, endSec);

      if (!job?.renderPath) {
        setDone(`Selection [${formatTimecode(minSec)} - ${formatTimecode(minSec + rangeSec)}] (${rangeSec.toFixed(1)}s) queued for export.`);
        return;
      }

      setBusy('export-selection');
      setBusyLabel(`Exporting selection [${formatTimecode(minSec)} - ${formatTimecode(minSec + rangeSec)}]...`);
      try {
        const res = await api()?.mediaTrimClip?.({
          videoPath: job.renderPath,
          startSec: minSec,
          durationSec: rangeSec,
        });
        if (res?.ok) {
          setDone(`Exported selection saved to: ${String((res.result as any)?.path || 'selection.mp4').split(/[\\/]/).pop()}`);
        } else {
          setError(res?.error || 'Selection export failed.');
        }
      } catch (e: any) {
        setError(e?.message || 'Selection export failed.');
      } finally {
        setBusy(null);
        setBusyLabel('');
      }
    };

    const renderTrackControls = (trackId: string, isAudio: boolean, canMute = true) => (
      <div className="ms-track-controls" aria-label={`Track ${trackId} controls`}>
        <button
          type="button"
          className={`ms-track-ctrl-btn ${trackHidden[trackId] ? 'hidden-layer' : ''}`}
          title={trackHidden[trackId] ? `Show track ${trackId}` : `Hide track ${trackId}`}
          aria-label={trackHidden[trackId] ? `Show track ${trackId}` : `Hide track ${trackId}`}
          onClick={() => setTrackHidden(prev => ({ ...prev, [trackId]: !prev[trackId] }))}
        >
          {trackHidden[trackId] ? '🚫' : '👁️'}
        </button>
        {isAudio && (
          <button
            type="button"
            className={`ms-track-ctrl-btn ${trackMuted[trackId] ? 'muted' : ''}`}
            disabled={!canMute}
            title={trackMuted[trackId] ? `Unmute track ${trackId}` : `Mute track ${trackId}`}
            aria-label={trackMuted[trackId] ? `Unmute track ${trackId}` : `Mute track ${trackId}`}
            onClick={() => setTrackMuted(prev => ({ ...prev, [trackId]: !prev[trackId] }))}
          >
            {trackMuted[trackId] ? '🔇' : '🔊'}
          </button>
        )}
        <button
          type="button"
          className={`ms-track-ctrl-btn ${trackLocked[trackId] ? 'locked' : ''}`}
          title={trackLocked[trackId] ? `Unlock track ${trackId}` : `Lock track ${trackId}`}
          aria-label={trackLocked[trackId] ? `Unlock track ${trackId}` : `Lock track ${trackId}`}
          onClick={() => setTrackLocked(prev => ({ ...prev, [trackId]: !prev[trackId] }))}
        >
          {trackLocked[trackId] ? '🔒' : '🔓'}
        </button>
      </div>
    );

    return (
      <div className="ms-timeline-workspace">
        {/* Timeline Header Ribbon */}
        <div className="ms-timeline-topbar">
          <button
            type="button"
            className="ms-btn ms-btn-back"
            onClick={() => setActiveWorkspace('director')}
            style={{ marginRight: 8 }}
          >
            ← Back to Director
          </button>
          <div className="ms-timeline-project-select">
            <label htmlFor="timeline-job-select" className="ms-timeline-label">Active Project:</label>
            <select
              id="timeline-job-select"
              className="ms-select ms-timeline-select"
              value={selectedJobId || (jobs[0]?.id ?? '')}
              onChange={e => {
                setSelectedJobId(e.target.value);
                setTimelineTime(0);
                setClipCuts([]);
                setInPoint(null);
                setOutPoint(null);
              }}
            >
              {jobs.map(j => (
                <option key={j.id} value={j.id}>{j.title} ({label(j.state)})</option>
              ))}
              {jobs.length === 0 && <option value="">No Active Projects</option>}
            </select>
          </div>

          <div className="ms-timeline-tools">
            <button
              type="button"
              className="ms-dcc-tool-btn"
              title="Split clip at playhead (S)"
              onClick={handleTrim}
            >
              ✂️ Split
            </button>
            <button
              type="button"
              className="ms-dcc-tool-btn"
              title="Ripple delete clip at playhead (Del)"
              onClick={handleRippleDelete}
            >
              🗑️ Ripple
            </button>
            <button
              type="button"
              className={`ms-dcc-tool-btn ${inPoint !== null ? 'active' : ''}`}
              title="Mark In-point (I)"
              onClick={() => {
                setInPoint(timelineTime);
                setDone(`In-point marked at ${formatTimecode(timelineTime)}`);
              }}
            >
              [I] In
            </button>
            <button
              type="button"
              className={`ms-dcc-tool-btn ${outPoint !== null ? 'active' : ''}`}
              title="Mark Out-point (O)"
              onClick={() => {
                setOutPoint(timelineTime);
                setDone(`Out-point marked at ${formatTimecode(timelineTime)}`);
              }}
            >
              [O] Out
            </button>
            {(inPoint !== null || outPoint !== null) && (
              <button
                type="button"
                className="ms-dcc-tool-btn"
                title="Clear In/Out Selection (X)"
                onClick={() => {
                  setInPoint(null);
                  setOutPoint(null);
                  setDone('In/Out selection cleared');
                }}
              >
                ✕ Range
              </button>
            )}
            <button
              type="button"
              className="ms-dcc-tool-btn"
              title="Export selected In-Out range"
              onClick={handleExportSelection}
            >
              ⚡ Export Range
            </button>
            <div className="ms-timeline-zoom-group">
              <span className="ms-zoom-icon">🔍</span>
              <button
                type="button"
                className="ms-zoom-btn"
                onClick={() => setTimelineZoom(z => Math.max(1, z - 0.5))}
              >-</button>
              <span className="ms-zoom-val">{timelineZoom.toFixed(1)}x</span>
              <button
                type="button"
                className="ms-zoom-btn"
                onClick={() => setTimelineZoom(z => Math.min(3, z + 0.5))}
              >+</button>
            </div>
            <div className="ms-timeline-vu-meter" title={`Master Audio Output (${bgmDuckingLevel}dB Ducking Active)`}>
              <div className="ms-vu-channel">
                <div className={`ms-vu-bar ${timelinePlaying && timelineMediaSource && !trackMuted.A1 ? 'playing' : ''}`} />
              </div>
              <div className="ms-vu-channel">
                <div className={`ms-vu-bar ${timelinePlaying && timelineMediaSource && !trackMuted.A1 ? 'playing' : ''}`} />
              </div>
              <span className="ms-vu-label">VU</span>
            </div>
          </div>
        </div>

        {/* Mini Preview Stage */}
        <div className="ms-timeline-stage-row">
          <div className="ms-timeline-monitor">
            <div className="ms-monitor-screen">
              {job?.renderPath ? (
                <video
                  key={timelineMediaSource}
                  {...timelineMedia.events}
                  className="ms-monitor-video"
                  aria-label="Timeline video preview"
                  src={timelineMediaSource}
                  preload="metadata"
                  controls={false}
                  style={{ filter: getLutCssFilter(colorGradeLut) }}
                />
              ) : job?.scenePaths?.length ? (
                <div className="ms-monitor-slides">
                  {(() => {
                    const sceneIndex = Math.min(
                      job.scenePaths.length - 1,
                      Math.floor((timelineTime / duration) * job.scenePaths.length)
                    );
                    const scenePath = job.scenePaths[sceneIndex];
                    return scenePath ? (
                      <img
                        className="ms-monitor-img"
                        src={toMediaFileUrl(scenePath)}
                        alt={`Active Scene ${sceneIndex + 1}`}
                        style={{ filter: getLutCssFilter(colorGradeLut) }}
                      />
                    ) : (
                      <div className="ms-monitor-placeholder">
                        <span>🏛️ Scene {sceneIndex + 1} (Reusing neighbour)</span>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="ms-monitor-empty">
                  <span className="ms-monitor-empty-icon">🎬</span>
                  <p>{job?.narrationPath ? 'Narration preview' : 'Create a storyboard, then generate its images and narration.'}</p>
                </div>
              )}
              {!job?.renderPath && job?.narrationPath && (
                <audio
                  key={timelineMediaSource}
                  {...timelineMedia.events}
                  src={timelineMediaSource}
                  aria-label="Timeline narration preview"
                  preload="metadata"
                />
              )}
              {!timelineMediaSource && (
                <p className="ms-timeline-audio-notice">No narration or rendered video yet. Generate narration to hear audio here.</p>
              )}
              <div className="ms-monitor-timecode-badge">
                {formatTimecode(timelineTime)} / {formatTimecode(duration)}
              </div>
            </div>
          </div>

          <div className="ms-timeline-inspector">
            <h4>Inspector · {job ? job.title : 'No Project Selected'}</h4>
            <div className="ms-nle-tabs" role="tablist" aria-label="Inspector Tabs">
              <button
                type="button"
                className={`ms-nle-tab ${inspectorTab === 'properties' ? 'active' : ''}`}
                onClick={() => setInspectorTab('properties')}
                role="tab"
                aria-selected={inspectorTab === 'properties'}
              >
                📋 Properties
              </button>
              <button
                type="button"
                className={`ms-nle-tab ${inspectorTab === 'transitions' ? 'active' : ''}`}
                onClick={() => setInspectorTab('transitions')}
                role="tab"
                aria-selected={inspectorTab === 'transitions'}
              >
                🎨 Transitions &amp; FX
              </button>
              <button
                type="button"
                className={`ms-nle-tab ${inspectorTab === 'audio' ? 'active' : ''}`}
                onClick={() => setInspectorTab('audio')}
                role="tab"
                aria-selected={inspectorTab === 'audio'}
              >
                🎙️ Audio &amp; Ducking
              </button>
              <button
                type="button"
                className={`ms-nle-tab ${inspectorTab === 'export' ? 'active' : ''}`}
                onClick={() => setInspectorTab('export')}
                role="tab"
                aria-selected={inspectorTab === 'export'}
              >
                ⚡ Export Master
              </button>
            </div>

            {inspectorTab === 'properties' && (
              <div className="ms-nle-tab-pane">
                <div className="ms-inspector-meta">
                  <span className="ms-inspector-tag">Format: {job?.format ?? 'short'}</span>
                  <span className="ms-inspector-tag">State: {job ? label(job.state) : 'none'}</span>
                  <span className="ms-inspector-tag">Engine: {job?.narratedWith || 'Edge / Kokoro'}</span>
                  <span className="ms-inspector-tag">Cost: $0.00 Free Tier</span>
                </div>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Shot Framing:</span>
                  <div className="ms-nle-btn-group">
                    {(['WIDE', 'MED', 'CU', 'EXTREME CU'] as const).map(f => (
                      <button
                        key={f}
                        type="button"
                        className={`ms-nle-pill-btn ${clipFraming === f ? 'active' : ''}`}
                        onClick={() => setClipFraming(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Clip Speed:</span>
                  <div className="ms-nle-btn-group">
                    {[0.5, 1.0, 1.5, 2.0].map(s => (
                      <button
                        key={s}
                        type="button"
                        className={`ms-nle-pill-btn ${clipSpeed === s ? 'active' : ''}`}
                        onClick={() => setClipSpeed(s)}
                      >
                        {s.toFixed(1)}x
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Active In/Out:</span>
                  <span className="ms-nle-field-val">
                    {inPoint !== null ? formatTimecode(inPoint).slice(3) : '--:--:--'} → {outPoint !== null ? formatTimecode(outPoint).slice(3) : '--:--:--'}
                  </span>
                </div>
                {job?.script && (
                  <div className="ms-inspector-script">
                    <span className="ms-inspector-script-header">Narrator Script:</span>
                    <p>{job.script}</p>
                  </div>
                )}
              </div>
            )}

            {inspectorTab === 'transitions' && (
              <div className="ms-nle-tab-pane">
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Transition:</span>
                  <div className="ms-nle-btn-group">
                    {[
                      { id: 'none', label: 'Cut (Hard)' },
                      { id: 'cross_dissolve', label: 'Cross Dissolve' },
                      { id: 'fade_black', label: 'Dip to Black' },
                      { id: 'whip_pan', label: 'Whip Pan' },
                      { id: 'glitch', label: 'Glitch FX' },
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className={`ms-nle-pill-btn ${selectedTransition === t.id ? 'active' : ''}`}
                        onClick={() => setSelectedTransition(t.id as any)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">
                    Color Grade LUT: <span style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 500 }}>(Live CSS Preview)</span>
                  </span>
                  <div className="ms-nle-btn-group">
                    {[
                      { id: 'rec709', label: 'Rec.709 Natural' },
                      { id: 'warm_nile', label: 'Warm Nile' },
                      { id: 'teal_orange', label: 'Teal & Orange' },
                      { id: 'nocturne', label: 'Nocturne' },
                    ].map(l => (
                      <button
                        key={l.id}
                        type="button"
                        className={`ms-nle-pill-btn ${colorGradeLut === l.id ? 'active' : ''}`}
                        onClick={() => setColorGradeLut(l.id as any)}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Viewport Canvas:</span>
                  <div className="ms-nle-btn-group">
                    {(['16:9', '9:16', '1:1'] as const).map(asp => (
                      <button
                        key={asp}
                        type="button"
                        className={`ms-nle-pill-btn ${stageAspectRatio === asp ? 'active' : ''}`}
                        onClick={() => setStageAspectRatio(asp)}
                      >
                        {asp}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {inspectorTab === 'audio' && (
              <div className="ms-nle-tab-pane">
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Master Volume:</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={voiceGain}
                    aria-label="Timeline preview volume"
                    onChange={e => setVoiceGain(Number(e.target.value))}
                    className="ms-nle-slider"
                  />
                  <span className="ms-nle-field-val">{voiceGain}%</span>
                </div>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '4px 0' }}>
                  {job?.renderPath
                    ? 'Playing the rendered mix. Adjust master volume above.'
                    : job?.narrationPath
                    ? 'Playing narration audio. Export to mix with BGM and sound effects.'
                    : 'No separate audio file. Generate narration to hear audio.'}
                </p>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">BGM Ducking:</span>
                  <input
                    type="range"
                    min="-30"
                    max="-6"
                    value={bgmDuckingLevel}
                    onChange={e => setBgmDuckingLevel(Number(e.target.value))}
                    className="ms-nle-slider"
                  />
                  <span className="ms-nle-field-val">{bgmDuckingLevel}dB</span>
                </div>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '4px 0' }}>
                  Auto-attenuates BGM bed volume by {Math.abs(bgmDuckingLevel)}dB whenever narration or dialogue is detected.
                </p>
                <div className="ms-nle-field-row">
                  <span className="ms-nle-field-label">Foley Ambience:</span>
                  <span className="ms-nle-field-val" style={{ color: '#00e5ff' }}>Desert Wind + Papyrus + Steps</span>
                </div>
              </div>
            )}

            {inspectorTab === 'export' && (
              <div className="ms-nle-tab-pane">
                <div className="ms-inspector-meta">
                  <span className="ms-inspector-tag">Codec: H.264 / AAC</span>
                  <span className="ms-inspector-tag">Res: 1080p FHD (1920x1080)</span>
                  <span className="ms-inspector-tag">FPS: 30.00 SMPTE</span>
                </div>
                <button
                  type="button"
                  className="ms-btn ms-btn--primary"
                  style={{ width: '100%', marginBottom: 6 }}
                  onClick={handleExportSelection}
                >
                  ⚡ Export Selection ({inPoint !== null && outPoint !== null ? `${Math.abs(outPoint - inPoint).toFixed(1)}s` : 'Full Range'})
                </button>
                {job && (
                  <div className="ms-inspector-actions">
                    {stageAction(job) && (
                      <button
                        className="ms-btn ms-btn--primary"
                        style={{ width: '100%', marginBottom: 6 }}
                        onClick={() => {
                          const a = stageAction(job)!;
                          run(job.id, () => api()?.mediaRun?.(job.id, a.action), a.label);
                        }}
                      >
                        ⚡ {stageAction(job)!.label}
                      </button>
                    )}
                    {job.state === 'awaiting_approval' && (
                      <button
                        className="ms-btn ms-btn--primary"
                        style={{ width: '100%', marginBottom: 6 }}
                        onClick={() => run(job.id, () => api()?.mediaAdvance?.(job.id, 'approved'), 'Approving')}
                      >
                        ✓ Approve Master Video
                      </button>
                    )}
                    {PUBLISHABLE.includes(job.state) && job.renderPath && (
                      <button
                        className="ms-btn ms-btn--primary"
                        style={{ width: '100%', marginBottom: 6 }}
                        onClick={() => {
                          setActiveWorkspace('director');
                          openUploadDialog(job);
                        }}
                      >
                        ▶ Upload to YouTube…
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Transport Controls Bar */}
        <div className="ms-timeline-transport">
          <div className="ms-transport-cluster">
            <button
              type="button"
              className="ms-transport-btn"
              title="Step frame back 1s (|◀)"
              onClick={() => seekTimeline(t => Math.max(0, t - 1))}
            >|◀</button>
            <button
              type="button"
              className="ms-transport-btn"
              title="Jump to Start (⏮)"
              onClick={() => seekTimeline(inPoint !== null ? inPoint : 0)}
            >⏮</button>
            <button
              type="button"
              className={`ms-transport-btn ms-transport-play ${timelinePlaying ? 'active' : ''}`}
              title={timelinePlaying ? 'Pause (Space)' : 'Play (Space)'}
              disabled={!timelineCanPlay}
              onClick={() => setTimelinePlaying(!timelinePlaying)}
            >
              {timelinePlaying ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="ms-transport-btn"
              title="Step frame forward 1s (▶|)"
              onClick={() => seekTimeline(t => Math.min(duration, t + 1))}
            >▶|</button>
            <button
              type="button"
              className={`ms-transport-btn ${timelineLoop ? 'active' : ''}`}
              title="Loop Playback (🔁)"
              onClick={() => setTimelineLoop(!timelineLoop)}
            >🔁</button>
          </div>

          <div className="ms-transport-timecode">
            <span className="ms-timecode-curr">{formatTimecode(timelineTime)}</span>
            <span className="ms-timecode-div">/</span>
            <span className="ms-timecode-tot">{formatTimecode(duration)}</span>
          </div>

          <div className="ms-transport-volume">
            <span>🔊</span>
            <input
              type="range"
              min="0"
              max="100"
              value={voiceGain}
              aria-label="Timeline master volume"
              onChange={e => setVoiceGain(Number(e.target.value))}
            />
            <span className="ms-transport-vol-pct">{voiceGain}%</span>
          </div>
        </div>

        {/* Sequencer Track Area with Calibrated Ruler */}
        <div className="ms-sequencer-container" style={{ transform: `scaleX(${timelineZoom})`, transformOrigin: 'left top' }}>
          {/* Calibrated SMPTE Time Ruler */}
          <div
            className="ms-timeline-ruler"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              seekTimeline(fraction * duration);
            }}
          >
            <div className="ms-ruler-ticks">
              {Array.from({ length: 11 }).map((_, i) => {
                const markSec = (i / 10) * duration;
                return (
                  <div key={i} className="ms-ruler-tick" style={{ left: `${i * 10}%` }}>
                    <span className="ms-tick-label">{formatTimecode(markSec).slice(3)}</span>
                    <span className="ms-tick-line" />
                  </div>
                );
              })}
            </div>
            {/* In / Out Selection Range Overlay */}
            {inPoint !== null && outPoint !== null && (
              <div
                className="ms-in-out-shading"
                style={{
                  left: `${(Math.min(inPoint, outPoint) / duration) * 100}%`,
                  width: `${(Math.abs(outPoint - inPoint) / duration) * 100}%`,
                }}
              >
                <span className="ms-in-marker-flag">IN {formatTimecode(Math.min(inPoint, outPoint)).slice(3)}</span>
                <span className="ms-out-marker-flag">OUT {formatTimecode(Math.max(inPoint, outPoint)).slice(3)}</span>
              </div>
            )}
            {/* Playhead Needle */}
            <div className="ms-playhead" style={{ left: `${playheadPercent}%` }}>
              <div className="ms-playhead-head" />
              <div className="ms-playhead-line" />
            </div>
          </div>

          {/* Multi-Track Stack */}
          <div className="ms-tracks-stack">
            {/* Track 1: 🎥 Video / Scene Shots Track */}
            <div className={`ms-track-lane ms-track--video ${trackHidden.V1 ? 'is-hidden' : ''} ${trackLocked.V1 ? 'is-locked' : ''}`}>
              <div className="ms-track-header">
                <span className="ms-track-id">V1</span>
                <span className="ms-track-icon">🎥</span>
                <span className="ms-track-title">Shots</span>
                {renderTrackControls('V1', false)}
              </div>
              <div className="ms-track-content">
                {validCuts.length > 0 ? (
                  <>
                    {cutBoundaries.slice(0, -1).map((start, i) => {
                      const end = cutBoundaries[i + 1];
                      const segDuration = end - start;
                      const widthPct = (segDuration / duration) * 100;
                      const isFocus = timelineTime >= start && timelineTime < end;
                      return (
                        <div
                          key={`cut-seg-${i}`}
                          className={`ms-track-clip ms-clip--shot ${isFocus ? 'active' : ''} ${selectedClipIndex === i ? 'selected' : ''}`}
                          style={{ width: `${widthPct}%` }}
                          onClick={() => {
                            setSelectedClipIndex(i);
                            seekTimeline(start);
                          }}
                          title={`Segment ${i + 1}: ${formatTimecode(start)} to ${formatTimecode(end)} (${segDuration.toFixed(1)}s)`}
                        >
                          <span className="ms-clip-label">Clip {i + 1} ({segDuration.toFixed(1)}s)</span>
                          <span className="ms-clip-framing">[{clipFraming}]</span>
                        </div>
                      );
                    })}
                    {validCuts.map((c, i) => (
                      <div
                        key={`cut-marker-${i}`}
                        className="ms-clip-cut-marker"
                        style={{ left: `${(c / duration) * 100}%` }}
                        title={`Cut at ${formatTimecode(c)}`}
                      />
                    ))}
                  </>
                ) : job?.scenePaths?.length ? (
                  job.scenePaths.map((p, i) => {
                    const shotWidth = (100 / job.scenePaths!.length);
                    const isFocus = Math.floor((timelineTime / duration) * job.scenePaths!.length) === i;
                    return (
                      <div
                        key={i}
                        className={`ms-track-clip ms-clip--shot ${isFocus ? 'active' : ''}`}
                        style={{ width: `${shotWidth}%` }}
                        onClick={() => seekTimeline((i / job.scenePaths!.length) * duration)}
                        title={`Shot ${i + 1}: ${p ? 'Frame rendered' : 'Reusing neighbour'}`}
                      >
                        {p ? (
                          <img
                            className="ms-clip-thumb"
                            src={toMediaFileUrl(p)}
                            alt={`Shot ${i + 1}`}
                          />
                        ) : (
                          <div className="ms-clip-thumb-empty">Reused</div>
                        )}
                        <span className="ms-clip-label">Shot {i + 1}</span>
                        <span className="ms-clip-framing">{i === 0 ? '[WIDE]' : i === 1 ? '[MED]' : '[CU]'}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="ms-track-clip ms-clip--shot" style={{ width: '100%' }}>
                    <span className="ms-clip-label">{job?.renderPath ? 'Rendered video' : 'No generated shots yet'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Track 2: 🎙️ Dialogue Track */}
            <div className={`ms-track-lane ms-track--dialogue ${trackHidden.A1 ? 'is-hidden' : ''} ${trackLocked.A1 ? 'is-locked' : ''}`}>
              <div className="ms-track-header">
                <span className="ms-track-id">A1</span>
                <span className="ms-track-icon">🎙️</span>
                <span className="ms-track-title">{job?.renderPath ? 'Rendered mix' : 'Voice'}</span>
                {renderTrackControls('A1', true, Boolean(timelineMediaSource))}
              </div>
              <div className="ms-track-content">
                <div className={timelineMediaSource ? 'ms-track-clip ms-clip--audio' : 'ms-timeline-empty-track'} style={{ width: '100%' }}>
                  <span className="ms-clip-label">
                    {job?.renderPath ? 'Audio from rendered video' : job?.narrationPath ? `Generated narration (${job.narratedWith || 'voice'})` : 'No narration file yet'}
                  </span>
                </div>
              </div>
            </div>

            {/* Track 3: 🎵 BGM Music Ducking Track */}
            <div className={`ms-track-lane ms-track--music ${trackHidden.A2 ? 'is-hidden' : ''} ${trackLocked.A2 ? 'is-locked' : ''}`}>
              <div className="ms-track-header">
                <span className="ms-track-id">A2</span>
                <span className="ms-track-icon">🎵</span>
                <span className="ms-track-title">BGM</span>
                {renderTrackControls('A2', true, false)}
              </div>
              <div className="ms-track-content">
                <span className="ms-timeline-empty-track">No separate music file. Any rendered music plays with the video mix.</span>
              </div>
            </div>

            {/* Track 4: 🔊 Foley / SFX Track */}
            <div className={`ms-track-lane ms-track--sfx ${trackHidden.A3 ? 'is-hidden' : ''} ${trackLocked.A3 ? 'is-locked' : ''}`}>
              <div className="ms-track-header">
                <span className="ms-track-id">A3</span>
                <span className="ms-track-icon">🔊</span>
                <span className="ms-track-title">Foley</span>
                {renderTrackControls('A3', true, false)}
              </div>
              <div className="ms-track-content">
                <span className="ms-timeline-empty-track">No separate sound-effects file.</span>
              </div>
            </div>

            {/* Track 5: 💬 Kinetic Subtitles Track */}
            <div className={`ms-track-lane ms-track--subs ${trackHidden.T1 ? 'is-hidden' : ''} ${trackLocked.T1 ? 'is-locked' : ''}`}>
              <div className="ms-track-header">
                <span className="ms-track-id">T1</span>
                <span className="ms-track-icon">💬</span>
                <span className="ms-track-title">Subtitles</span>
                {renderTrackControls('T1', false)}
              </div>
              <div className="ms-track-content">
                <span className="ms-timeline-empty-track">Captions appear in the rendered video when included.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pro NLE Hotkey Bar Footer */}
        <div className="ms-nle-hotkey-bar">
          <div className="ms-hotkey-group">
            <span className="ms-hotkey-item"><kbd>Space</kbd> Play/Pause</span>
            <span className="ms-hotkey-item"><kbd>S</kbd> Split Razor</span>
            <span className="ms-hotkey-item"><kbd>I</kbd> Mark In</span>
            <span className="ms-hotkey-item"><kbd>O</kbd> Mark Out</span>
            <span className="ms-hotkey-item"><kbd>X</kbd> Clear In/Out</span>
            <span className="ms-hotkey-item"><kbd>Del</kbd> Ripple Delete</span>
            <span className="ms-hotkey-item"><kbd>←</kbd> <kbd>→</kbd> Step 1s</span>
          </div>
          <div className="ms-hotkey-group">
            <button
              type="button"
              className={`ms-nle-pill-btn ${snappingEnabled ? 'active' : ''}`}
              onClick={() => setSnappingEnabled(s => !s)}
            >
              {snappingEnabled ? '🧲 Snap: ON' : '🧲 Snap: OFF'}
            </button>
            <span style={{ color: 'var(--text-muted)' }}>SMPTE 30fps NLE</span>
          </div>
        </div>
      </div>
    );
  };

  /* Blender Viewport & Camera Stage Workspace View */
  const renderStageWorkspace = () => {
    const job = currentSelectedJob;
    const aspectClass = stageAspectRatio === '9:16'
      ? 'ms-viewport-screen--portrait'
      : stageAspectRatio === '1:1'
        ? 'ms-viewport-screen--square'
        : 'ms-viewport-screen--landscape';

    const framing: StageFraming = stageCameraPreset === '35mm' ? 'wide' : stageCameraPreset === '50mm' ? 'medium' : 'close';
    const cameraMotion: CameraMotion = stageMotionPreset === 'static' ? 'static' : stageMotionPreset === 'pan' ? 'pan_left' : stageMotionPreset === 'zoom' ? 'zoom_in' : 'pan_right';
    const lighting: SettingLighting = stageLightingPreset === 'dawn' ? LIGHTING_PRESETS.daylight : stageLightingPreset === 'torch' ? LIGHTING_PRESETS.torchlight : stageLightingPreset === 'noon' ? LIGHTING_PRESETS.studio_warm : LIGHTING_PRESETS.scifi_cool;

    const bgSrc = activeSettingBundle?.bgPath
      ? toMediaFileUrl(activeSettingBundle.bgPath)
      : (job?.scenePaths?.length && job.scenePaths[0] ? toMediaFileUrl(job.scenePaths[0]) : DEFAULT_STAGE_BG);
    const fgSrc = activeSettingBundle?.fgPath
      ? toMediaFileUrl(activeSettingBundle.fgPath)
      : (!activeSettingBundle && (!job?.scenePaths?.length || !job.scenePaths[0]) ? DEFAULT_STAGE_FG : undefined);

    return (
      <div className="ms-stage-workspace">
        {/* Stage Header Controls */}
        <div className="ms-stage-toolbar">
          <button
            type="button"
            className="ms-btn ms-btn-back"
            onClick={() => setActiveWorkspace('director')}
            style={{ marginRight: 8 }}
          >
            ← Back to Director
          </button>
          <div className="ms-stage-aspect-selector" role="radiogroup" aria-label="Camera Aspect Ratio">
            <button
              type="button"
              className={`ms-dcc-aspect-btn ${stageAspectRatio === '16:9' ? 'active' : ''}`}
              onClick={() => setStageAspectRatio('16:9')}
            >
              16:9 Landscape (YouTube)
            </button>
            <button
              type="button"
              className={`ms-dcc-aspect-btn ${stageAspectRatio === '9:16' ? 'active' : ''}`}
              onClick={() => setStageAspectRatio('9:16')}
            >
              9:16 Shorts (TikTok / Reels)
            </button>
            <button
              type="button"
              className={`ms-dcc-aspect-btn ${stageAspectRatio === '1:1' ? 'active' : ''}`}
              onClick={() => setStageAspectRatio('1:1')}
            >
              1:1 Square (Social)
            </button>
          </div>

          <div className="ms-stage-overlay-toggles">
            <button
              type="button"
              className={`ms-dcc-toggle-btn ${stageOverlays ? 'active' : ''}`}
              onClick={() => setStageOverlays(!stageOverlays)}
              title="Toggle Viewport Overlay Guides"
            >
              📐 Overlays: {stageOverlays ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              className={`ms-dcc-toggle-btn ${stageSafeAreas ? 'active' : ''}`}
              onClick={() => setStageSafeAreas(!stageSafeAreas)}
              title="Toggle 90% Action and 80% Title Safe Areas"
            >
              🛡️ Safe Margins
            </button>
            <button
              type="button"
              className={`ms-dcc-toggle-btn ${stageGrid ? 'active' : ''}`}
              onClick={() => setStageGrid(!stageGrid)}
              title="Toggle Compositional Rule of Thirds Grid"
            >
              ▦ 3x3 Grid
            </button>
            <button
              type="button"
              className={`ms-dcc-toggle-btn ${stageReticle ? 'active' : ''}`}
              onClick={() => setStageReticle(!stageReticle)}
              title="Toggle Center Crosshairs Reticle"
            >
              ➕ Reticle
            </button>
          </div>

          <div className="ms-stage-setting-selector" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
            <select
              className="ms-select"
              aria-label="Active Setting Plate"
              value={selectedSettingId}
              onChange={e => handleSelectSetting(e.target.value)}
              style={{ maxWidth: '200px', fontSize: '0.8rem', padding: '4px 8px' }}
            >
              <option value="">Virtual Ancient Stage (Default)</option>
              {availableSettings.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.hasForeground ? '2-Plate BG+FG' : '1-Plate BG'})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ms-dcc-toggle-btn"
              disabled={isSegmenting}
              onClick={handleExtractForegroundRmbg}
              title="Run CPU RMBG neural model to extract foreground occlusion plate from current background"
            >
              {isSegmenting ? '⏳ Segmenting...' : '✂️ CPU RMBG'}
            </button>
          </div>
        </div>

        {/* Viewport Frame & Blender N-Panel Inspector Row */}
        <div className="ms-stage-viewport-grid">
          <div className="ms-viewport-container">
            <div className={`ms-viewport-screen ${aspectClass}`} style={{ position: 'relative', overflow: 'hidden' }}>
              {/* Active Image or Video Layer */}
              {job?.renderPath ? (
                <video
                  className="ms-viewport-content-video"
                  src={toMediaFileUrl(job.renderPath)}
                  controls
                />
              ) : (
                <MultiPlaneStage
                  bgSrc={bgSrc}
                  fgSrc={fgSrc}
                  framing={framing}
                  cameraMotion={cameraMotion}
                  lighting={lighting}
                  progress={stageScrubProgress}
                  aspectRatio={stageAspectRatio === '16:9' ? '16/9' : stageAspectRatio === '9:16' ? '9/16' : '1/1'}
                  characterSlot={
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '72px', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' }}>
                        🏛️
                      </span>
                      <span style={{ fontSize: '11px', color: '#f8fafc', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, marginTop: '4px' }}>
                        Leila (Sprite Rig)
                      </span>
                    </div>
                  }
                />
              )}

              {/* Viewport Overlays */}
              {stageOverlays && (
                <div className="ms-viewport-guides-layer">
                  {/* 90% Action Safe Frame */}
                  {stageSafeAreas && (
                    <div className="ms-guide-action-safe">
                      <span className="ms-guide-tag ms-tag--cyan">ACTION 90%</span>
                    </div>
                  )}
                  {/* 80% Title Safe Frame */}
                  {stageSafeAreas && (
                    <div className="ms-guide-title-safe">
                      <span className="ms-guide-tag ms-tag--amber">TITLE 80%</span>
                    </div>
                  )}
                  {/* Rule of Thirds 3x3 Grid */}
                  {stageGrid && (
                    <div className="ms-guide-rule-thirds">
                      <div className="ms-grid-line ms-line--v1" />
                      <div className="ms-grid-line ms-line--v2" />
                      <div className="ms-grid-line ms-line--h1" />
                      <div className="ms-grid-line ms-line--h2" />
                      {/* Intersection Power Points */}
                      <span className="ms-power-point ms-pp1" />
                      <span className="ms-power-point ms-pp2" />
                      <span className="ms-power-point ms-pp3" />
                      <span className="ms-power-point ms-pp4" />
                    </div>
                  )}
                  {/* Center Crosshairs Reticle */}
                  {stageReticle && (
                    <div className="ms-guide-reticle">
                      <div className="ms-reticle-cross-v" />
                      <div className="ms-reticle-cross-h" />
                      <div className="ms-reticle-circle" />
                    </div>
                  )}
                </div>
              )}

              {/* Viewport Telemetry HUD */}
              <div className="ms-viewport-hud">
                <div className="ms-hud-item ms-hud--rec">
                  <span className="ms-rec-dot" /> REC READY · 1080p FHD · 30.00 FPS
                </div>
                <div className="ms-hud-item ms-hud--cost">
                  💰 $0.00 SPEND · FREE-TIER ACTIVE
                </div>
              </div>
            </div>
          </div>

          {/* Blender N-Panel / Camera & Lighting Inspector */}
          <div className="ms-stage-inspector">
            <h3 className="ms-stage-inspector-title">🎥 Camera &amp; Staging Inspector</h3>

            <div className="ms-stage-param-group">
              <label className="ms-param-label">Focal Length &amp; Optics:</label>
              <div className="ms-param-btn-row">
                <button
                  type="button"
                  className={`ms-param-btn ${stageCameraPreset === '35mm' ? 'active' : ''}`}
                  onClick={() => setStageCameraPreset('35mm')}
                >
                  35mm Wide
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageCameraPreset === '50mm' ? 'active' : ''}`}
                  onClick={() => setStageCameraPreset('50mm')}
                >
                  50mm Prime
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageCameraPreset === '85mm' ? 'active' : ''}`}
                  onClick={() => setStageCameraPreset('85mm')}
                >
                  85mm Telephoto
                </button>
              </div>
            </div>

            <div className="ms-stage-param-group">
              <label className="ms-param-label">Camera Motion (Remotion Parallax):</label>
              <div className="ms-param-btn-row">
                <button
                  type="button"
                  className={`ms-param-btn ${stageMotionPreset === 'static' ? 'active' : ''}`}
                  onClick={() => setStageMotionPreset('static')}
                >
                  Static
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageMotionPreset === 'pan' ? 'active' : ''}`}
                  onClick={() => setStageMotionPreset('pan')}
                >
                  Slow Pan
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageMotionPreset === 'zoom' ? 'active' : ''}`}
                  onClick={() => setStageMotionPreset('zoom')}
                >
                  Ken Burns Zoom
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageMotionPreset === 'orbit' ? 'active' : ''}`}
                  onClick={() => setStageMotionPreset('orbit')}
                >
                  Drift
                </button>
              </div>
            </div>

            <div className="ms-stage-param-group">
              <label className="ms-param-label">
                Parallax Scrub ({Math.round(stageScrubProgress * 100)}%):
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(stageScrubProgress * 100)}
                aria-label="Stage parallax scrub progress"
                onChange={e => setStageScrubProgress(Number(e.target.value) / 100)}
                className="ms-nle-slider"
              />
            </div>

            <div className="ms-stage-param-group">
              <label className="ms-param-label">Lighting Mood &amp; Color Grade:</label>
              <div className="ms-param-btn-row">
                <button
                  type="button"
                  className={`ms-param-btn ${stageLightingPreset === 'dawn' ? 'active' : ''}`}
                  onClick={() => setStageLightingPreset('dawn')}
                >
                  Golden Dawn
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageLightingPreset === 'torch' ? 'active' : ''}`}
                  onClick={() => setStageLightingPreset('torch')}
                >
                  Torchlit Sanctum
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageLightingPreset === 'noon' ? 'active' : ''}`}
                  onClick={() => setStageLightingPreset('noon')}
                >
                  High Noon
                </button>
                <button
                  type="button"
                  className={`ms-param-btn ${stageLightingPreset === 'neon' ? 'active' : ''}`}
                  onClick={() => setStageLightingPreset('neon')}
                >
                  Neon Grade
                </button>
              </div>
            </div>

            <div className="ms-stage-param-group">
              <label className="ms-param-label">Optical Staging &amp; Depth Telemetry:</label>
              <div className="ms-rig-telemetry-box">
                <div className="ms-telemetry-row">
                  <span>Active Setting:</span>
                  <span className="ms-telemetry-val">{activeSettingBundle ? activeSettingBundle.manifest.name : 'Virtual Ancient Stage'}</span>
                </div>
                <div className="ms-telemetry-row">
                  <span>Depth Planes:</span>
                  <span className="ms-telemetry-val">{fgSrc ? '4 Tiers (BG, Shadow, Sprite, FG Occlusion)' : '3 Tiers (BG, Shadow, Sprite)'}</span>
                </div>
                <div className="ms-telemetry-row">
                  <span>Lighting Grade:</span>
                  <span className="ms-telemetry-val">{stageLightingPreset.toUpperCase()} ({lighting.preset})</span>
                </div>
                <div className="ms-telemetry-row">
                  <span>Parallax Differential:</span>
                  <span className="ms-telemetry-pass">BG: 1.00x · Char: 1.15x · FG: 1.35x (0 MB VRAM)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };
  /* Ancient Pathways Showcase Component (shared between drawer and workspace) */
  const renderAncientPathwaysShowcase = (showClose = true) => {
    return (
      <div className="ms-ap-showcase">
        <div className="ms-ap-hero">
          <div>
            <h3>🏛️ Ancient Pathways: Leila &amp; Flappy 2D Animated History</h3>
            <p>
              Produce broadcast-ready 2D animated history documentaries with voice acting,
              historical backgrounds, and sound design in 1 click.
            </p>
          </div>
          {showClose && (
            <button
              type="button"
              className="ms-btn"
              onClick={() => { setApOpen(false); setApError(null); }}
              aria-label="Close Ancient Pathways section"
            >✕ Close</button>
          )}
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

        {/* Generation Router -- shot-level routing through all 6 providers */}
        <div className="ms-ap-movie-router">
          <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Generation Router</h4>
          <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#888' }}>
            Route individual shots through the best-available free provider:
            Ancient Pathways 2D, Colab T4 IP-Adapter, ComfyUI, Pollinations, Imagen 3, or Local SD 1.5.
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
    );
  };

  /* Ancient Pathways Dedicated Workspace View */
  const renderAncientPathwaysWorkspace = () => {
    return (
      <div className="ms-workspace-view">
        <div className="ms-router-header">
          <div className="ms-router-title-group">
            <h3>🏛️ Ancient Pathways 2D Animation Showrunner</h3>
            <p className="ms-router-subtitle">
              Broadcast-grade 2D motion comic engine starring Leila &amp; Flappy. Generate scenes autonomously,
              audit character sheets and viseme sync with Preflight Doctor, and produce 4K episodes.
            </p>
          </div>
          <button
            type="button"
            className="ms-btn ms-btn-back"
            onClick={() => setActiveWorkspace('director')}
          >
            ← Back to Director
          </button>
        </div>
        {renderAncientPathwaysShowcase(false)}
      </div>
    );
  };

  /* 6-Tier Movie Generation Router Workspace View */
  const renderMovieRouterWorkspace = () => {
    return (
      <div className="ms-workspace-view">
        <div className="ms-router-header">
          <div className="ms-router-title-group">
            <h3>⚡ 6-Tier Autonomous Movie Generation Router</h3>
            <p className="ms-router-subtitle">
              Dynamic shot-level routing across cloud GPU clusters, local neural weights, node-based ComfyUI, and vector pipelines.
              Automatically selects the fastest, zero-cost pipeline for each scene.
            </p>
          </div>
          <button
            type="button"
            className="ms-btn ms-btn-back"
            onClick={() => setActiveWorkspace('director')}
          >
            ← Back to Director
          </button>
        </div>

        {/* 6-Engine Tier Grid */}
        <div className="ms-provider-grid">
          <div className="ms-provider-card">
            <span className="ms-provider-badge">Tier 1 · Primary</span>
            <div className="ms-provider-icon">🏛️</div>
            <div className="ms-provider-name">Ancient Pathways 2D</div>
            <div className="ms-provider-desc">
              Vector character sheets, viseme lip-sync, panel chroma extraction, and 12 historical libraries.
            </div>
            <div className="ms-provider-cost">⚡ 100% Free · Local Engine</div>
          </div>

          <div className="ms-provider-card">
            <span className="ms-provider-badge">Tier 2 · Neural</span>
            <div className="ms-provider-icon">☁️</div>
            <div className="ms-provider-name">Colab SDXL IP-Adapter</div>
            <div className="ms-provider-desc">
              Google Colab T4 serverless cloud backend with face/character identity consistency.
            </div>
            <div className="ms-provider-cost">⚡ Free (Colab T4 Cloud)</div>
          </div>

          <div className="ms-provider-card">
            <span className="ms-provider-badge">Tier 3 · Local Nodes</span>
            <div className="ms-provider-icon">🧩</div>
            <div className="ms-provider-name">ComfyUI (Local Port 8188)</div>
            <div className="ms-provider-desc">
              Local node-based graph workflow execution, checkpoint auto-discovery, high-resolution upscaling (up to 1536x1536).
            </div>
            <div className="ms-provider-cost">⚡ 100% Free · Local GPU</div>
          </div>

          <div className="ms-provider-card">
            <span className="ms-provider-badge">Tier 4 · Offline</span>
            <div className="ms-provider-icon">💻</div>
            <div className="ms-provider-name">Local Stable Diffusion 1.5</div>
            <div className="ms-provider-desc">
              Local ONNX / Diffusers pipeline running on local GPU with zero internet connection required.
            </div>
            <div className="ms-provider-cost">⚡ 100% Offline · Private</div>
          </div>

          <div className="ms-provider-card">
            <span className="ms-provider-badge">Tier 5 · Fallback</span>
            <div className="ms-provider-icon">🌸</div>
            <div className="ms-provider-name">Pollinations AI</div>
            <div className="ms-provider-desc">
              Ultra-fast zero-configuration cloud image synthesis fallback for rapid background prototyping.
            </div>
            <div className="ms-provider-cost">⚡ Free Cloud Endpoint</div>
          </div>

          <div className="ms-provider-card">
            <span className="ms-provider-badge">Tier 6 · Cinematic</span>
            <div className="ms-provider-icon">✨</div>
            <div className="ms-provider-name">Google Imagen 3</div>
            <div className="ms-provider-desc">
              Hyper-photorealistic cinematic renders via Google Cloud Vertex/Gemini for master keyframes.
            </div>
            <div className="ms-provider-cost">🔑 Cloud API Key</div>
          </div>
        </div>

        {/* Autonomous Movie Project Runner */}
        <div className="ms-movie-runner-deck">
          <div className="ms-runner-deck-header">
            <h4>🎬 Autonomous Movie Projects</h4>
            <button
              type="button"
              className="ms-btn ms-btn--primary"
              disabled={movieRunning}
              onClick={loadMovieProjects}
            >
              {movieProjects ? '↻ Refresh Projects' : (movieRunning ? 'Loading…' : 'Scan & Load Projects')}
            </button>
          </div>

          {movieProjects && movieProjects.length > 0 ? (
            <div className="ms-movie-projects-list">
              {movieProjects.map((p: any) => {
                const label = p.name || p.id;
                return (
                  <div key={p.id} className="ms-movie-project-item">
                    <div className="ms-project-meta">
                      <span className="ms-project-icon">🎞️</span>
                      <div>
                        <div className="ms-project-title">{label}</div>
                        <div className="ms-project-path">{(p as any).projectDir || p.id}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ms-btn ms-btn--primary"
                      disabled={movieRunning}
                      onClick={() => runMovieRouter((p as any).projectDir || p.id)}
                    >
                      {movieRunning ? 'Routing…' : '⚡ Route & Generate'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ms-runner-empty">
              {movieProjects ? 'No movie project files found in scanned paths.' : 'Click "Scan & Load Projects" to discover movie scripts and shot manifests ready for autonomous routing.'}
            </div>
          )}

          {movieRunning && (
            <div className="ms-runner-status ms-runner--busy">
              <span className="ms-spinner" /> Routing individual shots across neural &amp; 2D pipelines…
            </div>
          )}

          {movieResult && (
            <div className="ms-runner-status ms-runner--ok">
              ✓ {movieResult}
            </div>
          )}

          {movieError && (
            <div className="ms-runner-status ms-runner--error" role="alert">
              ⚠️ {movieError}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* Visual Storyboard Deck Workspace */
  const renderStoryboardWorkspace = () => {
    const activeScene = activeStoryboardScene;
    const shots = activeScene?.shots || [];
    const totalDuration = shots.reduce((acc, s) => acc + (Number(s.durationSec) || 5), 0);
    const renderedFramesCount = shots.filter(s => !!s.frameImagePath).length;

    return (
      <div className="ms-storyboard-workspace" role="region" aria-label="Visual Storyboard Deck">
        {/* Topbar: Title, Project Picker & Actions */}
        <div className="ms-storyboard-topbar">
          <div className="ms-storyboard-titles">
            <h3>🎨 Visual Storyboard Deck</h3>
            <p>Shot-by-shot sequence planning, camera framing, prompt crafting &amp; free AI keyframe generation.</p>
          </div>

          <div className="ms-storyboard-controls">
            {storyboardProjects && storyboardProjects.length > 0 && (
              <select
                className="ms-storyboard-select"
                value={selectedStoryboardId || ''}
                aria-label="Select Storyboard Project"
                disabled={storyboardBusy}
                onChange={e => {
                  const id = e.target.value;
                  if (id) {
                    setSelectedStoryboardId(id);
                    loadStoryboard(id);
                  }
                }}
              >
                {storyboardProjects.map(p => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.title || p.projectId} ({p.totalShots} shots)
                  </option>
                ))}
              </select>
            )}

            {activeStoryboard && activeStoryboard.scenes.length > 1 && (
              <select
                className="ms-storyboard-select"
                aria-label="Select Storyboard Scene"
                value={activeScene?.sceneId || ''}
                disabled={storyboardBusy}
                onChange={e => {
                  setSelectedStoryboardSceneId(e.target.value);
                  setAnimaticPlaying(false);
                  setAnimaticIndex(0);
                  setAnimaticElapsedSec(0);
                }}
              >
                {activeStoryboard.scenes.map((scene, index) => (
                  <option key={scene.sceneId} value={scene.sceneId}>
                    Scene {index + 1}: {scene.title || scene.sceneId} ({scene.shots.length} shots)
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              className="ms-btn"
              onClick={() => {
                setIsCreatingStoryboard(!isCreatingStoryboard);
                if (directorOpen) setDirectorOpen(false);
              }}
              disabled={storyboardBusy}
            >
              {isCreatingStoryboard ? '✕ Cancel' : '+ New Storyboard'}
            </button>

            <button
              type="button"
              className={`ms-btn ms-btn--secondary ${directorOpen ? 'active' : ''}`}
              onClick={() => {
                setDirectorOpen(!directorOpen);
                if (isCreatingStoryboard) setIsCreatingStoryboard(false);
              }}
              title="Auto-direct any story prompt or script into a multi-shot visual storyboard ($0.00)"
              disabled={storyboardBusy}
            >
              {directorOpen ? '✕ Cancel' : '🪄 Auto-Director'}
            </button>

            <button
              type="button"
              className="ms-btn ms-btn--primary"
              disabled={storyboardBusy || !activeStoryboard}
              onClick={() => handleSaveStoryboard()}
            >
              {storyboardSaving ? 'Saving…' : '💾 Save Board'}
            </button>

            <button
              type="button"
              className="ms-btn"
              disabled={!activeStoryboard || shots.length === 0}
              onClick={() => {
                setAnimaticIndex(0);
                setAnimaticElapsedSec(0);
                setAnimaticPlaying(true);
                setAnimaticOpen(true);
              }}
              title="Play fullscreen animatic preview with real-time sequence pacing"
            >
              ▶ Play Animatic
            </button>

            <button
              type="button"
              className="ms-btn ms-btn--secondary"
              disabled={storyboardBusy || !activeStoryboard || shots.length === 0}
              onClick={handleGenerateAllMissingFrames}
              title="Generate keyframes for all shots without images using free AI ($0.00)"
            >
              ⚡ Generate Frames
            </button>

            <button
              type="button"
              className="ms-btn"
              disabled={!activeStoryboard || shots.length === 0}
              onClick={handleExportStoryboardHtml}
              title="Export standalone printable/shareable HTML production shot sheet"
            >
              📄 Export HTML
            </button>

            <button
              type="button"
              className="ms-btn"
              onClick={handleSendToTimeline}
              title="Switch to CapCut Timeline editor"
            >
              ✂️ Open in CapCut
            </button>

            <button
              type="button"
              className="ms-btn ms-btn--primary"
              disabled={storyboardBusy || !activeStoryboard?.scenes.some(scene => scene.shots.length > 0)}
              onClick={handleRenderMovie}
              title="Save and render every scene in the project with camera motion, narration, and subtitles"
            >
              {storyboardRendering ? (
                <>
                  <span className="ms-spinner" /> Rendering 1080p…
                </>
              ) : (
                '🎬 Render Movie ($0.00)'
              )}
            </button>


            <button
              type="button"
              className="ms-btn"
              onClick={() => {
                loadStoryboardProjects();
                if (selectedStoryboardId) loadStoryboard(selectedStoryboardId);
              }}
              title="Reload storyboards from disk"
              disabled={storyboardBusy}
            >
              ↻
            </button>
          </div>
        </div>

        {/* Inline Create Drawer */}
        {isCreatingStoryboard && (
          <div className="ms-storyboard-create-box">
            <h4 style={{ margin: 0, fontSize: '0.92rem', color: '#00f0ff' }}>Create New Visual Storyboard</h4>
            <div className="ms-storyboard-create-row">
              <input
                type="text"
                className="ms-input"
                style={{ flex: 1, minWidth: 220 }}
                placeholder="Storyboard title (e.g. 'Pyramid Construction at Dawn')"
                value={newStoryboardTitle}
                onChange={e => setNewStoryboardTitle(e.target.value)}
                aria-label="Storyboard title"
              />
              <input
                type="text"
                className="ms-input"
                style={{ flex: 2, minWidth: 260 }}
                placeholder="Creative notes / visual aesthetic / era (optional)"
                value={newStoryboardNotes}
                onChange={e => setNewStoryboardNotes(e.target.value)}
                aria-label="Storyboard notes"
              />
            </div>
            <div className="ms-storyboard-create-actions">
              <button
                type="button"
                className="ms-btn ms-btn--primary"
                disabled={storyboardLoading || !newStoryboardTitle.trim()}
                onClick={handleCreateStoryboard}
              >
                {storyboardLoading ? 'Creating…' : 'Create Storyboard Project'}
              </button>
              <button
                type="button"
                className="ms-btn"
                onClick={() => setIsCreatingStoryboard(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Script-to-Storyboard Director Drawer */}
        {directorOpen && (
          <div className="ms-storyboard-create-box ms-storyboard-director-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.96rem', color: '#00f0ff', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🪄</span> Script-to-Storyboard Director Engine ($0.00)
                </h4>
                <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                  Enter any story idea, synopsis, or raw script. The director engine automatically calibrates camera framing, lenses, motion, prompts, and spoken dialogue ($0.00 spend).
                </p>
              </div>
              <button
                type="button"
                className="ms-shot-icon-btn ms-shot-icon-btn--del"
                onClick={() => setDirectorOpen(false)}
                aria-label="Close Auto-Director"
              >
                ✕
              </button>
            </div>

            {/* Preset Inspiration Chips */}
            <div className="ms-director-presets">
              <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>Inspiration Presets:</span>
              {DIRECTOR_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  className="ms-preset-chip"
                  onClick={() => {
                    setDirectorPrompt(p.prompt);
                    setDirectorGenre(p.genre);
                    if (!directorTitle) setDirectorTitle(p.label.replace(/^[^\s]+\s*/, ''));
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Script Input Textarea */}
            <textarea
              className="ms-input ms-director-textarea"
              rows={3}
              placeholder="Paste screenplay scene, narrative text, or describe your story idea (e.g. 'An ancient architect unrolls the temple blueprints under the torchlight of Karnak...')"
              value={directorPrompt}
              onChange={e => setDirectorPrompt(e.target.value)}
              aria-label="Story script or scene prompt"
            />

            {/* Controls Row: Title, Genre, Shot Count, Auto-Frames */}
            <div className="ms-director-controls-row">
              <input
                type="text"
                className="ms-input"
                style={{ flex: 2, minWidth: 180 }}
                placeholder="Project title (optional)"
                value={directorTitle}
                onChange={e => setDirectorTitle(e.target.value)}
                aria-label="Project title"
              />

              <select
                className="ms-input ms-director-select"
                value={directorGenre}
                onChange={e => setDirectorGenre(e.target.value)}
                aria-label="Cinematic genre"
              >
                <option value="auto">✨ Auto-Detect Genre</option>
                <option value="historical_epic">🏛️ Historical Epic</option>
                <option value="cyberpunk_scifi">🤖 Cyberpunk / Sci-Fi</option>
                <option value="noir_thriller">🕵️ Neo-Noir Thriller</option>
                <option value="documentary_nature">🐆 Nature Documentary</option>
                <option value="fantasy_myth">🐉 Mythic Fantasy</option>
                <option value="action_cinematic">💥 Action Blockbuster</option>
              </select>

              <select
                className="ms-input ms-director-select"
                value={directorShotCount}
                onChange={e => setDirectorShotCount(Number(e.target.value) || 4)}
                aria-label="Shot count"
              >
                <option value={3}>3 Shots (Quick Beat)</option>
                <option value={4}>4 Shots (Standard Scene)</option>
                <option value={5}>5 Shots (Dramatic Arc)</option>
                <option value={6}>6 Shots (Extended Sequence)</option>
              </select>

              <label className="ms-director-checkbox-label">
                <input
                  type="checkbox"
                  checked={directorAutoFrames}
                  onChange={e => setDirectorAutoFrames(e.target.checked)}
                />
                <span>⚡ Auto-Generate Frames</span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="ms-storyboard-create-actions">
              <button
                type="button"
                className="ms-btn ms-btn--primary"
                disabled={directorBusy || !directorPrompt.trim()}
                onClick={handleAutoDirectStoryboard}
              >
                {directorBusy ? (
                  <>
                    <span className="ms-spinner" /> Directing Scene…
                  </>
                ) : (
                  '🪄 Direct & Build Storyboard ($0.00)'
                )}
              </button>
              <button
                type="button"
                className="ms-btn"
                disabled={directorBusy}
                onClick={() => setDirectorOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Notifications & Status */}
        {storyboardError && <div className="ms-error" role="alert">{storyboardError}</div>}
        {storyboardMessage && <div className="ms-done" role="status">{storyboardMessage}</div>}
        {storyboardLoading && (
          <div className="ms-working" style={{ margin: '8px 0' }}>
            <span className="ms-spinner" /> Loading storyboard data…
          </div>
        )}

        {/* Active Storyboard Meta Information */}
        {activeStoryboard ? (
          <>
            <div className="ms-storyboard-meta-card">
              <div className="ms-storyboard-meta-left">
                <div className="ms-storyboard-meta-title">
                  <span>🎬 {activeStoryboard.project?.name || selectedStoryboardId}</span>
                  {activeStoryboard.project?.notes && (
                    <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#94a3b8' }}>
                      — {activeStoryboard.project.notes}
                    </span>
                  )}
                </div>
                <div className="ms-storyboard-meta-path">{activeStoryboard.projectDir}</div>
              </div>
              <div className="ms-storyboard-meta-badges">
                <span className="ms-storyboard-badge">{shots.length} Shot(s)</span>
                <span className="ms-storyboard-badge">⏱ {totalDuration}s Total</span>
                <span className="ms-storyboard-badge">🖼 {renderedFramesCount}/{shots.length} Frames Generated</span>
                <span className="ms-storyboard-badge ms-storyboard-badge--free">✓ $0.00 Free Policy</span>
              </div>
            </div>

            {/* Rendered Movie Celebration Banner */}
            {renderedMoviePath && (
              <div
                className="ms-movie-rendered-banner"
                style={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid #38bdf8',
                  borderRadius: '10px',
                  padding: '12px 18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  boxShadow: '0 0 20px rgba(56, 189, 248, 0.2)',
                  margin: '10px 0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.6rem' }}>🎉</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.92rem' }}>
                      Saved movie
                    </div>
                    <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#94a3b8' }}>
                      {renderedMoviePath}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="ms-btn ms-btn--primary"
                    onClick={() => {
                      if (api()?.openExternalUrl) {
                        api().openExternalUrl(toMediaFileUrl(renderedMoviePath));
                      }
                    }}
                  >
                    ▶ Open Video
                  </button>
                  <button
                    type="button"
                    className="ms-btn ms-btn--cta"
                    onClick={() => {
                      const jId = renderedMovieJobId || `sb_${selectedStoryboardId}`;
                      setSelectedJobId(jId);
                      setActiveWorkspace('director');
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#fff',
                      fontWeight: 600,
                    }}
                  >
                    🎬 Review &amp; Publish →
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    onClick={() => setRenderedMoviePath(null)}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
                <video
                  key={renderedMoviePath}
                  className="ms-video"
                  controls
                  preload="metadata"
                  aria-label="Exported storyboard video"
                  data-testid="ms-video-storyboard-export"
                  src={toMediaFileUrl(renderedMoviePath)}
                  style={{ width: '100%', maxHeight: 360, flexBasis: '100%' }}
                />
              </div>
            )}


            {/* Sequence Pacing Deck */}
            {shots.length > 0 && totalDuration > 0 && (
              <div className="ms-storyboard-pacing-deck">
                <div className="ms-storyboard-pacing-header">
                  <span>Timeline Sequence Pacing ({totalDuration}s total)</span>
                  <span>{shots.length} cuts</span>
                </div>
                <div className="ms-storyboard-pacing-bar">
                  {shots.map((s, idx) => {
                    const dur = Number(s.durationSec) || 5;
                    const pct = Math.max(5, (dur / totalDuration) * 100);
                    const colors = ['#0284c7', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#9333ea', '#db2777'];
                    const bg = colors[idx % colors.length];
                    return (
                      <div
                        key={s.shotId}
                        className="ms-pacing-segment"
                        style={{ width: `${pct}%`, backgroundColor: bg }}
                        title={`${s.shotId}: ${s.framing.toUpperCase()} (${dur}s)`}
                      >
                        {idx + 1} ({dur}s)
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Shot Cards Deck */}
            <fieldset className="ms-storyboard-deck" disabled={storyboardBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {shots.map((shot, idx) => {
                const isGenerating = generatingShotId === shot.shotId;
                const framingPills = ['wide', 'medium', 'close', 'extreme_close'];
                const lensPills = ['24mm', '35mm', '50mm', '85mm'];
                const motionPills = ['static', 'pan right', 'slow push in', 'tilt up', 'tracking'];

                return (
                  <div key={shot.shotId} className="ms-shot-card">
                    {/* Header */}
                    <div className="ms-shot-card-header">
                      <div className="ms-shot-number-badge">
                        <span>#{idx + 1}</span>
                        <span style={{ opacity: 0.6, fontSize: '0.72rem', fontFamily: 'monospace' }}>{shot.shotId}</span>
                      </div>

                      <div className="ms-shot-header-actions">
                        <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                          <input
                            type="number"
                            className="ms-shot-duration-input"
                            value={shot.durationSec ?? 5}
                            min={1}
                            max={120}
                            aria-label={`Duration for ${shot.shotId}`}
                            onChange={e => handleUpdateShot(shot.shotId, { durationSec: Number(e.target.value) })}
                          />s
                        </label>

                        <button
                          type="button"
                          className="ms-shot-icon-btn"
                          disabled={idx === 0}
                          title="Move Shot Earlier"
                          aria-label={`Move ${shot.shotId} earlier`}
                          onClick={() => handleMoveShot(idx, 'up')}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ms-shot-icon-btn"
                          disabled={idx === shots.length - 1}
                          title="Move Shot Later"
                          aria-label={`Move ${shot.shotId} later`}
                          onClick={() => handleMoveShot(idx, 'down')}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="ms-shot-icon-btn ms-shot-icon-btn--del"
                          title="Delete Shot"
                          aria-label={`Delete ${shot.shotId}`}
                          onClick={() => handleDeleteShot(shot.shotId)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Viewport / Frame Preview */}
                    <div className="ms-shot-viewport">
                      <div className="ms-shot-frame-guide" />
                      {shot.frameImagePath ? (
                        <>
                          {shot.frameStale && (
                            <span className="ms-shot-stale-badge">⚠ Prompt changed — regenerate</span>
                          )}
                          <img
                            src={toMediaFileUrl(shot.frameImagePath)}
                            alt={shot.shotId}
                            className={`ms-shot-thumb-img${shot.frameStale ? ' ms-shot-thumb-img--stale' : ''}`}
                          />
                          <div className="ms-shot-thumb-overlay">
                            <button
                              type="button"
                              className="ms-btn ms-btn--primary"
                              disabled={isGenerating}
                              onClick={() => handleGenerateFrame(shot.shotId, shot.prompt)}
                            >
                              {isGenerating ? 'Rendering…' : '↻ Regenerate Frame'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="ms-shot-thumb-placeholder">
                          {isGenerating ? (
                            <span className="ms-working">
                              <span className="ms-spinner" /> Generating AI frame ($0.00)…
                            </span>
                          ) : (
                            <>
                              <span style={{ fontSize: '1.8rem' }}>🖼️</span>
                              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No frame rendered yet</span>
                              <button
                                type="button"
                                className="ms-btn ms-btn--primary"
                                style={{ fontSize: '0.76rem', padding: '4px 10px' }}
                                onClick={() => handleGenerateFrame(shot.shotId, shot.prompt)}
                              >
                                ⚡ Generate Frame ($0.00)
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Shot Controls & Inputs */}
                    <div className="ms-shot-card-body">
                      {/* Framing Pills */}
                      <div className="ms-shot-pills-row">
                        <span className="ms-shot-pill-label">Camera Shot Size</span>
                        <div className="ms-shot-pills">
                          {framingPills.map(f => (
                            <button
                              key={f}
                              type="button"
                              className={`ms-shot-pill ${shot.framing === f ? 'active' : ''}`}
                              onClick={() => handleUpdateShot(shot.shotId, { framing: f })}
                            >
                              {f.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Lens & Motion Pills */}
                      <div className="ms-shot-pills-row">
                        <span className="ms-shot-pill-label">Focal Length &amp; Motion</span>
                        <div className="ms-shot-pills">
                          {lensPills.map(l => (
                            <button
                              key={l}
                              type="button"
                              className={`ms-shot-pill ${shot.lens === l ? 'active' : ''}`}
                              onClick={() => handleUpdateShot(shot.shotId, { lens: l })}
                            >
                              {l}
                            </button>
                          ))}
                          {motionPills.map(m => (
                            <button
                              key={m}
                              type="button"
                              className={`ms-shot-pill ${shot.movement === m ? 'active' : ''}`}
                              onClick={() => handleUpdateShot(shot.shotId, { movement: m })}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Action Prompt */}
                      <div className="ms-shot-field">
                        <div className="ms-shot-field-header">
                          <span className="ms-shot-label">Visual Action / Prompt:</span>
                          <button
                            type="button"
                            className="ms-shot-enhance-btn"
                            title="Enhance prompt with cinematic lighting, camera lens depth, and artistic details based on framing"
                            onClick={() => handleEnhancePrompt(shot.shotId)}
                          >
                            ✨ Enhance Prompt
                          </button>
                        </div>
                        <textarea
                          className="ms-shot-textarea"
                          value={shot.prompt}
                          rows={2}
                          placeholder="Visual prompt for image generator…"
                          aria-label={`Prompt for ${shot.shotId}`}
                          onChange={e => handleUpdateShot(shot.shotId, { prompt: e.target.value })}
                        />
                      </div>

                      {/* Narration Script */}
                      <div className="ms-shot-field">
                        <span className="ms-shot-label">Narration / Script Line:</span>
                        <input
                          type="text"
                          className="ms-input"
                          style={{ fontSize: '0.78rem', padding: '5px 8px' }}
                          value={shot.narration || ''}
                          placeholder="Voiceover narration or dialogue line…"
                          aria-label={`Narration for ${shot.shotId}`}
                          onChange={e => handleUpdateShot(shot.shotId, { narration: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add New Shot Card */}
              <button
                type="button"
                className="ms-shot-add-card"
                aria-label="Add Shot to Storyboard"
                onClick={handleAddShot}
              >
                <span className="ms-shot-add-icon">+</span>
                <span className="ms-shot-add-label">Add Shot to Sequence</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>New shot card with custom camera framing</span>
              </button>
            </fieldset>
          </>
        ) : (
          <div className="ms-runner-empty" style={{ padding: '40px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }}>🎨</span>
            <h4>No Storyboard Selected</h4>
            <p style={{ maxWidth: 460, margin: '0 auto 16px', color: '#94a3b8' }}>
              Select an existing storyboard from the dropdown above, or click "+ New Storyboard" to plan your first visual scene deck.
            </p>
            <button
              type="button"
              className="ms-btn ms-btn--primary"
              onClick={() => setIsCreatingStoryboard(true)}
            >
              + Create First Storyboard
            </button>
          </div>
        )}

        {/* Fullscreen Animatic Player Modal */}
        {animaticOpen && activeStoryboard && (
          <div className="ms-animatic-overlay" role="dialog" aria-label="Storyboard Animatic Player">
            <div className="ms-animatic-modal">
              <div className="ms-animatic-header">
                <div className="ms-animatic-title">
                  <span>🎬 Animatic Playback: {activeStoryboard.project?.name || selectedStoryboardId}</span>
                </div>
                <div className="ms-animatic-header-right">
                  <span className="ms-animatic-badge">
                    Shot {animaticIndex + 1} of {shots.length}
                  </span>
                  <button
                    type="button"
                    className="ms-shot-icon-btn ms-shot-icon-btn--del"
                    aria-label="Close Animatic Player"
                    onClick={() => {
                      setAnimaticPlaying(false);
                      setAnimaticOpen(false);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Cinema Viewport */}
              <div className="ms-animatic-screen">
                {shots[animaticIndex]?.frameImagePath ? (
                  <img
                    src={toMediaFileUrl(shots[animaticIndex].frameImagePath)}
                    alt={shots[animaticIndex].shotId}
                    className="ms-animatic-img"
                  />
                ) : (
                  <div className="ms-animatic-placeholder">
                    <span style={{ fontSize: '3rem' }}>🎨</span>
                    <h4>{shots[animaticIndex]?.shotId} ({shots[animaticIndex]?.framing?.toUpperCase() || 'MEDIUM'})</h4>
                    <p>{shots[animaticIndex]?.prompt}</p>
                    <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Frame preview placeholder ($0.00)</span>
                  </div>
                )}

                {/* HUD Camera Pills */}
                <div className="ms-animatic-hud">
                  <span className="ms-animatic-pill ms-animatic-pill--accent">{shots[animaticIndex]?.framing}</span>
                  <span className="ms-animatic-pill">{shots[animaticIndex]?.lens}</span>
                  <span className="ms-animatic-pill">{shots[animaticIndex]?.movement}</span>
                </div>

                {/* Subtitles (Dialogue or Action) */}
                <div className="ms-animatic-subtitles">
                  {shots[animaticIndex]?.narration ? (
                    <span className="ms-animatic-sub-dialogue">"{shots[animaticIndex].narration}"</span>
                  ) : (
                    <span className="ms-animatic-sub-action">{shots[animaticIndex]?.prompt}</span>
                  )}
                </div>
              </div>

              {/* Progress Scrubber Bar */}
              <div className="ms-animatic-progress-bar">
                <div
                  className="ms-animatic-progress-fill"
                  style={{
                    width: `${Math.min(100, (animaticElapsedSec / (shots[animaticIndex]?.durationSec || 5)) * 100)}%`,
                  }}
                />
              </div>

              {/* Playback Controls */}
              <div className="ms-animatic-controls">
                <div className="ms-animatic-controls-left">
                  <button
                    type="button"
                    className="ms-btn ms-btn--primary"
                    onClick={() => setAnimaticPlaying(!animaticPlaying)}
                  >
                    {animaticPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    disabled={animaticIndex === 0}
                    onClick={() => {
                      setAnimaticIndex(prev => Math.max(0, prev - 1));
                      setAnimaticElapsedSec(0);
                    }}
                  >
                    ⏮ Prev
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    disabled={animaticIndex === shots.length - 1}
                    onClick={() => {
                      setAnimaticIndex(prev => Math.min(shots.length - 1, prev + 1));
                      setAnimaticElapsedSec(0);
                    }}
                  >
                    Next ⏭
                  </button>
                  <button
                    type="button"
                    className={`ms-btn ${animaticLoop ? 'ms-btn--secondary' : ''}`}
                    onClick={() => setAnimaticLoop(!animaticLoop)}
                  >
                    🔁 Loop: {animaticLoop ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="ms-animatic-timecode">
                  <span>Shot #{animaticIndex + 1}: {Math.floor(animaticElapsedSec)}s / {shots[animaticIndex]?.durationSec || 5}s</span>
                  <span style={{ opacity: 0.5 }}> | Total Sequence: {totalDuration}s</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="media-studio">
      {/* Blender DCC Top Mode Ribbon */}
      <div className="ms-dcc-bar">
        <div className="ms-dcc-header">
          <div className="ms-dcc-branding">
            <h2>🎬 Media Studio &amp; Movie Engine</h2>
            <div className="ms-dcc-pill-row">
              <span className="ms-dcc-chip ms-chip--orange">Showrunner 2D</span>
              <span className="ms-dcc-chip ms-chip--cyan">6-Tier Router</span>
              <span className="ms-dcc-chip ms-chip--purple">NLE CapCut</span>
              <span className="ms-dcc-chip ms-chip--green">Blender Stage</span>
              <span className="ms-dcc-chip ms-chip--amber">Storyboard Deck</span>
              <span className="ms-dcc-chip ms-chip--teal">ComfyUI Nodes</span>
            </div>
          </div>
        </div>

        <div className="ms-workspace-ribbon" role="tablist" aria-label="Studio Workspaces">
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'director'}
            className={`ms-workspace-tab ${activeWorkspace === 'director' ? 'active' : ''}`}
            onClick={() => setActiveWorkspace('director')}
          >
            <span className="ms-tab-icon">🎬</span>
            <span className="ms-tab-name">Director Console</span>
            <span className="ms-tab-badge">{jobs.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'storyboard'}
            className={`ms-workspace-tab ${activeWorkspace === 'storyboard' ? 'active' : ''}`}
            onClick={() => {
              setActiveWorkspace('storyboard');
              if (!storyboardProjects && !storyboardLoading) {
                loadStoryboardProjects();
              }
            }}
          >
            <span className="ms-tab-icon">🎨</span>
            <span className="ms-tab-name">Storyboard</span>
            <span className="ms-tab-badge">{storyboardProjects ? storyboardProjects.length : 'Deck'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'timeline'}
            className={`ms-workspace-tab ${activeWorkspace === 'timeline' ? 'active' : ''}`}
            onClick={() => setActiveWorkspace('timeline')}
          >
            <span className="ms-tab-icon">✂️</span>
            <span className="ms-tab-name">CapCut Timeline</span>
            <span className="ms-tab-pill">NLE</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'stage'}
            className={`ms-workspace-tab ${activeWorkspace === 'stage' ? 'active' : ''}`}
            onClick={() => setActiveWorkspace('stage')}
          >
            <span className="ms-tab-icon">🎭</span>
            <span className="ms-tab-name">Stage Viewport</span>
            <span className="ms-tab-pill">{stageAspectRatio}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'router'}
            className={`ms-workspace-tab ${activeWorkspace === 'router' ? 'active' : ''}`}
            onClick={() => {
              setActiveWorkspace('router');
              if (!movieProjects && !movieRunning) {
                loadMovieProjects();
              }
            }}
          >
            <span className="ms-tab-icon">⚡</span>
            <span className="ms-tab-name">Movie Router</span>
            <span className="ms-tab-badge">5 Eng</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'ap'}
            className={`ms-workspace-tab ${activeWorkspace === 'ap' ? 'active' : ''}`}
            onClick={() => {
              setActiveWorkspace('ap');
              if (!apEpisodes && !apLoading) {
                openApSection();
              }
            }}
          >
            <span className="ms-tab-icon">🏛️</span>
            <span className="ms-tab-name">Ancient Pathways</span>
            <span className="ms-tab-badge">{apEpisodes ? apEpisodes.length : '12'}</span>
          </button>
        </div>
      </div>

      {confirmDialog}

      {error && <div className="ms-error" role="alert">{error}</div>}
      {done && <div className="ms-done" role="status">{done}</div>}

      {activeWorkspace === 'storyboard' && renderStoryboardWorkspace()}
      {activeWorkspace === 'timeline' && renderTimelineWorkspace()}
      {activeWorkspace === 'stage' && renderStageWorkspace()}
      {activeWorkspace === 'router' && renderMovieRouterWorkspace()}
      {activeWorkspace === 'ap' && renderAncientPathwaysWorkspace()}

      {activeWorkspace === 'director' && (
        <>
          {/* Studio Quick Launch Hub */}
          <div className="ms-director-hub" role="region" aria-label="Studio Quick Launch">
            <div
              className="ms-hub-card"
              onClick={() => {
                setActiveWorkspace('storyboard');
                if (!storyboardProjects && !storyboardLoading) {
                  loadStoryboardProjects();
                }
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setActiveWorkspace('storyboard'); }}
            >
              <div className="ms-hub-icon">🎨</div>
              <div className="ms-hub-info">
                <div className="ms-hub-title">Visual Storyboard Deck</div>
                <div className="ms-hub-desc">Shot-by-shot sequence planning, camera framing, prompt crafting &amp; frame gen</div>
              </div>
              <span className="ms-hub-badge">{storyboardProjects ? `${storyboardProjects.length} Boards` : 'Visual Deck'}</span>
            </div>

            <div
              className="ms-hub-card"
              onClick={() => {
                setActiveWorkspace('router');
                if (!movieProjects && !movieRunning) {
                  loadMovieProjects();
                }
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setActiveWorkspace('router'); }}
            >
              <div className="ms-hub-icon">⚡</div>
              <div className="ms-hub-info">
                <div className="ms-hub-title">6-Engine Movie Router</div>
                <div className="ms-hub-desc">AP 2D, SDXL IP-Adapter, ComfyUI, Local SD 1.5, Pollinations, Imagen 3</div>
              </div>
              <span className="ms-hub-badge">6 Engines</span>
            </div>

            <div
              className="ms-hub-card"
              onClick={() => {
                setActiveWorkspace('ap');
                if (!apEpisodes && !apLoading) {
                  openApSection();
                }
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setActiveWorkspace('ap'); }}
            >
              <div className="ms-hub-icon">🏛️</div>
              <div className="ms-hub-info">
                <div className="ms-hub-title">Ancient Pathways 2D</div>
                <div className="ms-hub-desc">12-Episode motion comic series, Leila &amp; Flappy, full voiceacting</div>
              </div>
              <span className="ms-hub-badge">{apEpisodes ? apEpisodes.length : '12'} Episodes</span>
            </div>

            <div
              className="ms-hub-card"
              onClick={() => setActiveWorkspace('timeline')}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setActiveWorkspace('timeline'); }}
            >
              <div className="ms-hub-icon">✂️</div>
              <div className="ms-hub-info">
                <div className="ms-hub-title">CapCut Timeline</div>
                <div className="ms-hub-desc">Multi-track NLE editor, B-roll, subtitles, voiceover &amp; transitions</div>
              </div>
              <span className="ms-hub-badge">NLE View</span>
            </div>

            <div
              className="ms-hub-card"
              onClick={() => setActiveWorkspace('stage')}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setActiveWorkspace('stage'); }}
            >
              <div className="ms-hub-icon">🎭</div>
              <div className="ms-hub-info">
                <div className="ms-hub-title">Stage Viewport</div>
                <div className="ms-hub-desc">Blender 3D camera staging, safe-area reticles &amp; composition</div>
              </div>
              <span className="ms-hub-badge">{stageAspectRatio}</span>
            </div>
          </div>

          <header className="ms-header">
            <h2>Media Studio</h2>
            <p className="ms-sub">
              Nothing is published without your approval. Videos waiting on you appear first.
            </p>
          </header>

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

          {/* A second source: recap an episode of a podcast. */}
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

          {/* A third source: an idea already brainstormed in chat. */}
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
              renderAncientPathwaysShowcase(true)
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
              src={toMediaFileUrl(samplePath)}
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
        </>
      )}
    </div>
  );
};

export default MediaStudioPanel;
