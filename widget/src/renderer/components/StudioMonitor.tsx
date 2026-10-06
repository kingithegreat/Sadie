import { useEffect, useRef, useState, type ReactNode } from 'react';
import './StudioMonitor.css';

interface StudioMonitorProps {
  children: ReactNode;
  playing: boolean;
  canPlay?: boolean;
  onPlayingChange: (playing: boolean) => void;
  time: number;
  duration: number;
  onSeek: (time: number) => void;
  onError: (message: string) => void;
}

/** Fullscreen includes its own accessible transport, not just the video pixels. */
export function StudioMonitor({ children, playing, canPlay = true, onPlayingChange, time, duration, onSeek, onError }: StudioMonitorProps) {
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setAvailable(typeof container.current?.requestFullscreen === 'function' && document.fullscreenEnabled !== false);
    let wasFullscreen = false;
    const sync = () => {
      const next = document.fullscreenElement === container.current;
      setFullscreen(next);
      if (wasFullscreen && !next) button.current?.focus();
      wasFullscreen = next;
    };
    document.addEventListener('fullscreenchange', sync);
    return () => {
      mounted.current = false;
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);

  useEffect(() => {
    // Electron does not consistently supply the browser's default Escape exit.
    // Scope this to our own fullscreen container so other overlays keep Escape.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement !== container.current) return;
      event.preventDefault();
      void document.exitFullscreen().catch(() => {
        if (mounted.current) onError('Could not exit fullscreen. Use the Exit fullscreen button to try again.');
      });
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onError]);

  const toggleFullscreen = async () => {
    const target = container.current;
    if (!target || pending) return;
    setPending(true);
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch {
      if (mounted.current) onError('Could not change fullscreen. Try again or continue in the timeline preview.');
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return (
    <div ref={container} className="ms-timeline-monitor ms-fullscreen-monitor" data-testid="studio-monitor">
      {children}
      <div className="ms-monitor-transport">
        {fullscreen && <>
          <button type="button" className="ms-btn" disabled={!canPlay} onClick={() => onPlayingChange(!playing)} aria-label={playing ? 'Pause timeline preview' : 'Play timeline preview'}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <input type="range" aria-label="Timeline fullscreen position" min={0} max={Math.max(0, duration)} step={0.01}
            value={Math.max(0, Math.min(time, duration))} onChange={event => onSeek(Number(event.target.value))} />
        </>}
        <button ref={button} type="button" className="ms-btn" disabled={!available || pending}
          title={available ? undefined : 'Fullscreen is unavailable in this window'}
          aria-label={fullscreen ? 'Exit timeline fullscreen' : 'Enter timeline fullscreen'}
          onClick={() => { void toggleFullscreen(); }}>
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  );
}
