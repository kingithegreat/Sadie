/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MediaStudioPanel, studioPlaybackRevision } from '../components/MediaStudioPanel';

const base = { id: 'first', title: 'First movie', state: 'awaiting_approval', format: 'short',
  createdAt: '2026-10-01', updatedAt: '2026-10-01', history: [], renderPath: 'C:\\media\\first.mp4' };
function nativePlay(media: HTMLElement) {
  Object.defineProperty(media, 'paused', { configurable: true, value: false });
  fireEvent.play(media);
}
beforeEach(() => {
  localStorage.clear();
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); delete (window as any).electron; });

test('job selection mounts only that preview, and its failure exposes recovery', async () => {
  const showInFolder = jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = { showInFolder, mediaList: jest.fn().mockResolvedValue([
    base, { ...base, id: 'second', title: 'Second movie', renderPath: 'C:\\media\\second.mp4' },
  ]) };
  await act(async () => { render(<MediaStudioPanel />); });
  const first = screen.getByTestId('ms-video-first');
  expect(first).toHaveAccessibleName('Movie preview: First movie');
  expect(screen.queryByTestId('ms-video-second')).toBeNull();
  nativePlay(first);
  fireEvent.click(screen.getByRole('button', { name: 'Open Movie preview: Second movie' }));
  expect(screen.queryByTestId('ms-video-first')).toBeNull();
  expect(first).not.toHaveAttribute('src');
  const second = screen.getByTestId('ms-video-second');
  expect(second).toHaveAttribute('src', 'file:///C:/media/second.mp4');
  fireEvent.error(second);
  expect(screen.getByRole('alert')).toHaveTextContent('Movie preview: Second movie could not play');
  fireEvent.click(screen.getByRole('button', { name: 'Retry playback' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('voice samples require Play, coordinate with the job, and never autoplay after workspace remount', async () => {
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([base,
      { ...base, id: 'draft', title: 'Draft', state: 'script_qa', script: 'A short script', renderPath: undefined }]),
    ttsSampleVoice: jest.fn().mockResolvedValue({ success: true, path: 'C:\\media\\voice.mp3' }),
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Sample$/ })); });
  const voice = screen.getByTestId('ms-voice-sample');
  expect(voice).not.toHaveAttribute('autoplay');
  expect(screen.getByText('Voice sample ready. Press Play to listen.')).toBeVisible();
  const movie = screen.getByTestId('ms-video-first') as HTMLMediaElement;
  nativePlay(movie);
  const pauseMovie = jest.spyOn(movie, 'pause');
  nativePlay(voice);
  expect(pauseMovie).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab', { name: /Timeline/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
  expect(screen.getByTestId('ms-voice-sample')).not.toHaveAttribute('autoplay');
});

test('approval metadata preserves resume identity; a new generation at the same path invalidates it', () => {
  expect(studioPlaybackRevision({ createdAt: 'legacy-created' } as any, 'video')).toBe('legacy-created');
  const job = { ...base, history: [{ at: 'generation-1', from: 'media_production' as const,
    to: 'render_qa' as const, by: 'render stage' }] };
  expect(studioPlaybackRevision(job, 'video')).toBe('generation-1');
  expect(studioPlaybackRevision({ ...job, history: [...job.history, { at: 'approved',
    from: 'awaiting_approval' as const, to: 'approved' as const, by: 'human' }] }, 'video')).toBe('generation-1');
  expect(studioPlaybackRevision({ ...job, history: [...job.history,
    { ...job.history[0], at: 'generation-2' }] }, 'video')).toBe('generation-2');
});
