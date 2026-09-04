/** @jest-environment jsdom */
/**
 * A job that reached a stage without the work being done.
 *
 * Reported from real use, on a job called "is there a god":
 *
 *   state: script draft
 *   [Record narration]  ->  "is there a god" has no script yet — run media_write_script first.
 *   [Write script]      ->  refused: scripting runs from idea, researching or needs_revision
 *
 * Wedged. Both ways out were closed.
 *
 * It gets there through the panel's generic "Move to …" button, which advances
 * the STATE and does none of the work. The stage action was then chosen from
 * the state alone, so it offered the step after the one that had never happened.
 *
 * The rule these pin: offer the action for what the job is MISSING.
 */

import { render, screen, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const base = {
  id: 'j1',
  title: 'is there a god',
  format: 'short' as const,
  createdAt: '2026-08-21T00:00:00Z',
  updatedAt: '2026-08-21T00:00:00Z',
  history: [],
};

afterEach(() => { delete (window as any).electron; });

const mount = async (job: any) => {
  (window as any).electron = { mediaList: jest.fn().mockResolvedValue([job]) };
  await act(async () => { render(<MediaStudioPanel />); });
};

test('script_draft with NO script offers Write script, not Record narration', async () => {
  await mount({ ...base, state: 'script_draft' });

  expect(screen.getByText('Write script')).toBeInTheDocument();
  expect(screen.queryByText('Record narration')).toBeNull();
});

test('script_draft WITH a script still offers Record narration', async () => {
  await mount({ ...base, state: 'script_draft', script: 'In the beginning...' });

  expect(screen.getByText('Record narration')).toBeInTheDocument();
  expect(screen.queryByText('Write script')).toBeNull();
});

test('script_qa with no script is the same story', async () => {
  await mount({ ...base, state: 'script_qa' });
  expect(screen.getByText('Write script')).toBeInTheDocument();
});

test('a whitespace-only script counts as no script', async () => {
  // The narrate tool tests `script?.trim()`, so the panel has to agree — or it
  // offers a button whose handler refuses.
  await mount({ ...base, state: 'script_draft', script: '   \n  ' });
  expect(screen.getByText('Write script')).toBeInTheDocument();
});

test('media_production without narration audio offers Record narration, not Make the video', async () => {
  // Same shape one stage later.
  await mount({ ...base, state: 'media_production', script: 'words' });

  expect(screen.getByText('Record narration')).toBeInTheDocument();
  expect(screen.queryByText('Make the video')).toBeNull();
});

test('media_production WITH narration offers Make the video', async () => {
  await mount({
    ...base,
    state: 'media_production',
    script: 'words',
    narrationPath: 'C:\\media\\j1\\narration.mp3',
  });

  expect(screen.getByText('Make the video')).toBeInTheDocument();
});
