/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { resizeImageFile } from '../utils/imageUtils';
import type { Message } from '../../shared/types';

jest.mock('../utils/imageUtils', () => ({ resizeImageFile: jest.fn() }));

const PHOTO_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=';

type Conversation = { id: string; title: string; messages: Message[]; createdAt: string; updatedAt: string; messageCount: number; systemPrompt?: string };
type Ack = { success: boolean; error?: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let bridge: Record<string, jest.Mock>;
let conversations: Map<string, Conversation>;
let backendActive: string | null;

function conversation(id: string): Conversation {
  return {
    id, title: `Conversation ${id}`, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', messageCount: 1,
    messages: [{ id: `reply-${id}`, role: 'assistant', content: `Saved reply from ${id}.`, timestamp: '2026-10-07T00:00:00.000Z', streamingState: 'finished' }],
  };
}

function activate(id: string): Ack {
  backendActive = id;
  return { success: true };
}

function createEmptyConversation(id: string): Conversation {
  const created = { ...conversation(id), messages: [], messageCount: 0 };
  conversations.set(id, created);
  // Native createNewConversation creates the record AND makes it active.
  backendActive = id;
  return created;
}

function persistRow(id: string, message: Message): Ack {
  const record = conversations.get(id);
  if (!record) return { success: false, error: 'Missing fixture conversation' };
  record.messages.push({ ...message });
  record.messageCount = record.messages.length;
  return { success: true };
}

function copyRecord(record: Conversation): Conversation {
  return { ...record, messages: record.messages.map(message => ({ ...message })) };
}

function saveRecord(record: Conversation): Ack {
  conversations.set(record.id, copyRecord(record));
  return { success: true };
}

beforeEach(() => {
  conversations = new Map(['A', 'B', 'C', 'D'].map(id => [id, conversation(id)]));
  backendActive = null;
  (resizeImageFile as jest.Mock).mockResolvedValue({ data: PHOTO_DATA, dataUrl: `data:image/png;base64,${PHOTO_DATA}`, url: `data:image/png;base64,${PHOTO_DATA}`, mimeType: 'image/png', filename: 'original-photo.png' });
  const settings = { firstRun: false, theme: 'dark', chatModel: 'qwen2.5:7b', useCustomLLM: false, modelRoutingMode: 'off', uncensoredMode: false };
  bridge = {
    getSettings: jest.fn().mockResolvedValue(settings),
    getWidgetMode: jest.fn().mockResolvedValue(true),
    onWidgetModeChanged: jest.fn(() => jest.fn()),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    resolveActiveModel: jest.fn().mockResolvedValue({ success: true, source: 'local', model: 'qwen2.5:7b' }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }] }),
    loadConversations: jest.fn(async () => ({ success: true, data: { conversations: Array.from(conversations.values()) } })),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: conversations.get('A') }),
    getConversation: jest.fn(async (id: string) => {
      const record = conversations.get(id);
      return { success: !!record, data: record ? copyRecord(record) : undefined };
    }),
    setActiveConversation: jest.fn(async (id: string) => activate(id)),
    deleteConversation: jest.fn(async (id: string) => {
      conversations.delete(id);
      if (backendActive === id) backendActive = null;
      return { success: true };
    }),
    addMessage: jest.fn(async (id: string, message: Message) => persistRow(id, message)),
    updateMessage: jest.fn(async (id: string, messageId: string, updates: Partial<Message>) => {
      const row = conversations.get(id)?.messages.find(message => message.id === messageId);
      if (!row) return { success: false, error: 'Missing fixture message' };
      Object.assign(row, updates);
      return { success: true };
    }),
    saveConversation: jest.fn(async (record: Conversation) => saveRecord(record)),
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    subscribeToStream: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
  };
  (window as any).electron = bridge;
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => { cleanup(); delete (window as any).electron; });

async function mountReady() {
  await act(async () => { render(<App />); });
  expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
  expect(backendActive).toBe('A');
}

function typeDraft(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: text } });
}

async function choose(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  const title = conversations.get(id)!.title;
  const titleControl = await screen.findByText(title, { selector: '.conv-title' });
  // Check the target row's accessible control without recomputing every sidebar
  // action's name during each of the nine real draft-retention navigations.
  const row = titleControl.closest<HTMLElement>('.conversation-item')!;
  const deleteControl = within(row).getByRole('button', { name: `Delete ${title}` });
  fireEvent.click(deleteControl.closest('.conversation-item')!);
}

async function expectActive(id: string) {
  await waitFor(() => expect(backendActive).toBe(id));
  expect(await screen.findByText(`Saved reply from ${id}.`)).toBeInTheDocument();
}

async function deleteA() {
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
}

async function deleteActiveA() {
  await deleteA();
  await act(async () => {});
  expect(conversations.has('A')).toBe(false);
  expect(backendActive).toBeNull();
}


function pendingPhoto() {
  const pending = deferred<any>();
  (resizeImageFile as jest.Mock).mockImplementationOnce(() => pending.promise);
  fireEvent.change(screen.getByLabelText('Attach images', { exact: true }), {
    target: { files: [new File(['original image bytes'], 'late-photo.png', { type: 'image/png' })] },
  });
  return { finish: async () => act(async () => pending.resolve({ data: PHOTO_DATA,
    dataUrl: 'data:image/png;base64,' + PHOTO_DATA, url: 'data:image/png;base64,' + PHOTO_DATA,
    mimeType: 'image/png', filename: 'late-photo.png' })) };
}

test('a photo finishing in B stays in the original A draft with its exact bytes', async () => {
  await mountReady();
  typeDraft('Original A question.');
  const pending = pendingPhoto();
  await choose('B'); await expectActive('B');
  typeDraft('Newer B question.');
  const storedB = copyRecord(conversations.get('B')!);
  await pending.finish();
  expect(screen.queryByAltText('late-photo.png')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer B question.');
  expect(conversations.get('B')).toEqual(storedB);
  await choose('A'); await expectActive('A');
  expect(await screen.findByAltText('late-photo.png')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Original A question.');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  expect(bridge.sendStreamMessage.mock.calls[0][0]).toMatchObject({ conversation_id: 'A',
    images: [expect.objectContaining({ data: PHOTO_DATA, filename: 'late-photo.png' })] });
});

test('A to B to A retains the upload token while merging into the latest unsent A words', async () => {
  await mountReady(); const pending = pendingPhoto();
  await choose('B'); await expectActive('B');
  await choose('A'); await expectActive('A');
  typeDraft('Latest A words.');
  await pending.finish();
  expect(await screen.findByAltText('late-photo.png')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Latest A words.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('Send waits for the current draft file without blocking B, then preserves it through a round trip', async () => {
  await mountReady(); const pending = pendingPhoto(); typeDraft('Send this text with its photo.');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message HomeBot' }), { key: 'Enter' });
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Send this text with its photo.');
  await choose('B'); await expectActive('B');
  typeDraft('B is still usable.');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  await choose('A'); await expectActive('A'); typeDraft('Next unsent A draft.');
  await pending.finish();
  expect(screen.getByAltText('late-photo.png')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Next unsent A draft.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  expect(bridge.sendStreamMessage.mock.calls[0][0]).toMatchObject({ conversation_id: 'A',
    message: expect.stringContaining('Next unsent A draft.'), images: [expect.objectContaining({ data: PHOTO_DATA })] });
});

test('a file finishing after acknowledged deletion cannot resurrect its chat or alter B', async () => {
  await mountReady(); const pending = pendingPhoto(); await deleteActiveA();
  await choose('B'); await expectActive('B'); typeDraft('Keep B.');
  await pending.finish();
  expect(conversations.has('A')).toBe(false);
  expect(screen.queryByAltText('late-photo.png')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep B.');
  expect(await screen.findByText(/That draft was sent, cleared, or deleted/)).toBeInTheDocument();
});

test('a file finishing while Home unmounts the composer returns to the same chat draft', async () => {
  await mountReady(); typeDraft('Keep this question.'); const pending = pendingPhoto();
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  await screen.findByRole('button', { name: 'Start with chat' });
  await pending.finish();
  fireEvent.click(screen.getByRole('button', { name: 'Start with chat' }));
  expect(await screen.findByAltText('late-photo.png')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this question.');
});

test('Home and back before a file finishes retains the pending Send and Enter guard through remount', async () => {
  await mountReady(); typeDraft('Keep this question with its file.'); const pending = pendingPhoto();
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Start with chat' }));
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByText('Preparing selected files. Your draft is kept.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message HomeBot' }), { key: 'Enter' });
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this question with its file.');
  await pending.finish();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(screen.getByAltText('late-photo.png')).toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  expect(bridge.sendStreamMessage.mock.calls[0][0]).toMatchObject({ conversation_id: 'A',
    message: expect.stringContaining('Keep this question with its file.'), images: [expect.objectContaining({ data: PHOTO_DATA })] });
});

test('deleting an unadopted file-origin chat during activation does not move the file token into that deleted chat', async () => {
  await mountReady(); await deleteActiveA();
  // Delete leaves the sidebar open with its earlier snapshot. Reopen it after
  // native creation so it can list the record before renderer adoption occurs.
  fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
  const pending = pendingPhoto();
  const activation = deferred<Ack>();
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('file-origin') }));
  bridge.setActiveConversation.mockImplementation(async (id: string) => {
    activate(id);
    return id === 'file-origin' ? activation.promise : { success: true };
  });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith('file-origin'));
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  const deleteOrigin = await screen.findByRole('button', { name: `Delete ${conversations.get('file-origin')!.title}` });
  expect(deleteOrigin.closest('.conversation-item')).not.toHaveClass('active');
  expect(conversations.get('file-origin')!.messages).toEqual([]);
  fireEvent.click(deleteOrigin);
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  await waitFor(() => expect(conversations.has('file-origin')).toBe(false));
  await act(async () => { activation.resolve({ success: true }); });
  await pending.finish();
  expect(screen.getByAltText('late-photo.png')).toBeInTheDocument();
  expect(conversations.has('file-origin')).toBe(false);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('file-recovered') }));
  await choose('B'); await expectActive('B');
  await choose('file-recovered');
  await waitFor(() => expect(backendActive).toBe('file-recovered'));
  expect(screen.getByAltText('late-photo.png')).toBeInTheDocument();
  expect(conversations.has('file-origin')).toBe(false);
});

test.each(['New', 'Select'] as const)('a pending file in a null editor gains a real owner before %s navigation', async destination => {
  await mountReady(); await deleteActiveA(); const pending = pendingPhoto();
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('file-origin') }));
  if (destination === 'New') {
    bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('new-destination') }));
    fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
    await waitFor(() => expect(backendActive).toBe('new-destination'));
  } else { await choose('B'); await expectActive('B'); }
  await pending.finish();
  expect(screen.queryByAltText('late-photo.png')).not.toBeInTheDocument();
  await choose('file-origin');
  await waitFor(() => expect(backendActive).toBe('file-origin'));
  expect(await screen.findByAltText('late-photo.png')).toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('a late file refuses a ninth inactive draft explicitly without evicting existing work', async () => {
  for (let index = 0; index < 9; index++) conversations.set('budget-' + index, conversation('budget-' + index));
  await mountReady(); const pending = pendingPhoto();
  for (let index = 0; index < 9; index++) {
    await choose('budget-' + index); await expectActive('budget-' + index);
    typeDraft('Budget draft ' + index);
  }
  await pending.finish();
  expect(await screen.findByText(/There is not enough room to keep this file/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Budget draft 8');
  await choose('budget-0'); await expectActive('budget-0');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Budget draft 0');
});
