/** @jest-environment jsdom */

import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InputBox, {
  createEmptyComposerDraft, mergeComposerAttachments,
  type ComposerAttachmentBatch, type ComposerAttachmentDeliveryResult, type ComposerDraft,
} from '../components/InputBox';
import { prepareInactiveDraftRetention } from '../utils/composerDraftBudget';
import { resizeImageFile } from '../utils/imageUtils';

jest.mock('../utils/imageUtils', () => ({ resizeImageFile: jest.fn() }));

const draft = (text = ''): ComposerDraft => ({ ...createEmptyComposerDraft(), text });
const imageResult = (filename = 'late.png', data = btoa('Exact image bytes')) => ({
  filename, mimeType: 'image/png', data, url: `data:image/png;base64,${data}`, size: 1,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Read = { reader: FileReader; file: Blob };
let reads: Read[];
let nativeRead: FileReader['readAsDataURL'];

beforeEach(() => {
  reads = [];
  (resizeImageFile as jest.Mock).mockReset().mockResolvedValue(imageResult());
  (window as any).electron = { getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }) };
  nativeRead = FileReader.prototype.readAsDataURL;
  // Hold the real reader before starting it; completion still decodes actual
  // jsdom File bytes and invokes the production onload handler.
  jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, file: Blob) {
    reads.push({ reader: this, file });
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); delete (window as any).electron; });

async function finishRead(index = 0) {
  const { reader, file } = reads[index];
  await act(async () => {
    const finished = new Promise<void>(resolve => reader.addEventListener('loadend', () => resolve(), { once: true }));
    nativeRead.call(reader, file);
    await finished;
  });
}
async function failRead(index = 0) {
  await act(async () => { reads[index].reader.dispatchEvent(new ProgressEvent('error')); });
}
function pickImage(filename = 'late.png') {
  fireEvent.change(screen.getByLabelText('Attach images', { exact: true }), {
    target: { files: [new File(['Exact image bytes'], filename, { type: 'image/png' })] },
  });
}
function pickDocument(filename = 'late.txt', contents = `Exact bytes for ${filename}`) {
  fireEvent.change(screen.getByLabelText('Attach documents', { exact: true }), {
    target: { files: [new File([contents], filename, { type: 'text/plain' })] },
  });
}
function select(key: 'A' | 'B') { fireEvent.click(screen.getByRole('button', { name: `Chat ${key}` })); }
function input() { return screen.getByRole('textbox', { name: 'Message HomeBot' }); }

function RetainedComposer({ onSend = jest.fn(), onBatch, onStart, onEnd, initialA, retentionBytes = 128 * 1024 * 1024 }: {
  onSend?: jest.Mock; onBatch?: jest.Mock; onStart?: jest.Mock; onEnd?: jest.Mock;
  initialA?: ComposerDraft; retentionBytes?: number;
}) {
  const drafts = useRef(new Map<string, ComposerDraft>([['A', initialA || draft('A existing words.')], ['B', draft('B untouched words.')]]));
  const generations = useRef(new Map([['A', 11], ['B', 22]]));
  const [key, setKey] = useState('A');
  const keyRef = useRef(key);
  keyRef.current = key;
  const [, refresh] = useState(0);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState('');
  const changed = () => refresh(value => value + 1);
  const receive = (batch: ComposerAttachmentBatch) => {
    onBatch?.(batch);
    const owner = batch.scope.draftKey!;
    const previous = drafts.current.get(owner);
    if (!previous || generations.current.get(owner) !== batch.scope.generation) {
      return { success: false, error: 'The original draft was sent, replaced or deleted.' };
    }
    const merged = mergeComposerAttachments(previous, batch);
    if (!merged.success) return merged;
    if (owner !== keyRef.current) {
      const inactive = new Map([...drafts.current].filter(([id]) => id !== keyRef.current));
      const retained = prepareInactiveDraftRetention(inactive, { key: owner, draft: merged.draft }, {
        maxInactiveDrafts: 8, maxEstimatedBytes: retentionBytes,
      });
      if (!retained.allowed) return { success: false, error: 'Not enough room to keep the attachment in an unfinished chat.' };
    }
    drafts.current.set(owner, merged.draft);
    changed();
    return { success: true };
  };
  return <>
    {['A', 'B'].map(id => <button key={id} onClick={() => { keyRef.current = id; setKey(id); }}>Chat {id}</button>)}
    <button onClick={() => {
      generations.current.set('A', (generations.current.get('A') || 0) + 1);
      drafts.current.set('A', draft('A replacement words.'));
      changed();
    }}>Replace A draft</button>
    <button onClick={() => { drafts.current.delete('A'); generations.current.delete('A'); changed(); }}>Delete A</button>
    <button onClick={() => setVisible(value => !value)}>Toggle composer</button>
    {error && <div role="alert">{error}</div>}
    {visible && <InputBox draftKey={key} draftGeneration={generations.current.get(key)} draft={drafts.current.get(key)!}
      onDraftChange={next => { drafts.current.set(keyRef.current, next); changed(); }}
      onSendMessage={(...args) => {
        generations.current.set(keyRef.current, (generations.current.get(keyRef.current) || 0) + 1);
        onSend(...args);
      }}
      onAttachmentsReady={receive} onAttachmentReadError={setError}
      onAttachmentReadStart={scope => onStart?.(scope)} onAttachmentReadEnd={scope => onEnd?.(scope)} />}
  </>;
}

test('a late image selected in A reaches retained A rather than visible B, with exact retryable bytes', async () => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  const onSend = jest.fn();
  const onBatch = jest.fn();
  render(<RetainedComposer onSend={onSend} onBatch={onBatch} />);
  pickImage();
  select('B');
  await act(async () => { conversion.resolve(imageResult()); });
  expect(input()).toHaveValue('B untouched words.');
  expect(screen.queryByAltText('late.png')).toBeNull();
  expect(onBatch.mock.calls[0][0].scope).toEqual({ draftKey: 'A', generation: 11 });
  select('A');
  expect(screen.getByAltText('late.png')).toHaveAttribute('src', imageResult().url);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend.mock.calls[0][1][0]).toEqual(expect.objectContaining({ data: imageResult().data, url: imageResult().url, filename: 'late.png' }));
});

test('a real document read completed after A to B retains its original base64 bytes in A', async () => {
  const onSend = jest.fn();
  const onStart = jest.fn();
  const onEnd = jest.fn();
  render(<RetainedComposer onSend={onSend} onStart={onStart} onEnd={onEnd} />);
  pickDocument();
  expect(onStart).toHaveBeenCalledWith({ draftKey: 'A', generation: 11 });
  expect(onEnd).not.toHaveBeenCalled();
  select('B');
  await finishRead();
  expect(input()).toHaveValue('B untouched words.');
  expect(screen.queryByText('late.txt')).toBeNull();
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledWith({ draftKey: 'A', generation: 11 });
  select('A');
  expect(screen.getByText('late.txt')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend.mock.calls[0][2][0]).toEqual(expect.objectContaining({ data: btoa('Exact bytes for late.txt'), filename: 'late.txt' }));
});

test('returning to the same draft merges into its latest text and attachments without replacing either', async () => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  const onSend = jest.fn();
  render(<RetainedComposer onSend={onSend} />);
  pickImage();
  select('B');
  select('A');
  fireEvent.change(input(), { target: { value: 'Latest A words.' } });
  pickDocument('newer.txt');
  await finishRead();
  await act(async () => { conversion.resolve(imageResult()); });
  expect(input()).toHaveValue('Latest A words.');
  expect(screen.getByText('newer.txt')).toBeInTheDocument();
  expect(screen.getByAltText('late.png')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend.mock.calls[0][0]).toBe('Latest A words.');
  expect(onSend.mock.calls[0][2][0].data).toBe(btoa('Exact bytes for newer.txt'));
});

test.each(['replace', 'delete'])('a late read cannot append to a %s lifecycle after A to B to A', async change => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  render(<RetainedComposer />);
  pickImage();
  select('B');
  fireEvent.click(screen.getByRole('button', { name: change === 'replace' ? 'Replace A draft' : 'Delete A' }));
  if (change === 'replace') select('A');
  await act(async () => { conversion.resolve(imageResult()); });
  expect(screen.queryByAltText('late.png')).toBeNull();
  expect(input()).toHaveValue(change === 'replace' ? 'A replacement words.' : 'B untouched words.');
  expect(screen.getByRole('alert')).toHaveTextContent('The original draft was sent, replaced or deleted.');
  expect(screen.getByRole('alert')).toHaveTextContent('choose the file again');
});

test('mode unmount retains completion through the captured parent callback and settles pending count', async () => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  const onStart = jest.fn();
  const onEnd = jest.fn();
  render(<RetainedComposer onStart={onStart} onEnd={onEnd} />);
  pickImage();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle composer' }));
  expect(screen.queryByRole('textbox', { name: 'Message HomeBot' })).toBeNull();
  await act(async () => { conversion.resolve(imageResult()); });
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onEnd.mock.calls[0][0]).toEqual(onStart.mock.calls[0][0]);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle composer' }));
  expect(screen.getByAltText('late.png')).toBeInTheDocument();
});

test('inactive retention refusal is visible and keeps both drafts unchanged', async () => {
  render(<RetainedComposer retentionBytes={128} />);
  pickDocument('over-budget.txt', 'x'.repeat(200));
  select('B');
  await finishRead();
  expect(input()).toHaveValue('B untouched words.');
  expect(screen.getByRole('alert')).toHaveTextContent('Not enough room to keep the attachment');
  select('A');
  expect(input()).toHaveValue('A existing words.');
  expect(screen.queryByText('over-budget.txt')).toBeNull();
});

test('concurrent document reads recheck the latest count and do not exceed three files', async () => {
  const initial = draft('Keep these words.');
  initial.documents = ['one.txt', 'two.txt'].map(filename => ({ id: filename, filename, mimeType: 'text/plain', size: 1, data: 'eA==' }));
  render(<RetainedComposer initialA={initial} />);
  pickDocument('third.txt');
  pickDocument('fourth.txt');
  await finishRead(0);
  await finishRead(1);
  expect(screen.getByText('third.txt')).toBeInTheDocument();
  expect(screen.queryByText('fourth.txt')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('up to 3 documents');
  expect(input()).toHaveValue('Keep these words.');
});

test('concurrent image conversions recheck the latest count and do not exceed five files', async () => {
  const initial = draft('Keep these words.');
  initial.images = Array.from({ length: 4 }, (_, index) => ({ ...imageResult(`existing-${index}.png`), id: `existing-${index}` }));
  const first = deferred<ReturnType<typeof imageResult>>();
  const second = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<RetainedComposer initialA={initial} />);
  pickImage('fifth.png');
  pickImage('sixth.png');
  await act(async () => { first.resolve(imageResult('fifth.png')); });
  await act(async () => { second.resolve(imageResult('sixth.png')); });
  expect(screen.getByAltText('fifth.png')).toBeInTheDocument();
  expect(screen.queryByAltText('sixth.png')).toBeNull();
  expect(screen.getAllByRole('img')).toHaveLength(5);
  expect(screen.getByRole('alert')).toHaveTextContent('up to 5 images');
});

test.each(['drop', 'paste'])('mixed image/document %s keeps one origin while awaiting image conversion', async entry => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  const onBatch = jest.fn();
  const onStart = jest.fn();
  const onEnd = jest.fn();
  const { container } = render(<RetainedComposer onBatch={onBatch} onStart={onStart} onEnd={onEnd} />);
  const files = [new File(['photo'], 'late.png', { type: 'image/png' }), new File(['Mixed document bytes'], 'mixed.txt', { type: 'text/plain' })];
  if (entry === 'drop') fireEvent.drop(container.querySelector('.input-box')!, { dataTransfer: { files } });
  else fireEvent.paste(input(), { clipboardData: { items: files.map(file => ({ kind: 'file', getAsFile: () => file })) } });
  select('B');
  await act(async () => { conversion.resolve(imageResult()); });
  expect(reads).toHaveLength(1);
  await finishRead();
  expect(onBatch.mock.calls.map(([batch]) => batch.scope)).toEqual([
    { draftKey: 'A', generation: 11 }, { draftKey: 'A', generation: 11 },
  ]);
  expect(onStart).toHaveBeenCalledTimes(2);
  expect(onEnd).toHaveBeenCalledTimes(2);
  expect(input()).toHaveValue('B untouched words.');
  expect(screen.queryByText('mixed.txt')).toBeNull();
  select('A');
  expect(screen.getByAltText('late.png')).toBeInTheDocument();
  expect(screen.getByText('mixed.txt')).toBeInTheDocument();
});

test('a document reader error reports reattachment and always settles its origin pending count', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const onStart = jest.fn();
  const onEnd = jest.fn();
  render(<RetainedComposer onStart={onStart} onEnd={onEnd} />);
  pickDocument('unreadable.txt');
  select('B');
  await failRead();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read unreadable.txt');
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(input()).toHaveValue('B untouched words.');
});

test('a partially successful document selection keeps the readable file and explains the other failure', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<RetainedComposer />);
  fireEvent.change(screen.getByLabelText('Attach documents', { exact: true }), {
    target: { files: [new File(['Readable bytes'], 'readable.txt', { type: 'text/plain' }), new File(['Unreadable bytes'], 'unreadable.txt', { type: 'text/plain' })] },
  });
  await finishRead(0);
  expect(reads).toHaveLength(2);
  await failRead(1);
  expect(screen.getByText('readable.txt')).toBeInTheDocument();
  expect(screen.queryByText('unreadable.txt')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read unreadable.txt');
});

test('image fallback read failure is explained instead of silently ignored', async () => {
  (resizeImageFile as jest.Mock).mockRejectedValueOnce(new Error('Resize unavailable'));
  const onEnd = jest.fn();
  render(<RetainedComposer onEnd={onEnd} />);
  await act(async () => { pickImage('unreadable.png'); });
  expect(reads).toHaveLength(1);
  await failRead();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read unreadable.png');
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(screen.queryByAltText('unreadable.png')).toBeNull();
});

test('standalone fallback refuses an old visit after A to B to A without parent retention', async () => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  const change = jest.fn();
  const send = jest.fn();
  const { rerender } = render(<InputBox draftKey="A" draft={draft('Original A.')} onDraftChange={change} onSendMessage={send} />);
  pickImage();
  rerender(<InputBox draftKey="B" draft={draft('B draft.')} onDraftChange={change} onSendMessage={send} />);
  rerender(<InputBox draftKey="A" draft={draft('New A words.')} onDraftChange={change} onSendMessage={send} />);
  await act(async () => { conversion.resolve(imageResult()); });
  expect(change).not.toHaveBeenCalled();
  expect(input()).toHaveValue('New A words.');
  expect(screen.queryByAltText('late.png')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('The original composer changed');
  expect(send).not.toHaveBeenCalled();
});

test('standalone Send and Enter wait for selected files, then send the complete draft only on a new gesture', async () => {
  const conversion = deferred<ReturnType<typeof imageResult>>();
  (resizeImageFile as jest.Mock).mockReturnValueOnce(conversion.promise);
  const send = jest.fn();
  render(<InputBox onSendMessage={send} />);
  fireEvent.change(input(), { target: { value: 'First message.' } });
  pickImage();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Preparing selected files');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.keyDown(input(), { key: 'Enter' });
  expect(send).not.toHaveBeenCalled();
  expect(input()).toHaveValue('First message.');
  expect(screen.getByRole('alert')).toHaveTextContent('Please wait for the selected files');
  await act(async () => { conversion.resolve(imageResult()); });
  expect(screen.getByAltText('late.png')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('First message.', [expect.objectContaining({ filename: 'late.png', data: btoa('Exact image bytes') })], undefined);
  expect(input()).toHaveValue('');
  expect(screen.queryByAltText('late.png')).toBeNull();
});

test.each(['throws', 'refuses', 'missing'])('completion requires a positive parent acknowledgement (%s)', async outcome => {
  const report = jest.fn();
  const receive = jest.fn((_batch: ComposerAttachmentBatch): ComposerAttachmentDeliveryResult => {
    if (outcome === 'throws') throw new Error('Retention refused');
    if (outcome === 'missing') return undefined as unknown as ComposerAttachmentDeliveryResult;
    return { success: false, error: 'Retention refused' };
  });
  const changed = jest.fn();
  render(<InputBox draftKey="A" draftGeneration={11} draft={draft('Keep my text.')} onDraftChange={changed}
    onSendMessage={jest.fn()} onAttachmentsReady={receive} onAttachmentReadError={report} />);
  await act(async () => { pickImage(); });
  expect(receive).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(expect.stringContaining('was not attached to its original draft'));
  expect(changed).not.toHaveBeenCalled();
  expect(input()).toHaveValue('Keep my text.');
});
