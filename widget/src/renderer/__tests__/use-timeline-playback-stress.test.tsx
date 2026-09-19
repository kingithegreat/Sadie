/** @jest-environment jsdom */
/**
 * useTimelinePlayback stress tests.
 *
 * The hook is the clock for the timeline media player. jsdom cannot decode video, so
 * these tests drive the element the way a real decoder would: they set currentTime and
 * dispatch the events, and they make play() resolve or reject on demand. That is what
 * makes these stress tests meaningful — a real player's failures are promise rejections
 * and out-of-bounds clocks, not missing DOM.
 *
 * Each test names the invariant it is trying to break.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { useTimelinePlayback } from '../components/useTimelinePlayback';

interface HarnessProps {
  active?: boolean;
  source?: string;
  duration?: number;
  loop?: boolean;
  inPoint?: number | null;
  outPoint?: number | null;
  volume?: number;
  muted?: boolean;
  rate?: number;
}

function Harness(props: HarnessProps) {
  const [time, setTime] = useState(0);
  // A fresh source always starts paused — the hook's own mount effect enforces this,
  // so tests must press play rather than seeding playing=true (which the mount reset
  // would immediately collapse, making every transport assertion vacuous).
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const t = useTimelinePlayback({
    active: props.active ?? true,
    source: props.source ?? 'file:///mock/clip.mp4',
    playing,
    duration: props.duration ?? 30,
    loop: props.loop ?? false,
    inPoint: props.inPoint ?? null,
    outPoint: props.outPoint ?? null,
    volume: props.volume ?? 1,
    muted: props.muted ?? false,
    rate: props.rate ?? 1,
    onTime: setTime,
    onPlaying: setPlaying,
    onDuration: setDuration,
    onError: (m) => setErrors((e) => [...e, m]),
  });

  return (
    <div>
      <video
        data-testid="media"
        ref={t.events.ref}
        src={props.source ?? 'file:///mock/clip.mp4'}
        onLoadedMetadata={t.events.onLoadedMetadata}
        onTimeUpdate={t.events.onTimeUpdate}
        onEnded={t.events.onEnded}
        onPause={t.events.onPause}
        onError={t.events.onError}
      />
      <span data-testid="time">{time.toFixed(3)}</span>
      <span data-testid="playing">{String(playing)}</span>
      <span data-testid="duration">{duration === null ? 'null' : duration}</span>
      <span data-testid="errors">{errors.length}</span>
      <button data-testid="seek10" onClick={() => t.seek(10)}>s</button>
      <button data-testid="seekBeyond" onClick={() => t.seek(999)}>sb</button>
      <button data-testid="seekNeg" onClick={() => t.seek(-50)}>sn</button>
      <button data-testid="playToggle" onClick={() => setPlaying((p) => !p)}>p</button>
    </div>
  );
}

let playMock: jest.Mock;
let pauseMock: jest.Mock;
let loadMock: jest.Mock;

beforeEach(() => {
  playMock = jest.fn(async () => undefined);
  pauseMock = jest.fn(() => {});
  loadMock = jest.fn(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock);
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(loadMock);
  // jsdom reports duration NaN until metadata; simulate a real file by giving a value.
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get() { return (this as any).__dur ?? 30; },
    set(v) { (this as any).__dur = v; },
  });
  // jsdom's `ended` is a read-only getter, but the loop path keys off it, so make it
  // settable the same way.
  Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
    configurable: true,
    get() { return !!(this as any).__ended; },
    set(v) { (this as any).__ended = v; },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as any).electron;
});

/** Advance the fake decoder: set currentTime and emit timeupdate. */
function tick(el: HTMLMediaElement, to: number) {
  el.currentTime = to;
  el.dispatchEvent(new Event('timeupdate', { bubbles: true }));
}
/** Simulate the user pressing Play — the only legitimate way to start transport. */
async function pressPlay() {
  await act(async () => { fireEvent.click(screen.getByTestId('playToggle')); });
}
/** Simulate the browser's auto-pause that accompanies reaching the end. */
function endMedia(el: HTMLMediaElement, duration: number) {
  el.currentTime = duration;
  (el as any).ended = true;
  el.dispatchEvent(new Event('ended', { bubbles: true }));
  el.dispatchEvent(new Event('pause', { bubbles: true }));
}

describe('useTimelinePlayback — transport invariants', () => {
  test('playing out-of-bounds clamps to the in-point before play', async () => {
    render(<Harness inPoint={5} outPoint={15} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    el.currentTime = 20;
    await pressPlay();
    expect(playMock).toHaveBeenCalled();
    // The play effect seeks the decoder back inside the marked window.
    expect(el.currentTime).toBe(5);
  });

  test('reaching the out point stops at it and does not overshoot', async () => {
    render(<Harness inPoint={0} outPoint={10} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { tick(el, 9.9); });
    expect(Number(screen.getByTestId('time').textContent)).toBeCloseTo(9.9, 2);
    await act(async () => { tick(el, 10.5); });
    expect(pauseMock).toHaveBeenCalled();
    // Reported time must be the bound, not the raw decoder overshoot.
    expect(Number(screen.getByTestId('time').textContent)).toBe(10);
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  test('loop restarts from the in point, not from zero', async () => {
    render(<Harness loop inPoint={4} outPoint={8} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { endMedia(el, 8); });
    expect(el.currentTime).toBe(4);
    expect(playMock).toHaveBeenCalled();
    expect(Number(screen.getByTestId('time').textContent)).toBe(4);
  });

  test('loop with no in point restarts from zero', async () => {
    render(<Harness loop />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { endMedia(el, 30); });
    expect(el.currentTime).toBe(0);
    expect(playMock).toHaveBeenCalled();
  });

  test('a rejecting play() reports an error and leaves the transport stopped', async () => {
    playMock.mockRejectedValue(new Error('NotAllowedError'));
    render(<Harness />);
    await pressPlay();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('errors').textContent).toBe('1');
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  test('inactive workspace never calls play() and forces the transport off', async () => {
    render(<Harness active={false} />);
    await pressPlay();
    expect(playMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  test('seek is clamped to the known duration and never negative', async () => {
    render(<Harness duration={30} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { fireEvent.click(screen.getByTestId('seek10')); });
    expect(el.currentTime).toBe(10);
    await act(async () => { fireEvent.click(screen.getByTestId('seekBeyond')); });
    expect(el.currentTime).toBe(30);
    await act(async () => { fireEvent.click(screen.getByTestId('seekNeg')); });
    expect(el.currentTime).toBe(0);
  });
});

describe('useTimelinePlayback — source lifecycle', () => {
  test('changing source releases the old element (Windows file lock) and resets the clock', async () => {
    const { rerender } = render(<Harness source="file:///mock/a.mp4" />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    el.currentTime = 12;
    await act(async () => { tick(el, 12); });
    expect(Number(screen.getByTestId('time').textContent)).toBe(12);

    rerender(<Harness source="file:///mock/b.mp4" />);
    // The unmount cleanup of the keyed element: pause, src removed, load() called.
    expect(pauseMock).toHaveBeenCalled();
    expect(loadMock).toHaveBeenCalled();
    expect(screen.getByTestId('playing').textContent).toBe('false');
    expect(Number(screen.getByTestId('time').textContent)).toBe(0);
  });

  test('a media error with a src reports; clearing the src does not spam a phony error', async () => {
    const { rerender } = render(<Harness source="file:///mock/a.mp4" />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { el.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(screen.getByTestId('errors').textContent).toBe('1');

    rerender(<Harness source="" />);
    await act(async () => { el.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(screen.getByTestId('errors').textContent).toBe('1');
  });

  test('metadata load honours a seek requested before the duration was known', async () => {
    render(<Harness source="file:///mock/a.mp4" duration={30} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    // User scrubs before the decoder reports duration.
    await act(async () => { fireEvent.click(screen.getByTestId('seek10')); });
    expect(el.currentTime).toBe(10);
    await act(async () => {
      (el as any).__dur = 25;
      el.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    });
    // pendingSeek was 10, clamped to the real 25s duration.
    expect(el.currentTime).toBe(10);
  });

  test('volume, mute and rate reach the element', async () => {
    render(<Harness volume={0.5} muted rate={2} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { void Promise.resolve(); });
    expect(el.volume).toBe(0.5);
    expect(el.muted).toBe(true);
    expect(el.playbackRate).toBe(2);
  });

  test('volume above 1 or below 0 is clamped, never throwing', async () => {
    render(<Harness volume={5} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { void Promise.resolve(); });
    expect(el.volume).toBe(1);
  });

  test('changing in/out points mid-playback rebinds the loop window without a source change', async () => {
    const { rerender } = render(<Harness inPoint={2} outPoint={6} />);
    const el = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { tick(el, 3); });
    expect(Number(screen.getByTestId('time').textContent)).toBe(3);

    // Narrow the window so the current position is now outside it.
    rerender(<Harness inPoint={10} outPoint={14} />);
    await act(async () => { tick(el, 11); });
    expect(el.currentTime).toBe(11);
  });
});
