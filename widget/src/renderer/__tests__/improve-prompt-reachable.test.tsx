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

describe('a delayed rewrite preserves the current request', () => {
  function delayRewrite() {
    let resolve!: (value: { success: boolean; improved: string }) => void;
    improvePrompt = jest.fn(() => new Promise(done => { resolve = done; }));
    (window as any).electron = { improvePrompt, getSettings: jest.fn().mockResolvedValue({}) };
    return async () => { await act(async () => { resolve({ success: true, improved: IMPROVED }); }); };
  }

  test('newer words typed while it runs survive completion', async () => {
    const finish = delayRewrite();
    renderBox();
    const box = await typeDraft();
    fireEvent.click(screen.getByTestId('improve-prompt'));
    fireEvent.change(box, { target: { value: 'My newer, more detailed request.' } });
    await finish();
    expect(box).toHaveValue('My newer, more detailed request.');
    expect(screen.getByText(/Your draft changed while the rewrite was running/)).toBeInTheDocument();
    expect(screen.queryByTestId('improve-undo')).toBeNull();
  });

  test('changing and then restoring the words still makes the old rewrite obsolete', async () => {
    const finish = delayRewrite();
    renderBox();
    const box = await typeDraft();
    fireEvent.click(screen.getByTestId('improve-prompt'));
    fireEvent.change(box, { target: { value: 'Changed request.' } });
    fireEvent.change(box, { target: { value: DRAFT } });
    await finish();
    expect(box).toHaveValue(DRAFT);
    expect(screen.queryByTestId('improve-undo')).toBeNull();
  });

  test('adding a real document while it runs keeps the exact wording and attachment', async () => {
    const finish = delayRewrite();
    renderBox();
    const box = await typeDraft();
    fireEvent.click(screen.getByTestId('improve-prompt'));
    const document = new File(['My latest notes.'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Attach documents'), { target: { files: [document] } });
    await waitFor(() => expect(screen.getByText('notes.txt')).toBeInTheDocument());
    await finish();
    expect(box).toHaveValue(DRAFT);
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.queryByTestId('improve-undo')).toBeNull();
  });

  test('sending while it runs does not resurrect the already-sent request', async () => {
    const finish = delayRewrite();
    const onSend = jest.fn();
    render(<InputBox onSendMessage={onSend} />);
    const box = await typeDraft();
    fireEvent.click(screen.getByTestId('improve-prompt'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(DRAFT, undefined, undefined);
    await finish();
    expect(box).toHaveValue('');
    expect(screen.queryByTestId('improve-undo')).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test('editing a completed rewrite removes Undo before it can discard the edits', async () => {
    mountElectron({ success: true, improved: IMPROVED });
    renderBox();
    const box = await typeDraft();
    await act(async () => { fireEvent.click(screen.getByTestId('improve-prompt')); });
    expect(screen.getByTestId('improve-undo')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: `${IMPROVED} Keep it under 100 words.` } });
    expect(box).toHaveValue(`${IMPROVED} Keep it under 100 words.`);
    expect(screen.queryByTestId('improve-undo')).toBeNull();
  });
});
