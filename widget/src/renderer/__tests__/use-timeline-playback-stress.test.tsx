/** @jest-environment jsdom */
/**
 * useTimelinePlayback stress tests.
 *
 * jsdom cannot decode video or observe Windows file handles. These tests simulate the
 * decoder clock and verify the hook's transport state plus its DOM cleanup sequence.
 * Real encoded-video playback and OS-level handle release remain separate acceptance.
 */

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useCallback, useState } from 'react';
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
  const source = props.source ?? 'file:///mock/clip.mp4';
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const recordError = useCallback((message: string) => {
    setErrors((current) => [...current, message]);
  }, []);

  const timeline = useTimelinePlayback({
    active: props.active ?? true,
    source,
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
    onError: recordError,
  });

  return (
    <div>
      <video
        key={source}
        data-testid="media"
        ref={timeline.events.ref}
        src={source}
        onLoadedMetadata={timeline.events.onLoadedMetadata}
        onTimeUpdate={timeline.events.onTimeUpdate}
        onEnded={timeline.events.onEnded}
        onPause={timeline.events.onPause}
        onError={timeline.events.onError}
      />
      <span data-testid="time">{time.toFixed(3)}</span>
      <span data-testid="playing">{String(playing)}</span>
      <span data-testid="duration">{duration === null ? 'null' : duration}</span>
      <span data-testid="errors">{errors.length}</span>
      <button data-testid="seek10" onClick={() => timeline.seek(10)}>s</button>
      <button data-testid="seekBeyond" onClick={() => timeline.seek(999)}>sb</button>
      <button data-testid="seekNeg" onClick={() => timeline.seek(-50)}>sn</button>
      <button data-testid="playToggle" onClick={() => setPlaying((current) => !current)}>p</button>
    </div>
  );
}

let playMock: jest.Mock;
let pauseMock: jest.Mock;
let loadMock: jest.Mock;
const originalDurationDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
const originalEndedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'ended');

beforeEach(() => {
  playMock = jest.fn(async () => undefined);
  pauseMock = jest.fn(() => {});
  loadMock = jest.fn(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock);
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(loadMock);
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get() { return (this as any).__dur ?? 30; },
    set(value) { (this as any).__dur = value; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
    configurable: true,
    get() { return Boolean((this as any).__ended); },
    set(value) { (this as any).__ended = value; },
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (originalDurationDescriptor) {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', originalDurationDescriptor);
  } else {
    delete (HTMLMediaElement.prototype as any).duration;
  }
  if (originalEndedDescriptor) {
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', originalEndedDescriptor);
  } else {
    delete (HTMLMediaElement.prototype as any).ended;
  }
  delete (window as any).electron;
});

function tick(element: HTMLMediaElement, time: number) {
  element.currentTime = time;
  element.dispatchEvent(new Event('timeupdate', { bubbles: true }));
}

async function pressPlay() {
  await act(async () => { fireEvent.click(screen.getByTestId('playToggle')); });
}

function endMedia(element: HTMLMediaElement, duration: number) {
  element.currentTime = duration;
  (element as any).ended = true;
  element.dispatchEvent(new Event('ended', { bubbles: true }));
  element.dispatchEvent(new Event('pause', { bubbles: true }));
}

describe('useTimelinePlayback — transport invariants', () => {
  test('playing out-of-bounds clamps to the in-point before play', async () => {
    render(<Harness inPoint={5} outPoint={15} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    element.currentTime = 20;
    await pressPlay();
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(element.currentTime).toBe(5);
  });

  test('reaching the out point stops at it and does not overshoot', async () => {
    render(<Harness inPoint={0} outPoint={10} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { tick(element, 9.9); });
    expect(Number(screen.getByTestId('time').textContent)).toBeCloseTo(9.9, 2);
    await act(async () => { tick(element, 10.5); });
    expect(pauseMock).toHaveBeenCalled();
    expect(element.currentTime).toBe(10);
    expect(Number(screen.getByTestId('time').textContent)).toBe(10);
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  test('loop restarts from the in point and issues an additional play', async () => {
    render(<Harness loop inPoint={4} outPoint={8} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    playMock.mockClear();

    await act(async () => { endMedia(element, 8); });

    expect(element.currentTime).toBe(4);
    expect(Number(screen.getByTestId('time').textContent)).toBe(4);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock.mock.instances[0]).toBe(element);
  });

  test('loop with no in point restarts from zero and issues an additional play', async () => {
    render(<Harness loop />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    playMock.mockClear();

    await act(async () => { endMedia(element, 30); });

    expect(element.currentTime).toBe(0);
    expect(Number(screen.getByTestId('time').textContent)).toBe(0);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock.mock.instances[0]).toBe(element);
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
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { fireEvent.click(screen.getByTestId('seek10')); });
    expect(element.currentTime).toBe(10);
    await act(async () => { fireEvent.click(screen.getByTestId('seekBeyond')); });
    expect(element.currentTime).toBe(30);
    await act(async () => { fireEvent.click(screen.getByTestId('seekNeg')); });
    expect(element.currentTime).toBe(0);
  });
});

describe('useTimelinePlayback — source lifecycle', () => {
  test('changing source cleans the replaced element and resets the clock', async () => {
    const { rerender } = render(<Harness source="file:///mock/a.mp4" />);
    const oldElement = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { tick(oldElement, 12); });
    expect(Number(screen.getByTestId('time').textContent)).toBe(12);
    pauseMock.mockClear();
    loadMock.mockClear();

    await act(async () => { rerender(<Harness source="file:///mock/b.mp4" />); });

    const replacement = screen.getByTestId('media') as HTMLMediaElement;
    expect(replacement).not.toBe(oldElement);
    expect(oldElement.getAttribute('src')).toBeNull();
    expect(replacement.getAttribute('src')).toBe('file:///mock/b.mp4');
    expect(pauseMock).toHaveBeenCalled();
    expect(pauseMock.mock.instances).toContain(oldElement);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock.mock.instances[0]).toBe(oldElement);
    expect(screen.getByTestId('playing').textContent).toBe('false');
    expect(Number(screen.getByTestId('time').textContent)).toBe(0);
  });

  test('a media error with a src reports; clearing the src does not add a phony error', async () => {
    const { rerender } = render(<Harness source="file:///mock/a.mp4" />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { element.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(screen.getByTestId('errors').textContent).toBe('1');

    rerender(<Harness source="" />);
    const emptyElement = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { emptyElement.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(screen.getByTestId('errors').textContent).toBe('1');
  });

  test('metadata load honours a seek requested before the duration was known', async () => {
    render(<Harness source="file:///mock/a.mp4" duration={30} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { fireEvent.click(screen.getByTestId('seek10')); });
    expect(element.currentTime).toBe(10);
    await act(async () => {
      (element as any).__dur = 25;
      element.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    });
    expect(element.currentTime).toBe(10);
    expect(screen.getByTestId('duration').textContent).toBe('25');
  });

  test('volume, mute and rate reach the element', async () => {
    render(<Harness volume={0.5} muted rate={2} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { await Promise.resolve(); });
    expect(element.volume).toBe(0.5);
    expect(element.muted).toBe(true);
    expect(element.playbackRate).toBe(2);
  });

  test.each([
    ['below zero', -5, 0],
    ['above one', 5, 1],
  ])('volume %s is clamped without throwing', async (_label, supplied, expected) => {
    render(<Harness volume={supplied} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await act(async () => { await Promise.resolve(); });
    expect(element.volume).toBe(expected);
  });

  test('changing bounds mid-playback enforces the new out point', async () => {
    const { rerender } = render(<Harness inPoint={2} outPoint={6} />);
    const element = screen.getByTestId('media') as HTMLMediaElement;
    await pressPlay();
    await act(async () => { tick(element, 3); });
    expect(Number(screen.getByTestId('time').textContent)).toBe(3);

    rerender(<Harness inPoint={10} outPoint={12} />);
    await act(async () => { tick(element, 11); });
    expect(Number(screen.getByTestId('time').textContent)).toBe(11);
    pauseMock.mockClear();

    await act(async () => { tick(element, 12.5); });

    expect(pauseMock).toHaveBeenCalled();
    expect(element.currentTime).toBe(12);
    expect(Number(screen.getByTestId('time').textContent)).toBe(12);
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });
});
