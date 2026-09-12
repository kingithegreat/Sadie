import { useCallback, useEffect, useRef } from 'react';

interface TimelinePlaybackOptions {
  active: boolean;
  source: string;
  playing: boolean;
  duration: number;
  loop: boolean;
  inPoint: number | null;
  outPoint: number | null;
  volume: number;
  muted: boolean;
  rate: number;
  onTime: (time: number) => void;
  onPlaying: (playing: boolean) => void;
  onDuration: (duration: number | null) => void;
  onError: (message: string) => void;
}

/** The selected media element owns the timeline clock. No simulated audio. */
export function useTimelinePlayback(options: TimelinePlaybackOptions) {
  const { active, source, playing, duration, loop, inPoint, outPoint,
    volume, muted, rate, onTime, onPlaying, onDuration, onError } = options;
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const pendingSeek = useRef(0);
  const start = inPoint !== null && inPoint >= 0 && inPoint < duration ? inPoint : 0;
  const end = outPoint !== null && outPoint > start ? Math.min(outPoint, duration) : duration;
  const boundsRef = useRef({ start, end });
  boundsRef.current = { start, end };

  const reportError = useCallback(() => {
    onPlaying(false);
    onError('Timeline playback failed. The media file may be missing or unreadable. Open its preview or generate it again.');
  }, [onPlaying, onError]);

  useEffect(() => {
    onPlaying(false);
    onTime(0);
    onDuration(null);
    pendingSeek.current = 0;
  }, [source, onPlaying, onTime, onDuration]);

  // A keyed element is replaced on source changes. Release the old file handle
  // on project/workspace change and unmount, including Windows file locks.
  useEffect(() => {
    const media = mediaRef.current;
    if (!active || !media) return;
    return () => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    };
  }, [active, source]);

  useEffect(() => {
    if (!active) onPlaying(false);
    const media = mediaRef.current;
    if (!media || !active) return;
    if (!playing) { media.pause(); return; }
    let cancelled = false;
    const bounds = boundsRef.current;
    if (media.currentTime < bounds.start || (bounds.end > bounds.start && media.currentTime >= bounds.end)) {
      media.currentTime = bounds.start;
      onTime(bounds.start);
    }
    Promise.resolve(media.play()).catch(() => {
      if (!cancelled && mediaRef.current === media) reportError();
    });
    return () => { cancelled = true; media.pause(); };
  }, [active, source, playing, onPlaying, onTime, reportError]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!active || !media) return;
    media.volume = Math.max(0, Math.min(1, volume));
    media.muted = muted;
    media.playbackRate = rate;
  }, [active, source, volume, muted, rate]);

  // Explicit user seeks are separate from decoder clock reports. Even a tiny
  // seek is applied, without repeatedly seeking on ordinary clock updates.
  const seek = useCallback((requested: number) => {
    const target = Math.max(0, Math.min(requested, duration));
    pendingSeek.current = target;
    const media = mediaRef.current;
    if (media) media.currentTime = target;
    onTime(target);
  }, [duration, onTime]);

  const updateClock = useCallback(() => {
    const media = mediaRef.current;
    if (!active || !media) return;
    if (playing && media.currentTime < start) media.currentTime = start;
    if (playing && end > start && (media.ended || media.currentTime >= end)) {
      if (loop) {
        media.currentTime = start;
        onTime(start);
        Promise.resolve(media.play()).catch(() => {
          if (mediaRef.current === media && media.getAttribute('src')) reportError();
        });
      } else {
        media.pause();
        onPlaying(false);
        media.currentTime = end;
        onTime(end);
      }
    } else {
      onTime(media.currentTime);
    }
  }, [active, playing, start, end, loop, onTime, onPlaying, reportError]);

  useEffect(() => {
    if (!active || !source || !playing) return;
    const timer = setInterval(updateClock, 100);
    return () => clearInterval(timer);
  }, [active, source, playing, updateClock]);

  const loadedMetadata = useCallback(() => {
    const media = mediaRef.current;
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      onDuration(media.duration);
      media.currentTime = Math.min(pendingSeek.current, media.duration);
    }
  }, [onDuration]);

  return {
    seek,
    events: {
      ref: useCallback((node: HTMLMediaElement | null) => { mediaRef.current = node; }, []),
      onLoadedMetadata: loadedMetadata,
      onTimeUpdate: updateClock,
      onEnded: updateClock,
      onPause: (event: { currentTarget: HTMLMediaElement }) => {
        if (mediaRef.current === event.currentTarget && !event.currentTarget.ended) onPlaying(false);
      },
      onError: () => { if (mediaRef.current?.getAttribute('src')) reportError(); },
    },
  };
}
