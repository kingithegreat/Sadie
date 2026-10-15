/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioMedia } from '../components/StudioMedia';
import { acquireStudioPlayback, releaseStudioPlayback } from '../components/studioPlaybackCoordinator';

function nativePlay(media: HTMLElement) {
  Object.defineProperty(media, 'paused', { configurable: true, value: false });
  fireEvent.play(media);
}
function nativePause(this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { configurable: true, value: true });
}
beforeEach(() => {
  localStorage.clear();
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(nativePause);
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('native playback stops the previous logical transport and switching native players pauses the first', () => {
  const virtual = {};
  const stop = jest.fn();
  acquireStudioPlayback(virtual, stop);
  render(<><StudioMedia kind="video" src="one.mp4" label="First" />
    <StudioMedia kind="audio" src="two.mp3" label="Second" /></>);
  const first = screen.getByLabelText('First') as HTMLMediaElement;
  const second = screen.getByLabelText('Second') as HTMLMediaElement;
  first.pause = jest.fn(nativePause);
  second.pause = jest.fn(nativePause);
  nativePlay(first);
  expect(stop).toHaveBeenCalledTimes(1);
  const paused = jest.spyOn(first, 'pause');
  nativePlay(second);
  expect(paused).toHaveBeenCalledTimes(1);
  // A delayed pause event from the displaced player cannot release the new owner.
  fireEvent.pause(first);
  const pauseSecond = jest.spyOn(second, 'pause');
  acquireStudioPlayback(virtual, stop);
  expect(pauseSecond).toHaveBeenCalledTimes(1);
  releaseStudioPlayback(virtual);
});

test('inactive preview does not mount a decoder; explicit selection opens it', () => {
  const select = jest.fn();
  const view = render(<StudioMedia kind="video" src="large.mp4" label="Job preview" active={false} onActivate={select} />);
  expect(view.container.querySelector('video')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Job preview' }));
  expect(select).toHaveBeenCalledTimes(1);
  view.rerender(<StudioMedia kind="video" src="large.mp4" label="Job preview" active />);
  expect(screen.getByLabelText('Job preview')).toHaveAttribute('preload', 'metadata');
});

test('a delayed pause event cannot relinquish a resumed player', () => {
  const outsider = {};
  const stop = jest.fn();
  render(<StudioMedia kind="video" src="one.mp4" label="First" />);
  const media = screen.getByLabelText('First') as HTMLMediaElement;
  Object.defineProperty(media, 'paused', { configurable: true, value: false });
  nativePlay(media);
  acquireStudioPlayback(outsider, stop);
  nativePlay(media);
  fireEvent.pause(media); // old decoder event arrives after play has resumed
  const paused = jest.spyOn(media, 'pause');
  paused.mockClear();
  acquireStudioPlayback(outsider, stop);
  expect(paused).toHaveBeenCalledTimes(1);
  releaseStudioPlayback(outsider);
});

test('a delayed ended event cannot release playback after seeking and resuming', () => {
  const outsider = {};
  render(<StudioMedia kind="video" src="one.mp4" label="First" />);
  const media = screen.getByLabelText('First') as HTMLMediaElement;
  nativePlay(media);
  Object.defineProperty(media, 'ended', { configurable: true, value: false });
  fireEvent.ended(media); // queued end event from before the user's seek
  const paused = jest.spyOn(media, 'pause');
  acquireStudioPlayback(outsider, jest.fn());
  expect(paused).toHaveBeenCalledTimes(1);
  releaseStudioPlayback(outsider);
});

test('a delayed play event from a paused decoder cannot displace its replacement', () => {
  const outsider = {};
  const next = {};
  const stop = jest.fn();
  render(<StudioMedia kind="video" src="one.mp4" label="First" />);
  const media = screen.getByLabelText('First') as HTMLMediaElement;
  nativePlay(media);
  acquireStudioPlayback(outsider, stop);
  expect(media.paused).toBe(true);
  fireEvent.play(media); // queued play event arrives after coordinator paused it
  expect(stop).not.toHaveBeenCalled();
  acquireStudioPlayback(next, jest.fn());
  expect(stop).toHaveBeenCalledTimes(1);
  releaseStudioPlayback(next);
});

test('broken media has actionable feedback and retry replaces the decoder without autoplay', () => {
  const reveal = jest.fn();
  render(<StudioMedia kind="audio" src="missing.mp3" label="Voice sample" reveal={reveal} />);
  const original = screen.getByLabelText('Voice sample');
  expect(original).not.toHaveAttribute('autoplay');
  fireEvent.error(original);
  expect(screen.getByRole('alert')).toHaveTextContent('Voice sample could not play');
  fireEvent.click(screen.getByRole('button', { name: 'Open file location' }));
  expect(reveal).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry playback' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('Voice sample')).not.toBe(original);
});

test('resume restores volume and position for the same job output but not a replaced output', () => {
  const props = { kind: 'video' as const, src: 'job.mp4', label: 'Job', persistence: { jobId: 'job', revision: 'one' } };
  let view = render(<StudioMedia {...props} />);
  let media = screen.getByLabelText('Job') as HTMLMediaElement;
  Object.defineProperty(media, 'duration', { configurable: true, value: 30 });
  fireEvent.loadedMetadata(media);
  media.currentTime = 12;
  media.volume = 0.3;
  fireEvent.pause(media);
  view.unmount();
  view = render(<StudioMedia {...props} />);
  media = screen.getByLabelText('Job') as HTMLMediaElement;
  Object.defineProperty(media, 'duration', { configurable: true, value: 30 });
  fireEvent.loadedMetadata(media);
  expect(media.currentTime).toBe(12);
  expect(media.volume).toBe(0.3);
  view.rerender(<StudioMedia {...props} persistence={{ jobId: 'job', revision: 'replacement' }} />);
  media = screen.getByLabelText('Job') as HTMLMediaElement;
  Object.defineProperty(media, 'duration', { configurable: true, value: 30 });
  fireEvent.loadedMetadata(media);
  expect(media.currentTime).toBe(0);
});

test('storage failures do not prevent playback, and saved job history is bounded', () => {
  const existing = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), {
    source: 'old', volume: 1, muted: false, time: 0, savedAt: i,
  }]));
  localStorage.setItem('homebot.studio.playback.v1', JSON.stringify(existing));
  render(<StudioMedia kind="audio" src="job.mp3" label="Job" persistence={{ jobId: 'new', revision: 'one' }} />);
  const media = screen.getByLabelText('Job');
  fireEvent.loadedMetadata(media);
  fireEvent.pause(media);
  expect(Object.keys(JSON.parse(localStorage.getItem('homebot.studio.playback.v1')!))).toHaveLength(30);
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(() => { fireEvent.volumeChange(media); nativePlay(media); }).not.toThrow();
});

test('unmount releases media source and relinquishes ownership', () => {
  const view = render(<StudioMedia kind="video" src="job.mp4" label="Job" />);
  const media = screen.getByLabelText('Job');
  nativePlay(media);
  view.unmount();
  expect(media).not.toHaveAttribute('src');
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
});
