import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireStudioPlayback, releaseStudioPlayback } from './studioPlaybackCoordinator';

interface Shot { shotId?: string; narration?: string; durationSec?: number }
interface Options {
  active: boolean;
  sceneKey: string;
  shots: readonly Shot[];
  loop: boolean;
  loadAudio: (narration: string) => Promise<string>;
  onError: (message: string) => void;
}
const lengthOf = (shot?: Shot) => Number.isFinite(shot?.durationSec) && Number(shot?.durationSec) > 0 ? Number(shot?.durationSec) : 5;

/** Planned shot lengths define the cut. Narration owns time until it ends;
 * shorter narration holds the picture silently, longer narration is cut.
 * Loading/stalled narration never advances the picture on a simulated clock. */
export function useAnimaticPlayback(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [position, setPosition] = useState({ index: 0, elapsed: 0 });
  const positionRef = useRef(position);
  const [playing, updatePlaying] = useState(false);
  const playingRef = useRef(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const media = useRef<HTMLAudioElement | null>(null);
  const owner = useRef({});
  const epoch = useRef(0);
  const playAttempt = useRef(0);
  const ready = useRef(false);
  const tail = useRef(false);
  const lastTick = useRef(0);
  const pendingStart = useRef(false);
  const sourceKey = JSON.stringify([options.sceneKey, options.shots.map(s => [s.shotId, s.narration, s.durationSec])]);
  const previousSource = useRef(sourceKey);
  // Reset selection before deciding which narration to request, rather than
  // synthesising the previous scene's index while React applies the reset.
  const effectiveIndex = previousSource.current === sourceKey ? position.index : 0;

  const publish = useCallback((index: number, elapsed: number) => {
    positionRef.current = { index, elapsed };
    setPosition(positionRef.current);
  }, []);
  const stop = useCallback(() => {
    playAttempt.current += 1;
    playingRef.current = false;
    updatePlaying(false);
    media.current?.pause();
    releaseStudioPlayback(owner.current);
  }, []);
  const fail = useCallback(() => {
    stop();
    setLoading(false);
    const message = 'Animatic narration could not play. Retry narration, or check the voice settings and generate it again.';
    setError(message);
    latest.current.onError(message);
  }, [stop]);
  const playMedia = useCallback(() => {
    const element = media.current;
    if (!element?.getAttribute('src') || !ready.current || tail.current || !playingRef.current) return;
    const request = epoch.current;
    const attempt = ++playAttempt.current;
    try {
      Promise.resolve(element.play()).catch(() => {
        if (request === epoch.current && attempt === playAttempt.current && playingRef.current && element === media.current) fail();
      });
    } catch { fail(); }
  }, [fail]);
  const setPlaying = useCallback((value: boolean) => {
    if (!value) { pendingStart.current = false; stop(); return; }
    if (!latest.current.shots.length) return;
    if (!latest.current.active) { pendingStart.current = true; return; }
    pendingStart.current = false;
    const p = positionRef.current;
    if (p.index === latest.current.shots.length - 1 && p.elapsed >= lengthOf(latest.current.shots[p.index])) {
      publish(0, 0);
      ready.current = false;
      tail.current = false;
      setRetryVersion(v => v + 1);
    }
    acquireStudioPlayback(owner.current, stop);
    playingRef.current = true;
    updatePlaying(true);
    lastTick.current = performance.now();
    playMedia();
  }, [playMedia, publish, stop]);

  const seekWithin = useCallback((index: number, elapsed: number) => {
    const changed = index !== positionRef.current.index;
    publish(index, elapsed);
    lastTick.current = performance.now();
    if (changed) {
      epoch.current += 1;
      ready.current = false;
      media.current?.pause();
    } else if (media.current?.getAttribute('src') && ready.current) {
      const duration = media.current.duration;
      tail.current = Number.isFinite(duration) && elapsed >= duration;
      media.current.currentTime = Number.isFinite(duration) ? Math.min(elapsed, duration) : elapsed;
      if (tail.current) media.current.pause(); else playMedia();
    }
    const shots = latest.current.shots;
    if (index === shots.length - 1 && elapsed >= lengthOf(shots[index])) stop();
  }, [publish, playMedia, stop]);
  const seek = useCallback((requested: number) => {
    const shots = latest.current.shots;
    if (!shots.length) return;
    let remaining = Math.max(0, Number.isFinite(requested) ? requested : 0);
    for (let index = 0; index < shots.length; index += 1) {
      const duration = lengthOf(shots[index]);
      if (remaining < duration || index === shots.length - 1) {
        seekWithin(index, Math.min(remaining, duration));
        return;
      }
      remaining -= duration;
    }
  }, [seekWithin]);
  const goTo = useCallback((index: number) => {
    seekWithin(Math.max(0, Math.min(index, latest.current.shots.length - 1)), 0);
  }, [seekWithin]);

  useEffect(() => {
    previousSource.current = sourceKey;
    stop();
    publish(0, 0);
  }, [sourceKey, stop, publish]);

  useEffect(() => {
    const request = ++epoch.current;
    ready.current = false;
    tail.current = false;
    setAudioUrl('');
    setError('');
    const element = media.current;
    element?.pause();
    if (!options.active) { stop(); setLoading(false); return; }
    if (pendingStart.current) setPlaying(true);
    const narration = latest.current.shots[effectiveIndex]?.narration?.trim();
    setLoading(Boolean(narration));
    // Play/seek establish the clock. Automatic silent cuts retain its timestamp
    // so the render/effect delay does not stretch the sequence.
    if (!narration) { ready.current = true; return; }
    void latest.current.loadAudio(narration).then(url => {
      if (request !== epoch.current) return;
      if (!url) { fail(); return; }
      setAudioUrl(url);
    }).catch(() => { if (request === epoch.current) fail(); });
    return () => { epoch.current += 1; };
  }, [options.active, options.loadAudio, sourceKey, effectiveIndex, retryVersion, stop, fail, setPlaying]);

  const tick = useCallback(() => {
    if (!playingRef.current || !latest.current.active || !ready.current) return;
    const now = performance.now();
    const p = positionRef.current;
    const shots = latest.current.shots;
    const shot = shots[p.index];
    if (!shot) { stop(); return; }
    const duration = lengthOf(shot);
    const decoderClock = Boolean(shot.narration?.trim()) && !tail.current;
    const elapsed = decoderClock
      ? media.current?.currentTime ?? p.elapsed
      : p.elapsed + Math.max(0, now - lastTick.current) / 1000;
    lastTick.current = now;
    if (elapsed < duration) { publish(p.index, elapsed); return; }
    media.current?.pause();
    ready.current = false;
    let index = p.index;
    // A decoder's overshoot belongs to the outgoing audio, never the next cut.
    // A silent clock, however, must carry elapsed time across delayed frames.
    let remaining = decoderClock ? duration : elapsed;
    const looping = latest.current.loop;
    if (looping && shots.every(candidate => !candidate.narration?.trim())) {
      remaining %= shots.reduce((total, candidate) => total + lengthOf(candidate), 0);
    }
    // At most one traversal: all-silent loops were reduced above, and a mixed
    // loop always encounters narration, where playback waits for that decoder.
    for (let traversed = 0; traversed <= shots.length; traversed += 1) {
      const segmentLength = lengthOf(shots[index]);
      if (remaining < segmentLength) break;
      remaining -= segmentLength;
      if (index === shots.length - 1) {
        if (!looping) { publish(index, segmentLength); stop(); return; }
        index = 0;
      } else index += 1;
      if (shots[index].narration?.trim()) { remaining = 0; break; }
    }
    publish(index, remaining);
    // The selected index may be unchanged after a complete loop.
    if (index === p.index) setRetryVersion(v => v + 1);
  }, [publish, stop]);
  useEffect(() => {
    if (!playing || !options.active) return;
    const timer = setInterval(tick, 50);
    return () => clearInterval(timer);
  }, [playing, options.active, tick]);
  useEffect(() => () => { epoch.current += 1; stop(); }, [stop]);

  const ref = useCallback((element: HTMLAudioElement | null) => {
    if (media.current && media.current !== element) {
      media.current.pause();
      media.current.removeAttribute('src');
      media.current.load();
    }
    media.current = element;
  }, []);
  return {
    index: position.index, elapsed: position.elapsed, playing, loading, audioUrl, error,
    setPlaying, seek, goTo,
    retry: () => setRetryVersion(v => v + 1),
    events: {
      ref,
      onLoadedMetadata: (event: { currentTarget: HTMLAudioElement }) => {
        const element = event.currentTarget;
        if (element !== media.current || !latest.current.active || !audioUrl) return;
        const elapsed = positionRef.current.elapsed;
        tail.current = Number.isFinite(element.duration) && elapsed >= element.duration;
        element.currentTime = Number.isFinite(element.duration) ? Math.min(elapsed, element.duration) : elapsed;
        ready.current = true;
        setLoading(false);
        lastTick.current = performance.now();
        playMedia();
      },
      onTimeUpdate: tick,
      onEnded: (event: { currentTarget: HTMLAudioElement }) => {
        const element = event.currentTarget;
        if (!ready.current || !latest.current.active || element !== media.current || !element.ended) return;
        publish(positionRef.current.index, Math.min(element.currentTime, lengthOf(latest.current.shots[positionRef.current.index])));
        tail.current = true;
        lastTick.current = performance.now();
        tick();
      },
      onError: (event: { currentTarget: HTMLAudioElement }) => {
        if (event.currentTarget === media.current && audioUrl && latest.current.active) fail();
      },
    },
  };
}
