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

  expect(mediaRun).toHaveBeenCalledWith('j1', 'render');
});
