/** @jest-environment jsdom */
/**
 * The last three dead ends in the Media Studio panel.
 *
 * All three are the same shape: the capability existed in the main process,
 * was exported and unit-tested, and no route the user could take reached it.
 *
 *   1. `renderPath` arrived over IPC and the panel dropped it, so the approval
 *      gate asked a person to approve a video with no way to watch it — while
 *      the render tool's own reply said "Watch it before approving".
 *   2. `markPublished` — the function that records the platform's id and makes
 *      publishing idempotent — had zero production callers. The only reachable
 *      route was a plain transition to `published`, which set the state, set no
 *      id, and uploaded nothing. That is exactly the "looks published and is
 *      not" case media-studio.ts warns about in its own comment.
 *   3. `media_delete_job` was chat-only, so the queue could only grow and
 *      renders accumulated on disk with nothing in the UI to clear them.
 *
 * These assert the effect — which IPC ran, with what — rather than that a
 * button exists.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const base = {
  id: 'j1',
  title: 'Recap: Why Attention Matters',
  format: 'short' as const,
  createdAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:00Z',
  history: [],
};

afterEach(() => { delete (window as any).electron; });

const mount = async (job: any, api: Record<string, any> = {}) => {
  const mediaList = jest.fn().mockResolvedValue([job]);
  (window as any).electron = { mediaList, ...api };
  await act(async () => { render(<MediaStudioPanel />); });
};

test('a rendered video can be watched at the gate that approves it', async () => {
  await mount({ ...base, state: 'awaiting_approval', renderPath: 'C:\\media\\j1\\video.mp4' });

  const video = screen.getByTestId('ms-video-j1') as HTMLVideoElement;
  // Backslashes have to become forward slashes or the file:// URL is invalid
  // and the player silently shows nothing.
  expect(video.getAttribute('src')).toBe('file:///C:/media/j1/video.mp4');

  // The point of showing it: this is the same row that approves it.
  expect(screen.getByText('Approve')).toBeTruthy();
});

test('before a render exists the narration is still playable', async () => {
  await mount({ ...base, state: 'script_qa', narrationPath: 'C:\\media\\j1\\narration.mp3' });

  expect(screen.queryByTestId('ms-video-j1')).toBeNull();
  expect(document.querySelector('audio')?.getAttribute('src'))
    .toBe('file:///C:/media/j1/narration.mp3');
});

test('a scheduled video offers no way to be marked published without an id', async () => {
  await mount({ ...base, state: 'scheduled' });

  // The old generic mover. It set state to `published` with no id, so nothing
  // distinguished a job that went out from one that never did.
  expect(screen.queryByText('Move to published')).toBeNull();
  expect(screen.getByText('Mark as published…')).toBeTruthy();
});

test('marking published records the link the user pastes back', async () => {
  const mediaMarkPublished = jest.fn().mockResolvedValue({ ok: true, job: {} });
  await mount({ ...base, state: 'scheduled' }, { mediaMarkPublished });

  await act(async () => { fireEvent.click(screen.getByText('Mark as published…')); });

  const input = screen.getByLabelText(`Link or video id for ${base.title}`);
  await act(async () => {
    fireEvent.change(input, { target: { value: 'https://youtu.be/abc123' } });
  });
  await act(async () => { fireEvent.click(screen.getByText('Save')); });

  expect(mediaMarkPublished).toHaveBeenCalledWith('j1', 'https://youtu.be/abc123');
});

test('an empty link cannot be saved', async () => {
  const mediaMarkPublished = jest.fn();
  await mount({ ...base, state: 'approved' }, { mediaMarkPublished });

  await act(async () => { fireEvent.click(screen.getByText('Mark as published…')); });
  await act(async () => { fireEvent.click(screen.getByText('Save')); });

  expect(mediaMarkPublished).not.toHaveBeenCalled();
});

test('a published video shows the id it went out as', async () => {
  await mount({ ...base, state: 'published', videoId: 'https://youtu.be/abc123' });
  expect(screen.getByText(/Published as https:\/\/youtu\.be\/abc123/)).toBeTruthy();
});

test('deleting asks first, and only then removes the video and its files', async () => {
  const mediaDelete = jest.fn().mockResolvedValue({ ok: true, message: 'Deleted.' });
  await mount({ ...base, state: 'media_production' }, { mediaDelete });

  await act(async () => {
    fireEvent.click(screen.getByLabelText(`Delete ${base.title}`));
  });
  // Nothing happens on the first click — the dialog is the whole point.
  expect(mediaDelete).not.toHaveBeenCalled();

  await act(async () => { fireEvent.click(screen.getByText('Delete it')); });
  expect(mediaDelete).toHaveBeenCalledWith('j1');
});

test('cancelling the delete leaves the video alone', async () => {
  const mediaDelete = jest.fn();
  await mount({ ...base, state: 'media_production' }, { mediaDelete });

  await act(async () => {
    fireEvent.click(screen.getByLabelText(`Delete ${base.title}`));
  });
  await act(async () => { fireEvent.click(screen.getByText('Cancel')); });

  expect(mediaDelete).not.toHaveBeenCalled();
});
