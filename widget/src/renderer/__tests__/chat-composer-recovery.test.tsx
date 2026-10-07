/** @jest-environment jsdom */

import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatInterface from '../components/ChatInterface';
import { createEmptyComposerDraft, type ComposerDraft } from '../components/InputBox';
import type { ChatMessage } from '../types';

const attachmentDraft = (): ComposerDraft => ({
  text: 'Please review my draft and the attached picture.',
  images: [{ id: 'photo-1', filename: 'photo.png', mimeType: 'image/png', data: 'aW1hZ2U=', url: 'data:image/png;base64,aW1hZ2U=', size: 5 }],
  documents: [{ id: 'document-1', filename: 'draft.txt', mimeType: 'text/plain', data: 'ZHJhZnQ=', size: 5 }],
});

function RetainedChat({ onSend, initial = createEmptyComposerDraft() }: {
  onSend: jest.Mock;
  initial?: ComposerDraft;
}) {
  const [draft, setDraft] = useState(initial);
  const [visible, setVisible] = useState(true);
  return <>
    <button onClick={() => setVisible(value => !value)}>Open another feature</button>
    {visible && <ChatInterface messages={[]} onSendMessage={onSend} draft={draft} onDraftChange={setDraft} draftKey="conversation-1" />}
  </>;
}

async function firstStarter(): Promise<HTMLButtonElement> {
  await waitFor(() => expect(document.querySelector('.suggested-pill')).not.toBeNull());
  return document.querySelector('.suggested-pill') as HTMLButtonElement;
}

beforeEach(() => {
  (window as any).electron = {
    getSettings: jest.fn().mockResolvedValue({}),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
  };
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => { delete (window as any).electron; });

test('a real starter fills and focuses an editable message, and only Send dispatches it', async () => {
  const onSend = jest.fn();
  render(<ChatInterface messages={[]} onSendMessage={onSend} />);
  const starter = await firstStarter();
  const fullPrompt = starter.title;
  expect(fullPrompt.length).toBeGreaterThan(0);
  fireEvent.click(starter);

  const input = screen.getByRole('textbox', { name: 'Message HomeBot' });
  expect(input).toHaveValue(fullPrompt);
  expect(input).toHaveFocus();
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: `${fullPrompt} It is for my colleague.` } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith(`${fullPrompt} It is for my colleague.`, undefined, undefined);
  expect(input).toHaveValue('');
});

test('a starter keeps the existing draft and explains why it did not replace it', async () => {
  const onSend = jest.fn();
  render(<ChatInterface messages={[]} onSendMessage={onSend} />);
  const input = screen.getByRole('textbox', { name: 'Message HomeBot' });
  fireEvent.change(input, { target: { value: 'My detailed unfinished request.' } });
  fireEvent.click(await firstStarter());

  expect(input).toHaveValue('My detailed unfinished request.');
  expect(input).toHaveFocus();
  expect(screen.getByText(/Your draft is still here/)).toBeInTheDocument();
  expect(onSend).not.toHaveBeenCalled();
});

test('an attachment-only draft is also protected from starter replacement', async () => {
  const initial = attachmentDraft();
  initial.text = '';
  const onSend = jest.fn();
  render(<RetainedChat onSend={onSend} initial={initial} />);
  fireEvent.click(await firstStarter());
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  expect(screen.getByRole('img', { name: 'photo.png' })).toBeInTheDocument();
  expect(screen.getByText('draft.txt')).toBeInTheDocument();
  expect(screen.getByText(/Your draft is still here/)).toBeInTheDocument();
  expect(onSend).not.toHaveBeenCalled();
});

test('the parent memory snapshot restores exact text and attachments after feature navigation', () => {
  const onSend = jest.fn();
  const initial = attachmentDraft();
  render(<RetainedChat onSend={onSend} initial={initial} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: 'My newer words.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open another feature' }));
  expect(screen.queryByRole('textbox', { name: 'Message HomeBot' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open another feature' }));

  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('My newer words.');
  expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', initial.images[0].url);
  expect(screen.getByText('draft.txt')).toBeInTheDocument();
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend).toHaveBeenCalledWith('My newer words.', initial.images, initial.documents);
});

test('removing a retained attachment updates memory without restoring it after navigation', () => {
  render(<RetainedChat onSend={jest.fn()} initial={attachmentDraft()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove draft.txt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open another feature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open another feature' }));
  expect(screen.queryByText('draft.txt')).toBeNull();
  expect(screen.getByRole('img', { name: 'photo.png' })).toBeInTheDocument();
});

test('unmounting a parent-retained draft does not revoke its blob preview', () => {
  const initial = attachmentDraft();
  initial.images[0].url = 'blob:retained-preview';
  const original = URL.revokeObjectURL;
  const revoke = jest.fn();
  URL.revokeObjectURL = revoke;
  try {
    render(<RetainedChat onSend={jest.fn()} initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open another feature' }));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open another feature' }));
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'blob:retained-preview');
  } finally {
    URL.revokeObjectURL = original;
  }
});

test('Settings recovery travels through the actual ChatInterface and message list without retrying', () => {
  const message: ChatMessage = {
    id: 'assistant-1', role: 'assistant', content: '', createdAt: Date.now(), streamingState: 'error',
    error: 'unauthorized', recoveryHint: {
      service: 'unknown', userMessage: 'Check your online AI connection in Settings.', action: 'check-settings', actionLabel: 'Settings',
    },
  };
  const onOpenSettings = jest.fn();
  const onRetry = jest.fn();
  render(<ChatInterface messages={[message]} onSendMessage={jest.fn()} onOpenSettings={onOpenSettings} onRetry={onRetry} />);

  fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(onRetry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledWith('assistant-1');
});

test.each([
  { action: 'reattach-image' as const, button: 'Reattach images', input: 'Attach images', otherInput: 'Attach documents' },
  { action: 'reattach-document' as const, button: 'Reattach document', input: 'Attach documents', otherInput: 'Attach images' },
])('$button opens only the current composer file picker without sending or retrying', ({ action, button, input, otherInput }) => {
  const message: ChatMessage = {
    id: 'missing-attachment', role: 'assistant', content: '', createdAt: Date.now(), streamingState: 'error',
    error: 'Original attachment unavailable.', recoveryHint: {
      service: 'unknown', userMessage: 'Please attach the file and send your request again.', action,
    },
  };
  const onSend = jest.fn();
  const onRetry = jest.fn();
  const { container } = render(<>
    <input type="file" aria-label={input} />
    <ChatInterface messages={[message]} onSendMessage={onSend} onRetry={onRetry} draft={attachmentDraft()} onDraftChange={jest.fn()} />
  </>);
  const unrelatedInput = container.querySelector<HTMLInputElement>(`input[aria-label="${input}"]`)!;
  const picker = container.querySelector<HTMLInputElement>(`.input-wrapper input[aria-label="${input}"]`)!;
  const otherPicker = container.querySelector<HTMLInputElement>(`.input-wrapper input[aria-label="${otherInput}"]`)!;
  const clickPicker = jest.spyOn(picker, 'click');
  const clickOther = jest.spyOn(otherPicker, 'click');
  const clickUnrelated = jest.spyOn(unrelatedInput, 'click');
  fireEvent.click(screen.getByRole('button', { name: button }));
  expect(clickPicker).toHaveBeenCalledTimes(1);
  expect(clickOther).not.toHaveBeenCalled();
  expect(clickUnrelated).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(onRetry).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue(attachmentDraft().text);
});

test('a delayed rewrite from another conversation cannot overwrite the newly selected draft', async () => {
  let finish!: (value: { success: boolean; improved: string }) => void;
  (window as any).electron.improvePrompt = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const first = { ...createEmptyComposerDraft(), text: 'First conversation draft.' };
  const next = { ...createEmptyComposerDraft(), text: 'Second conversation draft.' };
  const { rerender } = render(<ChatInterface messages={[]} onSendMessage={jest.fn()} draft={first} onDraftChange={jest.fn()} draftKey="first" />);
  fireEvent.click(screen.getByRole('button', { name: 'Improve this prompt' }));
  rerender(<ChatInterface messages={[]} onSendMessage={jest.fn()} draft={next} onDraftChange={jest.fn()} draftKey="second" />);
  await act(async () => { finish({ success: true, improved: 'An old rewrite.' }); });
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Second conversation draft.');
  expect(screen.queryByRole('button', { name: 'Undo the rewrite' })).toBeNull();
});
