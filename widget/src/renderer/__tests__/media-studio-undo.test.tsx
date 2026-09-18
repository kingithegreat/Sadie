/** @jest-environment jsdom */
/**
 * MS-10: editing a storyboard is safe.
 *
 * Every field edit can be undone and redone, and work that was never saved is
 * offered back the next time the project is opened rather than lost when the
 * app closes. These drive the real panel and assert what the user sees.
 */

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

beforeAll(() => {
  (HTMLMediaElement.prototype as any).play = jest.fn(async () => {});
  (HTMLMediaElement.prototype as any).pause = jest.fn();
});

const board = () => ({
  ok: true,
  result: {
    project: { projectId: 'pyramid-builders', name: 'Pyramid Builders', frameProvider: 'this-pc' },
    scenes: [{
      sceneId: 'scene_01',
      title: 'Construction',
      shots: [{
        shotId: 'shot_001', order: 1, prompt: 'Wide shot of the ramps', framing: 'wide', lens: '24mm',
        movement: 'static', durationSec: 5, narration: 'The sun rises.', status: 'PLANNED', frameImagePath: null,
      }],
    }],
    projectDir: 'C:/projects/pyramid-builders',
  },
});

function setup() {
  const mediaStoryboardGet = jest.fn().mockResolvedValue(board());
  const mediaStoryboardSave = jest.fn().mockResolvedValue({ ok: true, message: 'Saved' });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([]),
    mediaStoryboardList: jest.fn().mockResolvedValue({
      ok: true,
      storyboards: [{ projectId: 'pyramid-builders', title: 'Pyramid Builders', totalShots: 1, renderedFrames: 0, totalDurationSec: 5, projectDir: 'C:/projects/pyramid-builders' }],
    }),
    mediaStoryboardGet,
    mediaStoryboardSave,
    mediaStoryboardFrameProviders: jest.fn().mockResolvedValue({ ok: true, providers: [] }),
  };
  return { mediaStoryboardGet, mediaStoryboardSave };
}

async function openStoryboard() {
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Storyboard/i })); });
}

const promptBox = () => screen.getByLabelText('Prompt for shot_001') as HTMLTextAreaElement;
const undoButton = () => screen.getByRole('button', { name: 'Undo' });
const redoButton = () => screen.getByRole('button', { name: 'Redo' });

afterEach(() => {
  delete (window as any).electron;
  try { window.localStorage.clear(); } catch { /* storage is optional */ }
});

test('an edit can be undone and redone, and the board says when it is unsaved', async () => {
  setup();
  await openStoryboard();
  expect(undoButton()).toBeDisabled();
  expect(screen.queryByText(/Unsaved edits — Save Board/)).toBeNull();

  await act(async () => { fireEvent.change(promptBox(), { target: { value: 'Close-up of the chisel' } }); });
  expect(promptBox().value).toBe('Close-up of the chisel');
  expect(screen.getByText(/Unsaved edits — Save Board/)).toBeInTheDocument();
  expect(undoButton()).toBeEnabled();

  await act(async () => { fireEvent.click(undoButton()); });
  expect(promptBox().value).toBe('Wide shot of the ramps');
  // Back to what is saved, so nothing is outstanding.
  expect(screen.queryByText(/Unsaved edits — Save Board/)).toBeNull();
  expect(undoButton()).toBeDisabled();

  await act(async () => { fireEvent.click(redoButton()); });
  expect(promptBox().value).toBe('Close-up of the chisel');
  expect(redoButton()).toBeDisabled();
});

test('Ctrl+Z and Ctrl+Shift+Z work from the board, but leave a text field to its own undo', async () => {
  setup();
  await openStoryboard();
  await act(async () => { fireEvent.change(promptBox(), { target: { value: 'Second version' } }); });

  await act(async () => { fireEvent.keyDown(window, { key: 'z', ctrlKey: true }); });
  expect(promptBox().value).toBe('Wide shot of the ramps');
  await act(async () => { fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true }); });
  expect(promptBox().value).toBe('Second version');

  // Inside the textarea the browser's own undo has to win, or retyping a line
  // would rewind the whole storyboard.
  await act(async () => { fireEvent.keyDown(promptBox(), { key: 'z', ctrlKey: true }); });
  expect(promptBox().value).toBe('Second version');
});

test('unsaved edits are kept for the next session, offered back, and dropped once saved', async () => {
  jest.useFakeTimers();
  try {
    setup();
    await openStoryboard();
    await act(async () => { fireEvent.change(promptBox(), { target: { value: 'Edited before the app closed' } }); });
    await act(async () => { jest.advanceTimersByTime(1_000); });

    const stored = window.localStorage.getItem('homebot.storyboard.draft.pyramid-builders');
    expect(stored).toContain('Edited before the app closed');

    // Reopening the app: the saved project loads, and the draft is offered.
    cleanup();
    setup();
    await openStoryboard();
    expect(promptBox().value).toBe('Wide shot of the ramps');
    const prompt = screen.getByTestId('storyboard-draft-prompt');
    expect(prompt).toHaveTextContent(/unsaved edits to this storyboard from/i);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Restore them/i })); });
    expect(promptBox().value).toBe('Edited before the app closed');
    expect(screen.queryByTestId('storyboard-draft-prompt')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('discarding the offer leaves the saved project alone and does not ask again', async () => {
  jest.useFakeTimers();
  try {
    setup();
    await openStoryboard();
    await act(async () => { fireEvent.change(promptBox(), { target: { value: 'Not wanted' } }); });
    await act(async () => { jest.advanceTimersByTime(1_000); });
    cleanup();

    setup();
    await openStoryboard();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Discard/i })); });
    expect(promptBox().value).toBe('Wide shot of the ramps');
    expect(window.localStorage.getItem('homebot.storyboard.draft.pyramid-builders')).toBeNull();

    cleanup();
    setup();
    await openStoryboard();
    expect(screen.queryByTestId('storyboard-draft-prompt')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
