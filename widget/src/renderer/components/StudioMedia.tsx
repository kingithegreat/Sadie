import React, { useCallback, useEffect, useRef, useState } from 'react';
import { acquireStudioPlayback, releaseStudioPlayback } from './studioPlaybackCoordinator';

const STORAGE_KEY = 'homebot.studio.playback.v1';
const MAX_SAVED_PLAYERS = 30;
type SavedPlayback = { source: string; volume: number; muted: boolean; time: number; savedAt: number };
type SavedPlayers = Record<string, SavedPlayback>;
function readPlayers(): SavedPlayers {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SavedPlayers : {};
  } catch { return {}; }
}

interface StudioMediaProps {
  kind: 'video' | 'audio';
  src: string;
  label: string;
  className?: string;
  testId?: string;
  style?: React.CSSProperties;
  preload?: 'none' | 'metadata';
  active?: boolean;
  onActivate?: () => void;
  reveal?: () => void | Promise<void>;
  /** A job identity and output revision, not just a reused filesystem path. */
  persistence?: { jobId: string; revision: string };
}

/** Native review controls share coordination, accessible errors and bounded resume state. */
export function StudioMedia({ kind, src, label, className, testId, style, preload = 'metadata',
  active = true, onActivate, reveal, persistence }: StudioMediaProps) {
  const owner = useRef({});
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [revealError, setRevealError] = useState(false);
  const [retry, setRetry] = useState(0);
  const restored = useRef(false);
  const lastSave = useRef(0);
  const identity = JSON.stringify([src, persistence?.revision]);
  const jobId = persistence?.jobId;

  const save = useCallback((media: HTMLMediaElement, force = false) => {
    if (!jobId || !restored.current || (!force && Date.now() - lastSave.current < 2000)) return;
    lastSave.current = Date.now();
    try {
      const players = readPlayers();
      players[jobId] = { source: identity, volume: media.volume, muted: media.muted,
        time: media.ended ? 0 : (Number.isFinite(media.currentTime) ? media.currentTime : 0), savedAt: Date.now() };
      const bounded = Object.fromEntries(Object.entries(players)
        .filter(([, value]) => value && Number.isFinite(value.savedAt))
        .sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_SAVED_PLAYERS));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
    } catch { /* Playback remains usable when storage is unavailable or full. */ }
  }, [jobId, identity]);

  useEffect(() => {
    setFailed(false);
    setRevealError(false);
    restored.current = false;
    const media = mediaRef.current;
    const session = owner.current;
    return () => {
      releaseStudioPlayback(session);
      if (media) {
        save(media, true);
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
    };
  }, [active, identity, retry, save]);

  if (!active) return <button type="button" className="ms-btn" onClick={onActivate}
    aria-label={`Open ${label}`}>Open preview</button>;

  const props = {
    ref: (node: HTMLMediaElement | null) => { mediaRef.current = node; },
    className, style, src, controls: true, preload, 'aria-label': label, 'data-testid': testId,
    onPlay: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget;
      if (media !== mediaRef.current || media.paused) return;
      acquireStudioPlayback(owner.current, () => { save(media, true); media.pause(); });
    },
    onPause: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget !== mediaRef.current || !event.currentTarget.paused) return;
      save(event.currentTarget, true);
      releaseStudioPlayback(owner.current);
    },
    onEnded: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget !== mediaRef.current || !event.currentTarget.ended) return;
      save(event.currentTarget, true);
      releaseStudioPlayback(owner.current);
    },
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget === mediaRef.current) save(event.currentTarget);
    },
    onVolumeChange: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget === mediaRef.current) save(event.currentTarget, true);
    },
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget;
      if (media !== mediaRef.current) return;
      const saved = jobId ? readPlayers()[jobId] : undefined;
      if (saved && saved.source === identity) {
        if (Number.isFinite(saved.volume)) media.volume = Math.max(0, Math.min(1, saved.volume));
        if (typeof saved.muted === 'boolean') media.muted = saved.muted;
        if (Number.isFinite(saved.time) && Number.isFinite(media.duration) && saved.time < media.duration - 0.25) {
          media.currentTime = Math.max(0, saved.time);
        }
      }
      restored.current = true;
    },
    onError: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget !== mediaRef.current || !event.currentTarget.getAttribute('src')) return;
      event.currentTarget.pause();
      releaseStudioPlayback(owner.current);
      setFailed(true);
    },
  };
  return <>
    {kind === 'video' ? <video key={`${identity}:${retry}`} {...props} /> : <audio key={`${identity}:${retry}`} {...props} />}
    {failed && <div role="alert" className="ms-media-error">
      <p>{label} could not play. The file may have moved or may be unreadable. Retry, or create a new preview using the generation controls.</p>
      <button type="button" className="ms-btn" onClick={() => setRetry(value => value + 1)}>Retry playback</button>
      {reveal && <button type="button" className="ms-btn" onClick={async () => {
        try { await reveal(); } catch { setRevealError(true); }
      }}>Open file location</button>}
      {revealError && <p>The file location could not be opened.</p>}
    </div>}
  </>;
}
