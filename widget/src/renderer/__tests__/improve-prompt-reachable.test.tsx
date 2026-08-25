/** @jest-environment jsdom */

/**
 * The prompt improver is actually reachable, and undoable.
 *
 * The rules in `shared/prompt-improve.ts` are unit-tested separately. What
 * these cover is the part that makes the feature safe to use rather than
 * merely present: the rewrite reaches the box, the original can be restored in
 * one click, and a refusal says why instead of doing nothing.
 *
 * Replacing what someone typed with no way back is a hostile thing for an app
 * to do however good the rewrite is, so Undo is a tested requirement, not a
 * nicety.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InputBox from '../components/InputBox';

const DRAFT = 'fetch and sumerize the bbc front page';
const IMPROVED = 'Fetch the BBC front page and summarise its main stories.';

let improvePrompt: jest.Mock;

function mountElectron(result: any) {
  improvePrompt = jest.fn().mockResolvedValue(result);
  (window as any).electron = {
    improvePrompt,
    getSettings: jest.fn().mockResolvedValue({}),
  };
}

function renderBox() {
  return render(
    <InputBox onSendMessage={jest.fn()} disabled={false} />
  );
}

async function typeDraft(text = DRAFT) {
  const box = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  return box;
}

afterEach(() => { delete (window as any).electron; });

describe('the button exists and is reachable', () => {
  test('it is disabled with an empty box — nothing to improve', () => {
    mountElectron({ success: true, improved: IMPROVED });
    renderBox();
    expect((screen.getByTestId('improve-prompt') as HTMLButtonElement).disabled).toBe(true);
  });

  test('it enables once there is a draft', async () => {
    mountElectron({ success: true, improved: IMPROVED });
    renderBox();
    await typeDraft();
    expect((screen.getByTestId('improve-prompt') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('a successful rewrite', () => {
  test('sends the draft and puts the rewrite in the box', async () => {
    mountElectron({ success: true, improved: IMPROVED });
    renderBox();
    const box = await typeDraft();

    await act(async () => { fireEvent.click(screen.getByTestId('improve-prompt')); });

    await waitFor(() => expect(improvePrompt).toHaveBeenCalledWith(DRAFT));
    expect(box.value).toBe(IMPROVED);
  });

  test('offers an undo, and the undo restores the exact original', async () => {
    mountElectron({ success: true, improved: IMPROVED });
    renderBox();
    const box = await typeDraft();

    await act(async () => { fireEvent.click(screen.getByTestId('improve-prompt')); });
    await waitFor(() => expect(box.value).toBe(IMPROVED));

    fireEvent.click(screen.getByTestId('improve-undo'));
    expect(box.value).toBe(DRAFT);
  });

  test('no undo button is offered before anything has been rewritten', () => {
    mountElectron({ success: true, improved: IMPROVED });
    renderBox();
    expect(screen.queryByTestId('improve-undo')).toBeNull();
  });
});

describe('a refusal', () => {
  test('shows the reason rather than silently doing nothing', async () => {
    // A button that no-ops reads as broken, and the user clicks it again.
    mountElectron({ success: false, error: 'That already reads clearly — nothing worth changing.' });
    renderBox();
    await typeDraft();

    await act(async () => { fireEvent.click(screen.getByTestId('improve-prompt')); });

    await waitFor(() => expect(screen.getByTestId('improve-note')).toBeTruthy());
    expect(screen.getByTestId('improve-note').textContent).toMatch(/already reads clearly/i);
  });

  test('leaves the draft untouched when it refuses', async () => {
    mountElectron({ success: false, error: 'Add a bit more first.' });
    renderBox();
    const box = await typeDraft();

    await act(async () => { fireEvent.click(screen.getByTestId('improve-prompt')); });

    await waitFor(() => expect(screen.getByTestId('improve-note')).toBeTruthy());
    expect(box.value).toBe(DRAFT);
    expect(screen.queryByTestId('improve-undo')).toBeNull();
  });

  test('a thrown error does not wedge the button', async () => {
    // Left disabled after a crash, the feature is dead until restart.
    improvePrompt = jest.fn().mockRejectedValue(new Error('offline'));
    (window as any).electron = { improvePrompt, getSettings: jest.fn().mockResolvedValue({}) };
    renderBox();
    await typeDraft();

    await act(async () => { fireEvent.click(screen.getByTestId('improve-prompt')); });

    await waitFor(() => expect(screen.getByTestId('improve-note')).toBeTruthy());
    expect((screen.getByTestId('improve-prompt') as HTMLButtonElement).disabled).toBe(false);
  });
});
