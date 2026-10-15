/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAnimaticPlayback } from '../components/useAnimaticPlayback';
import { acquireStudioPlayback, releaseStudioPlayback } from '../components/studioPlaybackCoordinator';

type Options = Parameters<typeof useAnimaticPlayback>[0];
let player: ReturnType<typeof useAnimaticPlayback>;
function Harness(props: Options) {
  player = useAnimaticPlayback(props);
  return <audio key={player.audioUrl || 'empty'} data-testid="audio" src={player.audioUrl || undefined} {...player.events} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const silent = [{ shotId: 'a', durationSec: 5 }, { shotId: 'b', durationSec: 3 }];
const narrated = [{ ...silent[0], narration: 'Hello' }, silent[1]];
const foreignOwner = {};
let defaults: Options;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function metadata(duration = 3) {
  const audio = screen.getByTestId('audio') as HTMLAudioElement;
  Object.defineProperty(audio, 'duration', { configurable: true, value: duration });
  fireEvent.loadedMetadata(audio);
  return audio;
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  defaults = { active: true, sceneKey: 'scene', shots: narrated, loop: false, loadAudio: jest.fn().mockResolvedValue('file:///speech.wav'), onError: jest.fn() };
});
afterEach(() => {
  cleanup();
  releaseStudioPlayback(foreignOwner);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('picture waits for narration loading and follows decoder time, including a stalled decoder', async () => {
  const speech = deferred<string>();
  render(<Harness {...defaults} loadAudio={() => speech.promise} />);
  act(() => player.setPlaying(true));
  act(() => jest.advanceTimersByTime(6000));
  expect(player.index).toBe(0);
  expect(player.elapsed).toBe(0);
  await act(async () => { speech.resolve('file:///speech.wav'); });
  const audio = metadata(8);
  audio.currentTime = 1.25;
  fireEvent.timeUpdate(audio);
  expect(player.elapsed).toBe(1.25);
  act(() => jest.advanceTimersByTime(4000));
  expect(player.elapsed).toBe(1.25);
  expect(player.index).toBe(0);
});

test('pause/resume preserves decoder and picture position; same-shot scrub seeks the decoder', async () => {
  render(<Harness {...defaults} />);
  await flush();
  const audio = metadata(8);
  act(() => player.setPlaying(true));
  audio.currentTime = 1.5;
  fireEvent.timeUpdate(audio);
  act(() => player.setPlaying(false));
  act(() => jest.advanceTimersByTime(2000));
  expect(audio.currentTime).toBe(1.5);
  expect(player.elapsed).toBe(1.5);
  act(() => player.setPlaying(true));
  expect(audio.currentTime).toBe(1.5);
  act(() => player.seek(2.25));
  expect(audio.currentTime).toBe(2.25);
  expect(player.elapsed).toBe(2.25);
});

test('seek while loading applies the latest offset once metadata arrives', async () => {
  const speech = deferred<string>();
  render(<Harness {...defaults} loadAudio={() => speech.promise} />);
  act(() => player.seek(2));
  await act(async () => { speech.resolve('file:///speech.wav'); });
  const audio = metadata(8);
  expect(audio.currentTime).toBe(2);
  expect(player.elapsed).toBe(2);
});

test('stale narration cannot replace a later shot or resurrect closed playback', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const loadAudio = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const options = { ...defaults, shots: [narrated[0], { ...silent[1], narration: 'Second' }], loadAudio };
  const view = render(<Harness {...options} />);
  act(() => player.goTo(1));
  await act(async () => { second.resolve('file:///second.wav'); });
  expect(player.audioUrl).toBe('file:///second.wav');
  await act(async () => { first.resolve('file:///first.wav'); });
  expect(player.audioUrl).toBe('file:///second.wav');
  act(() => player.setPlaying(true));
  view.rerender(<Harness {...options} active={false} />);
  expect(player.audioUrl).toBe('');
  expect(player.playing).toBe(false);
});

test('short narration holds the shot silently; long narration is cut at the planned boundary', async () => {
  const view = render(<Harness {...defaults} />);
  await flush();
  const audio = metadata(2);
  act(() => player.setPlaying(true));
  audio.currentTime = 2;
  Object.defineProperty(audio, 'ended', { configurable: true, value: true });
  fireEvent.ended(audio);
  act(() => jest.advanceTimersByTime(2900));
  expect(player.index).toBe(0);
  act(() => jest.advanceTimersByTime(150));
  expect(player.index).toBe(1);
  view.unmount();
  render(<Harness {...defaults} />);
  await flush();
  const longAudio = metadata(9);
  act(() => player.setPlaying(true));
  longAudio.currentTime = 5;
  fireEvent.timeUpdate(longAudio);
  expect(player.index).toBe(1);
  expect(longAudio.pause).toHaveBeenCalled();
});

test('silent clock pauses and stops on coordinator takeover, and exact-end seek reaches the end', () => {
  render(<Harness {...defaults} shots={silent} />);
  act(() => player.setPlaying(true));
  act(() => jest.advanceTimersByTime(1250));
  expect(player.elapsed).toBeCloseTo(1.25);
  act(() => acquireStudioPlayback(foreignOwner, jest.fn()));
  expect(player.playing).toBe(false);
  const stopped = player.elapsed;
  act(() => jest.advanceTimersByTime(4000));
  expect(player.elapsed).toBe(stopped);
  act(() => player.seek(8));
  expect(player.index).toBe(1);
  expect(player.elapsed).toBe(3);
  expect(player.playing).toBe(false);
  act(() => player.setPlaying(true));
  expect(player.index).toBe(0);
  expect(player.elapsed).toBe(0);
});

test('silent single-shot loop restarts and navigation clamps at sequence boundaries', () => {
  render(<Harness {...defaults} shots={[silent[0]]} loop />);
  act(() => player.setPlaying(true));
  act(() => jest.advanceTimersByTime(5050));
  expect(player.index).toBe(0);
  // The loop retains the small overflow past five seconds.
  expect(player.elapsed).toBeGreaterThanOrEqual(0);
  expect(player.elapsed).toBeLessThan(0.1);
  expect(player.playing).toBe(true);
  act(() => player.goTo(999));
  expect(player.index).toBe(0);
  act(() => player.seek(-2));
  expect(player.elapsed).toBe(0);
});

test('generation and decoder failures stop playback, explain recovery, and retry generates again', async () => {
  const loadAudio = jest.fn().mockRejectedValueOnce(new Error('tts failed')).mockResolvedValue('file:///retry.wav');
  render(<Harness {...defaults} loadAudio={loadAudio} />);
  act(() => player.setPlaying(true));
  await flush();
  expect(player.playing).toBe(false);
  expect(player.error).toMatch(/Retry narration/);
  act(() => player.retry());
  await flush();
  expect(loadAudio).toHaveBeenCalledTimes(2);
  metadata();
  act(() => player.setPlaying(true));
  fireEvent.error(screen.getByTestId('audio'));
  expect(player.playing).toBe(false);
  expect(defaults.onError).toHaveBeenCalledTimes(2);
});

test('opening can request play before active is updated; closing cancels loading completion', async () => {
  const speech = deferred<string>();
  const options = { ...defaults, loadAudio: () => speech.promise };
  const view = render(<Harness {...options} active={false} />);
  act(() => { player.goTo(0); player.setPlaying(true); });
  view.rerender(<Harness {...options} />);
  expect(player.playing).toBe(true);
  view.rerender(<Harness {...options} active={false} />);
  await act(async () => { speech.resolve('file:///late.wav'); });
  expect(player.audioUrl).toBe('');
  expect(player.playing).toBe(false);
});

test('a play promise rejected after pause does not overwrite a later successful resume', async () => {
  const oldPlay = deferred<void>();
  render(<Harness {...defaults} />);
  await flush();
  metadata(9);
  (HTMLMediaElement.prototype.play as jest.Mock).mockReturnValueOnce(oldPlay.promise);
  act(() => player.setPlaying(true));
  act(() => player.setPlaying(false));
  act(() => player.setPlaying(true));
  await act(async () => { oldPlay.reject(new Error('interrupted')); });
  expect(player.playing).toBe(true);
  expect(defaults.onError).not.toHaveBeenCalled();
});

test('switching scene from a later shot requests only the new first narration', async () => {
  const loadAudio = jest.fn().mockResolvedValue('file:///speech.wav');
  const first = { ...defaults, shots: [narrated[0], { ...silent[1], narration: 'Old second' }], loadAudio };
  const view = render(<Harness {...first} />);
  await flush();
  act(() => player.goTo(1));
  await flush();
  loadAudio.mockClear();
  view.rerender(<Harness {...first} sceneKey="new" shots={[
    { ...narrated[0], narration: 'New first' }, { ...silent[1], narration: 'New second' },
  ]} />);
  await flush();
  expect(player.index).toBe(0);
  expect(loadAudio.mock.calls).toEqual([['New first']]);
});

test('an ended event queued before seeking cannot switch resumed narration to a simulated clock', async () => {
  render(<Harness {...defaults} />);
  await flush();
  const audio = metadata(4);
  act(() => player.setPlaying(true));
  audio.currentTime = 4;
  Object.defineProperty(audio, 'ended', { configurable: true, value: true });
  act(() => player.seek(1));
  // A real seek clears the decoder's ended flag before its earlier queued event.
  Object.defineProperty(audio, 'ended', { configurable: true, value: false });
  fireEvent.ended(audio);
  act(() => jest.advanceTimersByTime(1000));
  expect(player.elapsed).toBe(1);
  expect(player.index).toBe(0);
});

test('a delayed silent tick carries elapsed time across shots and ends at the planned total', () => {
  let now = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  render(<Harness {...defaults} shots={silent} />);
  act(() => player.setPlaying(true));
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  now = 6200;
  act(() => jest.advanceTimersByTime(50));
  expect(player.index).toBe(1);
  expect(player.elapsed).toBeCloseTo(1.2);
  now = 8000;
  act(() => jest.advanceTimersByTime(50));
  expect(player.index).toBe(1);
  expect(player.elapsed).toBe(3);
  expect(player.playing).toBe(false);
});

test('a long delayed silent loop skips whole cycles without stretching the cut', () => {
  let now = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  render(<Harness {...defaults} shots={silent} loop />);
  act(() => player.setPlaying(true));
  now = 1_001_250;
  act(() => jest.advanceTimersByTime(50));
  expect(player.index).toBe(0);
  expect(player.elapsed).toBeCloseTo(1.25);
  expect(player.playing).toBe(true);
  now += 50;
  act(() => jest.advanceTimersByTime(50));
  expect(player.elapsed).toBeCloseTo(1.3);
});

test('silent overflow stops at a narrated shot and waits without skipping its narration', () => {
  let now = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  const speech = deferred<string>();
  const loadAudio = jest.fn().mockReturnValue(speech.promise);
  render(<Harness {...defaults} shots={[silent[0], { ...silent[1], narration: 'Wait for this voice' }]} loadAudio={loadAudio} loop />);
  act(() => player.setPlaying(true));
  now = 60_000;
  act(() => jest.advanceTimersByTime(50));
  expect(player.index).toBe(1);
  expect(player.elapsed).toBe(0);
  expect(player.loading).toBe(true);
  expect(loadAudio).toHaveBeenCalledWith('Wait for this voice');
  now += 30_000;
  act(() => jest.advanceTimersByTime(50));
  expect(player.index).toBe(1);
  expect(player.elapsed).toBe(0);
});

test('silent play and seeking never ask an empty audio element to decode', () => {
  render(<Harness {...defaults} shots={silent} />);
  act(() => player.setPlaying(true));
  act(() => player.seek(2));
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(player.playing).toBe(true);
  act(() => jest.advanceTimersByTime(100));
  expect(player.elapsed).toBeCloseTo(2.1);
});
