/** @jest-environment jsdom */
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import RagPanel from '../components/RagPanel';

const defaultDoc = {
  doc_id: 'doc-1',
  filename: 'notes.txt',
  chunk_count: 3,
};

const secondDoc = {
  doc_id: 'doc-2',
  filename: 'report.pdf',
  chunk_count: 7,
};

function makeRagList(docs = [defaultDoc], totalChunks = 10) {
  return jest.fn().mockResolvedValue({
    success: true,
    result: { documents: docs, total_chunks: totalChunks },
  });
}

function makeRagClear(removedChunks = 3) {
  return jest.fn().mockResolvedValue({
    success: true,
    result: { removed_chunks: removedChunks },
  });
}

function setup(props: Partial<Parameters<typeof RagPanel>[0]> = {}) {
  const onClose = jest.fn();
  const defaults = { isOpen: true, onClose };
  return render(<RagPanel {...defaults} {...props} />);
}

beforeEach(() => {
  (window as any).electron = {
    ragList: makeRagList(),
    ragClear: makeRagClear(),
  };
});

afterEach(() => {
  delete (window as any).electron;
});

// ─── closed state ─────────────────────────────────────────────────────────────

test('renders nothing when isOpen=false', () => {
  const { container } = setup({ isOpen: false });
  expect(container.firstChild).toBeNull();
});

test('does not call ragList when isOpen=false', () => {
  setup({ isOpen: false });
  expect((window as any).electron.ragList).not.toHaveBeenCalled();
});

// ─── open state + header ──────────────────────────────────────────────────────

test('renders the header when open', async () => {
  setup();
  await waitFor(() => {
    expect(screen.getByText(/Documents HomeBot can read/)).toBeInTheDocument();
  });
});

test('renders Close button', async () => {
  setup();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});

test('dialog has role=dialog', async () => {
  setup();
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// ─── loading state ────────────────────────────────────────────────────────────

test('shows Loading while ragList is in flight', async () => {
  let resolve!: (v: any) => void;
  (window as any).electron.ragList = jest.fn(
    () => new Promise(r => { resolve = r; })
  );
  setup();
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  await act(async () => {
    resolve({ success: true, result: { documents: [], total_chunks: 0 } });
  });
});

// ─── meta line ────────────────────────────────────────────────────────────────

test('shows document count and chunk count after load', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  setup();
  await waitFor(() => {
    expect(screen.getByText(/1 document HomeBot can read/)).toBeInTheDocument();
  });
});

test('uses singular for one document', async () => {
  (window as any).electron.ragList = makeRagList(
    [{ doc_id: 'x', filename: 'a.txt', chunk_count: 1 }],
    1
  );
  setup();
  await waitFor(() => {
    const meta = screen.getByText(/1 document/);
    expect(meta.textContent).toMatch(/1 document\b/);
    expect(meta.textContent).not.toMatch(/1 documents/);
    // "chunks" is how the indexer stores a file, not anything the reader can
    // act on, so the panel no longer mentions them.
    expect(meta.textContent).not.toMatch(/chunk/i);
  });
});

test('uses plural for multiple documents', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc, secondDoc], 10);
  setup();
  await waitFor(() => {
    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
  });
});

// ─── document list ────────────────────────────────────────────────────────────

test('renders document filenames', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc, secondDoc], 10);
  setup();
  await waitFor(() => {
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });
});

test('shows each document as indexed, without exposing chunk counts', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  setup();
  await waitFor(() => {
    expect(screen.getByText('Indexed')).toBeInTheDocument();
  });
  expect(screen.queryByText(/chunk/i)).toBeNull();
});


test('renders remove buttons for each doc', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc, secondDoc], 10);
  setup();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Remove notes\.txt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove report\.pdf/i })).toBeInTheDocument();
  });
});

// ─── empty state ──────────────────────────────────────────────────────────────

test('shows empty state when no docs returned', async () => {
  (window as any).electron.ragList = makeRagList([], 0);
  setup();
  await waitFor(() => {
    expect(screen.getByText(/No documents indexed yet/)).toBeInTheDocument();
  });
});

// ─── ragList error paths ──────────────────────────────────────────────────────

test('shows error from resp.error when success=false', async () => {
  (window as any).electron.ragList = jest.fn().mockResolvedValue({
    success: false,
    error: 'Index unavailable',
  });
  setup();
  await waitFor(() => {
    expect(screen.getByText('Index unavailable')).toBeInTheDocument();
  });
});

test('shows no error state when success=false but no resp.error', async () => {
  (window as any).electron.ragList = jest.fn().mockResolvedValue({
    success: false,
  });
  const { container } = setup();
  await waitFor(() => {
    // Empty state visible, no error banner
    expect(screen.getByText(/No documents indexed yet/)).toBeInTheDocument();
    expect(container.querySelector('.rag-panel-error')).toBeNull();
  });
});

test('shows error when ragList throws', async () => {
  (window as any).electron.ragList = jest.fn().mockRejectedValue(
    new Error('Network failure')
  );
  setup();
  await waitFor(() => {
    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });
});

// ─── remove ───────────────────────────────────────────────────────────────────

test('calls ragClear with correct docId when remove clicked', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  setup();
  const removeBtn = await screen.findByRole('button', { name: /Remove notes\.txt/i });
  await act(async () => { fireEvent.click(removeBtn); });
  // Removing a document now asks first — it un-teaches HomeBot a file the user
  // deliberately gave it.
  await act(async () => { fireEvent.click(await screen.findByText('Remove it')); });
  expect((window as any).electron.ragClear).toHaveBeenCalledWith('doc-1');
});

test('remove button shows ellipsis and is disabled while removing', async () => {
  let resolve!: (v: any) => void;
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  (window as any).electron.ragClear = jest.fn(
    () => new Promise(r => { resolve = r; })
  );
  setup();
  const removeBtn = await screen.findByRole('button', { name: /Remove notes\.txt/i });
  act(() => { fireEvent.click(removeBtn); });
  // Confirm first — removal no longer happens on the click itself.
  await act(async () => { fireEvent.click(await screen.findByText('Remove it')); });
  await waitFor(() => {
    expect(removeBtn).toBeDisabled();
  });
  await act(async () => {
    resolve({ success: true, result: { removed_chunks: 3 } });
  });
});

test('remove success filters doc from list', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc, secondDoc], 10);
  (window as any).electron.ragClear = makeRagClear(3);
  setup();
  const removeBtn = await screen.findByRole('button', { name: /Remove notes\.txt/i });
  await act(async () => { fireEvent.click(removeBtn); });
  // Removing a document now asks first — it un-teaches HomeBot a file the user
  // deliberately gave it.
  await act(async () => { fireEvent.click(await screen.findByText('Remove it')); });
  await waitFor(() => {
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });
});

test('remove success updates the document list', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 10);
  (window as any).electron.ragClear = makeRagClear(3);
  setup();
  const removeBtn = await screen.findByRole('button', { name: /Remove notes\.txt/i });
  await act(async () => { fireEvent.click(removeBtn); });
  // Removing a document now asks first — it un-teaches HomeBot a file the user
  // deliberately gave it.
  await act(async () => { fireEvent.click(await screen.findByText('Remove it')); });
  // The document is gone from the list, and with the only one removed the panel
  // falls back to its empty state.
  await waitFor(() => {
    expect(screen.queryByText('notes.txt')).toBeNull();
  });
  expect(screen.getByText(/No documents indexed yet/i)).toBeInTheDocument();
});

test('remove shows error from resp.error when success=false', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  (window as any).electron.ragClear = jest.fn().mockResolvedValue({
    success: false,
    error: 'Cannot remove document',
  });
  setup();
  const removeBtn = await screen.findByRole('button', { name: /Remove notes\.txt/i });
  await act(async () => { fireEvent.click(removeBtn); });
  // Removing a document now asks first — it un-teaches HomeBot a file the user
  // deliberately gave it.
  await act(async () => { fireEvent.click(await screen.findByText('Remove it')); });
  await waitFor(() => {
    expect(screen.getByText('Cannot remove document')).toBeInTheDocument();
  });
});

test('remove shows error when ragClear throws', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  (window as any).electron.ragClear = jest.fn().mockRejectedValue(
    new Error('Clear failed')
  );
  setup();
  const removeBtn = await screen.findByRole('button', { name: /Remove notes\.txt/i });
  await act(async () => { fireEvent.click(removeBtn); });
  // Removing a document now asks first — it un-teaches HomeBot a file the user
  // deliberately gave it.
  await act(async () => { fireEvent.click(await screen.findByText('Remove it')); });
  await waitFor(() => {
    expect(screen.getByText('Clear failed')).toBeInTheDocument();
  });
});

// ─── refresh ──────────────────────────────────────────────────────────────────

test('Refresh button re-invokes ragList', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  setup();
  await screen.findByText('notes.txt');
  const ragList = (window as any).electron.ragList;
  const refreshBtn = screen.getByRole('button', { name: /refresh/i });
  await act(async () => { fireEvent.click(refreshBtn); });
  expect(ragList).toHaveBeenCalledTimes(2);
});

test('Refresh button is disabled while loading', async () => {
  let resolve!: (v: any) => void;
  (window as any).electron.ragList = jest.fn(
    () => new Promise(r => { resolve = r; })
  );
  setup();
  const refreshBtn = screen.getByRole('button', { name: /refresh/i });
  expect(refreshBtn).toBeDisabled();
  await act(async () => {
    resolve({ success: true, result: { documents: [], total_chunks: 0 } });
  });
  expect(refreshBtn).not.toBeDisabled();
});

// ─── close / overlay ──────────────────────────────────────────────────────────

test('Close button invokes onClose', async () => {
  const onClose = jest.fn();
  render(<RagPanel isOpen onClose={onClose} />);
  const closeBtn = await screen.findByRole('button', { name: /close/i });
  fireEvent.click(closeBtn);
  expect(onClose).toHaveBeenCalled();
});

test('clicking overlay invokes onClose', async () => {
  const onClose = jest.fn();
  const { container } = render(<RagPanel isOpen onClose={onClose} />);
  await waitFor(() => screen.getByRole('dialog'));
  const overlay = container.querySelector('.rag-panel-overlay')!;
  fireEvent.click(overlay);
  expect(onClose).toHaveBeenCalled();
});

test('clicking dialog panel does NOT invoke onClose', async () => {
  const onClose = jest.fn();
  render(<RagPanel isOpen onClose={onClose} />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(dialog);
  expect(onClose).not.toHaveBeenCalled();
});

// ─── isOpen toggle ────────────────────────────────────────────────────────────

test('loads docs only when isOpen changes to true', async () => {
  (window as any).electron.ragList = makeRagList([defaultDoc], 3);
  const { rerender } = setup({ isOpen: false });
  expect((window as any).electron.ragList).not.toHaveBeenCalled();
  rerender(<RagPanel isOpen onClose={jest.fn()} />);
  await waitFor(() => {
    expect((window as any).electron.ragList).toHaveBeenCalledTimes(1);
  });
});
