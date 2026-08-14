/** @jest-environment jsdom */
/**
 * Closing a document must not silently throw away what the user typed.
 *
 * DocumentViewer already tracked `doc.dirty` — it drives the Save button — but
 * Close ignored it entirely and reset the state, so edits to the user's own
 * file vanished with no prompt and no undo. This is the worst kind of data loss
 * in the app: not HomeBot's data, the user's, and typed by hand.
 *
 * There was no test file for this component at all, so the behaviour had no
 * guard in either direction.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import DocumentViewer from '../components/DocumentViewer';

const FILE = 'C:/Users/test/notes.txt';

function mockElectron(overrides: Record<string, unknown> = {}) {
  (window as any).electron = {
    parseDocument: jest.fn().mockResolvedValue({
      success: true,
      fileName: 'notes.txt',
      text: 'original content',
    }),
    writeDocument: jest.fn().mockResolvedValue({ success: true }),
    getEnv: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

/** Open a document and type into it, so the component is in the dirty state. */
async function openAndEdit() {
  const utils = render(<DocumentViewer />);
  // The component opens via a file input; drive openFile through the drop path,
  // which is the same code and needs no File System Access shim.
  const root = utils.container.querySelector('.document-viewer')!;
  await act(async () => {
    fireEvent.drop(root, {
      dataTransfer: { files: [Object.assign(new File(['x'], 'notes.txt'), { path: FILE })] },
    });
  });
  const textarea = await screen.findByDisplayValue('original content');
  await act(async () => {
    fireEvent.change(textarea, { target: { value: 'edited content' } });
  });
  return utils;
}

beforeEach(() => mockElectron());

describe('DocumentViewer — closing with unsaved edits', () => {
  test('asks before discarding, and keeps the document when cancelled', async () => {
    await openAndEdit();

    await act(async () => { fireEvent.click(screen.getByText('Close')); });

    // Nothing thrown away yet, and the dialog says what is at stake.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/will be lost/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('edited content')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });

    // The edit survives — this is the whole point.
    expect(screen.getByDisplayValue('edited content')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('closes when the user confirms', async () => {
    await openAndEdit();

    await act(async () => { fireEvent.click(screen.getByText('Close')); });
    // The button names the consequence rather than saying "OK".
    await act(async () => { fireEvent.click(screen.getByText('Close without saving')); });

    await waitFor(() => {
      expect(screen.queryByDisplayValue('edited content')).toBeNull();
    });
  });

  test('a document with no edits closes on one click', async () => {
    render(<DocumentViewer />);
    const root = document.querySelector('.document-viewer')!;
    await act(async () => {
      fireEvent.drop(root, {
        dataTransfer: { files: [Object.assign(new File(['x'], 'notes.txt'), { path: FILE })] },
      });
    });
    await screen.findByDisplayValue('original content');

    await act(async () => { fireEvent.click(screen.getByText('Close')); });

    // No prompt when there is nothing to lose — a confirmation on every close
    // would just teach people to click through it.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('original content')).toBeNull();
    });
  });
});
