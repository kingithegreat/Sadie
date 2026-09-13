/** @jest-environment jsdom */
/**
 * The panel can finish the job.
 *
 * Script and narration always had buttons; rendering — the step that actually
 * produces the video — was reachable only by asking in chat. The panel walked
 * a video to media_production and then went quiet, which for a panel-first
 * user was a dead end at the last step.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const JOB = {
  id: 'j1',
  title: 'Recap: Why Attention Matters',
  format: 'short',
  state: 'media_production',
  // media_narrate writes narrationPath and THEN transitions to
  // media_production, so a real job in this state always has one. The fixture
  // omitted it, which stopped mattering once the panel began offering the
  // action for what a job is MISSING rather than for its state alone: without
  // narration it now offers "Record narration", because "Make the video" would
  // be refused by the render tool for exactly that reason.
  narrationPath: 'C:\\media\\j1\\narration.mp3',
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
  history: [],
};

afterEach(() => { delete (window as any).electron; });

test('a video in media_production offers "Make the video", wired to the render action', async () => {
  const mediaRun = jest.fn().mockResolvedValue({ ok: true, message: 'Rendered.' });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([JOB]),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });

  const btn = screen.getByText('Make the video');
  await act(async () => { fireEvent.click(btn); });

  expect(mediaRun).toHaveBeenCalledWith('j1', 'render', undefined);
});

test.each([
  { imagePath: 'C:\\media\\j1\\saved.png', visuals: 'scenes' },
  { imagePath: null, visuals: 'plain' },
])('saved inputs %j do not require an image generator', async renderInputs => {
  const mediaRun = jest.fn().mockResolvedValue({ ok: true, message: 'Rendered.' });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, renderInputs }]),
    sdCppStatus: jest.fn().mockResolvedValue({ ready: false }),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByText('Make the video')); });
  expect(mediaRun).toHaveBeenCalledWith('j1', 'render', undefined);
  expect(screen.queryByRole('dialog', { name: 'Choose where images are made' })).toBeNull();
});

test('a job that needs new scene images still asks about generator setup', async () => {
  const mediaRun = jest.fn();
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([JOB]),
    sdCppStatus: jest.fn().mockResolvedValue({ ready: false }),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByText('Make the video')); });
  expect(screen.getByRole('dialog', { name: 'Choose where images are made' })).toBeTruthy();
  expect(mediaRun).not.toHaveBeenCalled();
});

test('requested changes on a saved movie lead to its source, never a new script on the review', async () => {
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, state: 'needs_revision', reviewSource: { type: 'job', id: 'source' } }]),
  };
  await act(async () => { render(<MediaStudioPanel />); });
  expect(screen.getByRole('button', { name: 'Open source project' })).toBeTruthy();
  expect(screen.queryByText('Write script')).toBeNull();
  expect(screen.getByText(/Changes requested.*source project/)).toBeTruthy();
});
