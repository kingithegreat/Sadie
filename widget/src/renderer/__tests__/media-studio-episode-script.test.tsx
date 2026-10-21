/** @jest-environment jsdom */
/**
 * Media Studio "Generate episode script" step. The renderer only talks to the
 * preload bridge; these tests stub that bridge (no network, no keys).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaStudioEpisodeScript, SAMPLE_EPISODE_PREMISE } from '../components/MediaStudioEpisodeScript';

const script = {
  schemaVersion: 1, title: 'The Last Light', logline: 'l', genre: 'noir_thriller', totalDurationSec: 15,
  shots: [1, 2, 3].map(n => ({ shotId: `shot_00${n}`, order: n, title: `Shot ${n}`, prompt: `p${n}`, framing: 'wide', lens: '24mm', movement: 'static', durationSec: 5, narration: `line ${n}`, characters: [], beatType: 'action' })),
};

function setup(bridge: Record<string, jest.Mock>) {
  (window as any).electron = bridge;
  const onSaved = jest.fn();
  render(<MediaStudioEpisodeScript onClose={jest.fn()} onSaved={onSaved} />);
  return { onSaved };
}

afterEach(() => { delete (window as any).electron; });

test('premise → Generate → JSON shown → Load as storyboard hands the new project id back', async () => {
  const generate = jest.fn(async () => ({ ok: true, script }));
  const save = jest.fn(async () => ({ ok: true, projectId: 'the-last-light-ab12' }));
  const { onSaved } = setup({ mediaStoryboardGenerateScript: generate, mediaStoryboardSaveScript: save });
  fireEvent.change(screen.getByLabelText('Episode premise'), { target: { value: SAMPLE_EPISODE_PREMISE } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await screen.findByTestId('episode-script-result');
  expect(generate).toHaveBeenCalledWith({ premise: SAMPLE_EPISODE_PREMISE, shotCount: 4 });
  expect((screen.getByLabelText('Episode script JSON') as HTMLTextAreaElement).value).toContain('"title": "The Last Light"');
  expect(screen.getByText(/Shot 2 — line 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load as storyboard' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('the-last-light-ab12', script));
  expect(save).toHaveBeenCalledWith({ script, premise: SAMPLE_EPISODE_PREMISE });
});

test('a failed generation shows the main-process error and no result', async () => {
  setup({ mediaStoryboardGenerateScript: jest.fn(async () => ({ ok: false, code: 'BAD_JSON', error: 'The model did not return valid JSON.' })) });
  fireEvent.change(screen.getByLabelText('Episode premise'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect((await screen.findByRole('alert')).textContent).toContain('did not return valid JSON');
  expect(screen.queryByTestId('episode-script-result')).toBeNull();
});

test('Copy JSON writes the script to the clipboard', async () => {
  const writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  setup({ mediaStoryboardGenerateScript: jest.fn(async () => ({ ok: true, script })) });
  fireEvent.change(screen.getByLabelText('Episode premise'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await screen.findByTestId('episode-script-result');
  fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(script, null, 2)));
});
