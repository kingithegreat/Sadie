/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { resizeImageFile } from '../utils/imageUtils';
import type { Message } from '../../shared/types';

jest.mock('../utils/imageUtils', () => ({ resizeImageFile: jest.fn() }));

const PHOTO_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=';

type Conversation = { id: string; title: string; messages: Message[]; createdAt: string; updatedAt: string; messageCount: number };
type ConversationReply = { success: boolean; data?: Conversation };
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
    getConversation: jest.fn(async (id: string) => ({ success: conversations.has(id), data: conversations.get(id) })),
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
    saveConversation: jest.fn().mockResolvedValue({ success: true }),
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

async function attach(name: string) {
  fireEvent.change(screen.getByLabelText('Attach documents', { exact: true }), {
    target: { files: [new File([`Exact bytes for ${name}`], name, { type: 'text/plain' })] },
  });
  await screen.findByText(name);
}

async function attachPhoto() {
  fireEvent.change(screen.getByLabelText('Attach images', { exact: true }), {
    target: { files: [new File(['fixture image bytes'], 'original-photo.png', { type: 'image/png' })] },
  });
  await screen.findByAltText('original-photo.png');
}

async function choose(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByText(`Conversation ${id}`));
}

async function expectActive(id: string) {
  await waitFor(() => expect(backendActive).toBe(id));
  expect(await screen.findByText(`Saved reply from ${id}.`)).toBeInTheDocument();
}

async function fillInactiveDraftCapacity() {
  for (let index = 0; index < 9; index++) conversations.set(`budget-${index}`, conversation(`budget-${index}`));
  await mountReady();
  typeDraft('Retained A request.');
  for (let index = 0; index < 8; index++) {
    await choose(`budget-${index}`);
    await expectActive(`budget-${index}`);
    typeDraft(`Retained budget-${index} request.`);
  }
}

test('full inactive retention refuses a ninth draft without losing work, but Home and retained destinations remain usable', async () => {
  await fillInactiveDraftCapacity();
  const priorCreates = bridge.createConversation.mock.calls.length;
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  expect(bridge.createConversation).toHaveBeenCalledTimes(priorCreates);
  await choose('budget-8');
  expect(bridge.getConversation).not.toHaveBeenCalledWith('budget-8');
  expect(screen.getAllByText('Too many unfinished chats. Send or clear a draft before switching chats. Your current draft is kept.').length).toBeGreaterThan(0);
  expect(backendActive).toBe('budget-7');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Retained budget-7 request.');
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Start with chat' }));
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Retained budget-7 request.');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Retained A request.');
  typeDraft('');
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('after-clearing') }));
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await waitFor(() => expect(backendActive).toBe('after-clearing'));
  expect(bridge.createConversation).toHaveBeenCalledTimes(priorCreates + 1);
  await choose('budget-7');
  await expectActive('budget-7');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Retained budget-7 request.');
});

test('typing during activation that exceeds retention restores the adopted backend chat and keeps the new words', async () => {
  await fillInactiveDraftCapacity();
  typeDraft('');
  const acknowledgement = deferred<Ack>();
  bridge.setActiveConversation.mockImplementation((id: string) => id === 'budget-8'
    ? acknowledgement.promise.then(result => { if (result.success) activate(id); return result; })
    : Promise.resolve(activate(id)));
  await choose('budget-8');
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith('budget-8'));
  typeDraft('These words were typed while the other chat opened.');
  await act(async () => { acknowledgement.resolve({ success: true }); });
  await expectActive('budget-7');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('These words were typed while the other chat opened.');
  expect(screen.queryByText('Saved reply from budget-8.')).toBeNull();
  expect(screen.getByText('Too many unfinished chats. Send or clear a draft before switching chats. Your current draft is kept.')).toBeInTheDocument();
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Retained A request.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('failed explicit New reports the failure and retains the current conversation and draft', async () => {
  await mountReady();
  await choose('A');
  await expectActive('A');
  typeDraft('Keep this unfinished A message.');
  bridge.createConversation.mockResolvedValueOnce({ success: false, error: 'Fixture store unavailable' });
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
  await screen.findByText('Could not start a new conversation. Your draft is kept. Please try again.');
  expect(backendActive).toBe('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this unfinished A message.');
  expect(screen.getByText('Saved reply from A.')).toBeInTheDocument();
});

test('failed selection reports the failure instead of silently discarding the current draft', async () => {
  await mountReady();
  await choose('A');
  await expectActive('A');
  typeDraft('Keep this A draft.');
  bridge.getConversation.mockResolvedValueOnce({ success: false, error: 'Fixture load failed' });
  await choose('B');
  await screen.findByText('Could not open that conversation. Your draft is kept. Please try again.');
  expect(backendActive).toBe('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this A draft.');
  expect(screen.getByText('Saved reply from A.')).toBeInTheDocument();
});

test('a slower old selection cannot replace the newest conversation or corrupt either retained draft', async () => {
  await mountReady();
  typeDraft('Original A draft.');
  await attach('a-notes.txt');
  const pendingB = deferred<ConversationReply>();
  bridge.getConversation.mockImplementationOnce(() => pendingB.promise);
  await choose('B');
  expect(bridge.getConversation).toHaveBeenCalledWith('B');
  await choose('C');
  await expectActive('C');
  typeDraft('Newer C draft.');
  await attach('c-notes.txt');
  await act(async () => { pendingB.resolve({ success: true, data: conversations.get('B') }); });
  expect(backendActive).toBe('C');
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith('B');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer C draft.');
  expect(screen.getByText('c-notes.txt')).toBeInTheDocument();

  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Original A draft.');
  expect(screen.getByText('a-notes.txt')).toBeInTheDocument();
  expect(screen.queryByText('c-notes.txt')).toBeNull();
  await choose('C');
  await expectActive('C');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer C draft.');
  expect(screen.getByText('c-notes.txt')).toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('deleting A while switching to B does not clear B messages, draft or attachments', async () => {
  await mountReady();
  typeDraft('A draft before deletion.');
  const deletion = deferred<Ack>();
  bridge.deleteConversation.mockImplementationOnce(() => deletion.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  expect(bridge.deleteConversation).toHaveBeenCalledWith('A');
  await choose('B');
  await expectActive('B');
  typeDraft('B draft must survive.');
  await attach('b-notes.txt');
  await act(async () => { conversations.delete('A'); deletion.resolve({ success: true }); });
  expect(screen.getByText('Saved reply from B.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('B draft must survive.');
  expect(screen.getByText('b-notes.txt')).toBeInTheDocument();
  expect(backendActive).toBe('B');
  expect(bridge.createConversation).toHaveBeenCalledTimes(1);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('in-flight backend activations are ordered and only the newest acknowledgement changes the renderer', async () => {
  await mountReady();
  typeDraft('A draft before activation.');
  const activationB = deferred<Ack>();
  bridge.setActiveConversation.mockImplementation((id: string) => id === 'B'
    ? activationB.promise.then(result => { if (result.success) activate(id); return result; })
    : Promise.resolve(activate(id)));
  await choose('B');
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith('B'));
  await choose('C');
  await act(async () => {});
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith('C');
  typeDraft('A words typed while opening the other conversation.');
  await act(async () => { activationB.resolve({ success: true }); });
  await expectActive('C');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('A words typed while opening the other conversation.');
});

test('a late New response cleans only its unique unused record and preserves the subsequently selected conversation', async () => {
  await mountReady();
  typeDraft('A draft before New.');
  const creation = deferred<ConversationReply>();
  let orphan!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => {
    orphan = createEmptyConversation('unused-new');
    return creation.promise;
  });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  await choose('B');
  await expectActive('B');
  typeDraft('B draft after selecting B.');
  await act(async () => { creation.resolve({ success: true, data: orphan }); });
  await waitFor(() => expect(bridge.deleteConversation).toHaveBeenCalledWith('unused-new'));
  expect(bridge.deleteConversation.mock.calls.map(call => call[0])).toEqual(['unused-new']);
  expect(conversations.has('unused-new')).toBe(false);
  expect(conversations.has('A')).toBe(true);
  expect(conversations.has('B')).toBe(true);
  expect(backendActive).toBe('B');
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith('unused-new');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('B draft after selecting B.');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('A draft before New.');
});

test('stale New cleanup never deletes its newly created record after the user has adopted it', async () => {
  await mountReady();
  const creation = deferred<ConversationReply>();
  let created!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => {
    created = createEmptyConversation('adopted-new');
    return creation.promise;
  });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await choose('adopted-new');
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith('adopted-new'));
  await act(async () => {});
  typeDraft('Keep the draft in my adopted conversation.');
  await choose('B');
  await expectActive('B');
  typeDraft('Keep the newer B draft too.');
  await act(async () => { creation.resolve({ success: true, data: created }); });
  expect(bridge.deleteConversation).not.toHaveBeenCalled();
  expect(conversations.has('adopted-new')).toBe(true);
  expect(backendActive).toBe('B');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep the newer B draft too.');
  await choose('adopted-new');
  await waitFor(() => expect(backendActive).toBe('adopted-new'));
  expect(backendActive).toBe('adopted-new');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep the draft in my adopted conversation.');
});

test('selection intent protects a newly created record while its conversation lookup is still pending', async () => {
  await mountReady();
  const creation = deferred<ConversationReply>();
  const lookup = deferred<ConversationReply>();
  let created!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => {
    created = createEmptyConversation('pending-adoption');
    return creation.promise;
  });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  bridge.getConversation.mockImplementation((id: string) => id === created.id
    ? lookup.promise
    : Promise.resolve({ success: conversations.has(id), data: conversations.get(id) }));
  await choose(created.id);
  expect(bridge.getConversation).toHaveBeenCalledWith(created.id);
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith(created.id);
  await act(async () => { creation.resolve({ success: true, data: created }); });
  expect(bridge.deleteConversation).not.toHaveBeenCalled();
  expect(conversations.has(created.id)).toBe(true);
  expect(bridge.getConversation.mock.calls.filter(call => call[0] === created.id)).toHaveLength(1);
  await act(async () => { lookup.resolve({ success: true, data: created }); });
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith(created.id));
  await act(async () => {});
  typeDraft('Draft in the protected selected conversation.');
  expect(backendActive).toBe(created.id);
  expect(bridge.deleteConversation).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Draft in the protected selected conversation.');
});

test('selection of an unused record is visibly refused while its cleanup deletion awaits acknowledgement', async () => {
  await mountReady();
  const creation = deferred<ConversationReply>();
  let created!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => {
    created = createEmptyConversation('deletion-pending');
    return creation.promise;
  });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await choose('B');
  await expectActive('B');
  typeDraft('B draft survives unused cleanup.');
  const deletion = deferred<Ack>();
  bridge.deleteConversation.mockImplementationOnce(() => deletion.promise);
  await act(async () => { creation.resolve({ success: true, data: created }); });
  await waitFor(() => expect(bridge.deleteConversation).toHaveBeenCalledWith(created.id));
  const readsBeforeSelection = bridge.getConversation.mock.calls.filter(call => call[0] === created.id).length;
  expect(readsBeforeSelection).toBe(1);
  await choose(created.id);
  await screen.findByText('This unused chat is being removed. Choose another conversation.');
  expect(bridge.getConversation.mock.calls.filter(call => call[0] === created.id)).toHaveLength(readsBeforeSelection);
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith(created.id);
  expect(backendActive).toBe('B');
  expect(screen.getByText('Saved reply from B.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('B draft survives unused cleanup.');
  // A failed removal leaves a genuine usable record. Once acknowledged, the
  // temporary exclusion must end so selecting that surviving record works.
  await act(async () => { deletion.resolve({ success: false, error: 'Disposable cleanup refusal.' }); });
  await screen.findByText('HomeBot could not remove an unused empty chat. You can remove it from conversations.');
  await choose(created.id);
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith(created.id));
  await act(async () => {});
  expect(backendActive).toBe(created.id);
  expect(conversations.has(created.id)).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  await choose('B');
  await expectActive('B');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('B draft survives unused cleanup.');
});

test('a superseded New activation removes only its unused created record after the latest selection wins', async () => {
  await mountReady();
  const created = createEmptyConversation('unused-activation');
  bridge.createConversation.mockResolvedValueOnce({ success: true, data: created });
  const activation = deferred<Ack>();
  bridge.setActiveConversation.mockImplementation((id: string) => id === created.id
    ? activation.promise.then(result => { if (result.success) activate(id); return result; })
    : Promise.resolve(activate(id)));
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith(created.id));
  await choose('B');
  typeDraft('A draft written before B finishes opening.');
  await act(async () => { activation.resolve({ success: true }); });
  await expectActive('B');
  await waitFor(() => expect(bridge.deleteConversation).toHaveBeenCalledWith(created.id));
  expect(bridge.deleteConversation.mock.calls.map(call => call[0])).toEqual([created.id]);
  expect(conversations.has('B')).toBe(true);
  expect(backendActive).toBe('B');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('A draft written before B finishes opening.');
});

test('a refused New activation cleans only the unused created record and preserves A and its draft', async () => {
  await mountReady();
  typeDraft('A draft retained after failed New.');
  const created = createEmptyConversation('refused-new');
  bridge.createConversation.mockResolvedValueOnce({ success: true, data: created });
  bridge.setActiveConversation.mockResolvedValueOnce({ success: false, error: 'Disposable activation refusal.' });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await screen.findByText('Could not start a new conversation. Your draft is kept. Please try again.');
  await waitFor(() => expect(bridge.deleteConversation).toHaveBeenCalledWith(created.id));
  expect(bridge.deleteConversation.mock.calls.map(call => call[0])).toEqual([created.id]);
  expect(conversations.has('A')).toBe(true);
  expect(backendActive).toBe('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('A draft retained after failed New.');
});

test('a late Select response cannot override a subsequently acknowledged New conversation', async () => {
  await mountReady();
  typeDraft('A draft before selecting B.');
  const pendingB = deferred<ConversationReply>();
  bridge.getConversation.mockImplementationOnce(() => pendingB.promise);
  await choose('B');
  bridge.createConversation.mockResolvedValueOnce({ success: true, data: conversations.get('D') });
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await waitFor(() => expect(backendActive).toBe('D'));
  typeDraft('New D draft.');
  await act(async () => { pendingB.resolve({ success: true, data: conversations.get('B') }); });
  expect(backendActive).toBe('D');
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith('B');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('New D draft.');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('A draft before selecting B.');
});

test('a refused backend activation preserves the original draft and explains the failure', async () => {
  await mountReady();
  typeDraft('Keep this A draft.');
  await attach('keep-a.txt');
  bridge.setActiveConversation.mockResolvedValueOnce({ success: false, error: 'Disposable activation refusal.' });
  await choose('B');
  expect(await screen.findByText('Could not open that conversation. Your draft is kept. Please try again.')).toBeInTheDocument();
  expect(backendActive).toBe('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this A draft.');
  expect(screen.getByText('keep-a.txt')).toBeInTheDocument();
  expect(screen.queryByText('Saved reply from B.')).toBeNull();
});

test('a delayed send from A cannot appear in B, and the held original bytes are recoverable without replacing newer drafts', async () => {
  await mountReady();
  typeDraft('Summarize my original attachment.');
  await attach('original-notes.txt');
  const inventory = deferred<{ success: boolean; models: { name: string }[] }>();
  bridge.listOllamaModels.mockImplementationOnce(() => inventory.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  typeDraft('Newer A draft must stay intact.');
  await choose('B');
  await expectActive('B');
  typeDraft('Newer B draft must also stay intact.');
  await act(async () => { inventory.resolve({ success: true, models: [{ name: 'qwen2.5:7b' }] }); });
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer B draft must also stay intact.');
  expect(screen.getByText('Saved reply from B.')).toBeInTheDocument();
  expect(screen.queryByText('Summarize my original attachment.')).toBeNull();

  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer A draft must stay intact.');
  expect(screen.getByRole('button', { name: 'Restore held request' })).toBeDisabled();
  expect(screen.queryByText('original-notes.txt')).toBeNull();
  typeDraft('');
  fireEvent.click(screen.getByRole('button', { name: 'Restore held request' }));
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Summarize my original attachment.');
  expect(screen.getByText('original-notes.txt')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore held request' })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.message).toBe('[Document attached: original-notes.txt]\n\nSummarize my original attachment.');
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'original-notes.txt', data: btoa('Exact bytes for original-notes.txt') }));
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test('acknowledged deletion frees held recovery slots, while a failed deletion preserves them', async () => {
  await mountReady();
  for (let index = 0; index < 8; index++) {
    if (index > 0) { await choose('A'); await expectActive('A'); }
    typeDraft(`Earlier A request ${index}.`);
    await attach(`held-a-${index}.txt`);
    const inventory = deferred<{ success: boolean; models: { name: string }[] }>();
    bridge.listOllamaModels.mockImplementationOnce(() => inventory.promise);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    typeDraft(`Newer A request ${index}.`);
    await choose('B');
    await expectActive('B');
    await act(async () => { inventory.resolve({ success: true, models: [{ name: 'qwen2.5:7b' }] }); });
  }
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('button', { name: 'Restore held request' })).toBeDisabled();
  const deletion = deferred<Ack>();
  bridge.deleteConversation.mockImplementationOnce(() => deletion.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  expect(screen.getByRole('button', { name: 'Restore held request' })).toBeDisabled();
  await act(async () => { deletion.resolve({ success: false, error: 'Keep the conversation on failure.' }); });
  expect(await screen.findByText('Keep the conversation on failure.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore held request' })).toBeDisabled();
  expect(conversations.has('A')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Delete Conversation A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  await waitFor(() => expect(conversations.has('A')).toBe(false));
  await choose('B');
  await expectActive('B');
  typeDraft('Recover this B request after deletion.');
  await attach('held-b.txt');
  const inventory = deferred<{ success: boolean; models: { name: string }[] }>();
  bridge.listOllamaModels.mockImplementationOnce(() => inventory.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  typeDraft('Keep the newer B draft.');
  await choose('C');
  await expectActive('C');
  await act(async () => { inventory.resolve({ success: true, models: [{ name: 'qwen2.5:7b' }] }); });
  await choose('B');
  await expectActive('B');
  expect(screen.getByRole('button', { name: 'Restore held request' })).toBeDisabled();
  typeDraft('');
  fireEvent.click(screen.getByRole('button', { name: 'Restore held request' }));
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Recover this B request after deletion.');
  expect(screen.getByText('held-b.txt')).toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.addMessage).not.toHaveBeenCalled();
}, 20_000);

test('a late unsent request for an acknowledged deleted conversation is discarded without becoming a held request in another chat', async () => {
  await mountReady();
  typeDraft('Discard this request with its chat.');
  await attach('deleted-request.txt');
  const inventory = deferred<{ success: boolean; models: { name: string }[] }>();
  bridge.listOllamaModels.mockImplementationOnce(() => inventory.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  await waitFor(() => expect(conversations.has('A')).toBe(false));
  await choose('B');
  await expectActive('B');
  typeDraft('Keep this B draft.');
  await act(async () => { inventory.resolve({ success: true, models: [{ name: 'qwen2.5:7b' }] }); });
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this B draft.');
  expect(screen.queryByRole('button', { name: 'Restore held request' })).toBeNull();
  expect(screen.queryByText('deleted-request.txt')).toBeNull();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.addMessage).not.toHaveBeenCalled();
});

test('a committed user row awaiting acknowledgement becomes recoverable in A without dispatching, restoring or duplicating it in B', async () => {
  await mountReady();
  typeDraft('Summarize these original attachments.');
  await attachPhoto();
  await attach('committed-notes.txt');
  const acknowledgement = deferred<Ack>();
  bridge.addMessage.mockImplementationOnce((id: string, message: Message) => {
    expect(id).toBe('A');
    expect(message.role).toBe('user');
    persistRow(id, message);
    return acknowledgement.promise;
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.addMessage).toHaveBeenCalledTimes(1));
  const committedUser = conversations.get('A')!.messages.find(row => row.role === 'user')!;
  expect(committedUser.content).toContain('[Image attached: original-photo.png]');
  expect(committedUser.content).toContain('[Document attached: committed-notes.txt]');
  expect(committedUser.content).toContain('Summarize these original attachments.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  typeDraft('Newer A draft stays separate.');
  await choose('B');
  await expectActive('B');
  typeDraft('Current B draft stays separate.');
  const originalB = JSON.stringify(conversations.get('B'));
  await act(async () => { acknowledgement.resolve({ success: true }); });
  await waitFor(() => expect(conversations.get('A')!.messages.filter(row => row.role === 'assistant' && row.streamingState === 'error')).toHaveLength(1));
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.subscribeToStream).not.toHaveBeenCalled();
  expect(JSON.stringify(conversations.get('B'))).toBe(originalB);
  expect(screen.getByText('Saved reply from B.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Current B draft stays separate.');
  expect(screen.queryByText(/Summarize these original attachments\./)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore held request' })).toBeNull();

  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer A draft stays separate.');
  expect(screen.queryByRole('button', { name: 'Restore held request' })).toBeNull();
  const recoveryRow = conversations.get('A')!.messages.find(row => row.role === 'assistant' && row.streamingState === 'error')!;
  expect(recoveryRow.error).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.streamId).toBe(recoveryRow.id);
  expect(request.retry).toBe(true);
  expect(request.message).toBe(committedUser.content);
  expect(request.images).toHaveLength(1);
  expect(request.images[0]).toEqual(expect.objectContaining({ filename: 'original-photo.png', data: PHOTO_DATA, mimeType: 'image/png' }));
  expect(request.documents).toHaveLength(1);
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'committed-notes.txt', data: btoa('Exact bytes for committed-notes.txt') }));
  expect(bridge.addMessage.mock.calls.filter(call => call[1].role === 'user')).toHaveLength(1);
  expect(conversations.get('A')!.messages.filter(row => row.role === 'user')).toEqual([committedUser]);
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Newer A draft stays separate.');
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test.each([false, true])('returning to A before recovery persistence acknowledges exposes one Retry control (row already stored: %s)', async rowStoredBeforeAck => {
  await mountReady();
  typeDraft('Review the committed recovery notes.');
  await attach('recovery-notes.txt');
  const userAcknowledgement = deferred<Ack>();
  const recoveryAcknowledgement = deferred<Ack>();
  let recovery!: Message;
  bridge.addMessage.mockImplementation((id: string, message: Message) => {
    if (message.role === 'user') {
      persistRow(id, message);
      return userAcknowledgement.promise;
    }
    recovery = { ...message };
    if (rowStoredBeforeAck) persistRow(id, recovery);
    return recoveryAcknowledgement.promise;
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.addMessage).toHaveBeenCalledTimes(1));
  await choose('B');
  await expectActive('B');
  typeDraft('B recovery-race draft remains intact.');
  await act(async () => { userAcknowledgement.resolve({ success: true }); });
  await waitFor(() => expect(bridge.addMessage).toHaveBeenCalledTimes(2));
  expect(recovery.role).toBe('assistant');
  expect(recovery.streamingState).toBe('error');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  await choose('A');
  await expectActive('A');
  expect(screen.queryAllByRole('button', { name: 'Retry' })).toHaveLength(rowStoredBeforeAck ? 1 : 0);
  await act(async () => {
    if (!rowStoredBeforeAck) persistRow('A', recovery);
    recoveryAcknowledgement.resolve({ success: true });
  });
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1));
  expect(conversations.get('A')!.messages.filter(row => row.id === recovery.id)).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Restore held request' })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.streamId).toBe(recovery.id);
  expect(request.conversation_id).toBe('A');
  expect(request.message).toBe('[Document attached: recovery-notes.txt]\n\nReview the committed recovery notes.');
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'recovery-notes.txt', data: btoa('Exact bytes for recovery-notes.txt') }));
  expect(bridge.addMessage.mock.calls.filter(call => call[1].role === 'user')).toHaveLength(1);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
  await choose('B');
  await expectActive('B');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('B recovery-race draft remains intact.');
});

test('a committed send paused at its title lookup creates a Retry row in A rather than restoring an already persisted draft', async () => {
  await mountReady();
  typeDraft('Explain the first topic.');
  await attach('title-notes.txt');
  const title = deferred<ConversationReply>();
  bridge.getConversation.mockImplementationOnce(() => title.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.getConversation).toHaveBeenCalledWith('A'));
  const committedUser = conversations.get('A')!.messages.find(row => row.role === 'user')!;
  expect(committedUser.content).toBe('[Document attached: title-notes.txt]\n\nExplain the first topic.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  await choose('B');
  await expectActive('B');
  typeDraft('Current B topic.');
  await act(async () => { title.resolve({ success: true, data: conversations.get('A') }); });
  await waitFor(() => expect(conversations.get('A')!.messages.filter(row => row.role === 'assistant' && row.streamingState === 'error')).toHaveLength(1));
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.subscribeToStream).not.toHaveBeenCalled();
  expect(screen.getByText('Saved reply from B.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Current B topic.');
  expect(bridge.saveConversation).not.toHaveBeenCalled();
  expect(conversations.get('B')!.messages).toEqual([expect.objectContaining({ id: 'reply-B', content: 'Saved reply from B.' })]);
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Restore held request' })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.message).toBe(committedUser.content);
  expect(request.retry).toBe(true);
  expect(request.documents).toHaveLength(1);
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'title-notes.txt', data: btoa('Exact bytes for title-notes.txt') }));
  expect(bridge.addMessage.mock.calls.filter(call => call[1].role === 'user')).toHaveLength(1);
  expect(conversations.get('A')!.messages.filter(row => row.role === 'user')).toEqual([committedUser]);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test('confirming an old model suggestion after starting New restores the request instead of dispatching it to the new conversation', async () => {
  bridge.getSettings.mockResolvedValue({ firstRun: false, chatModel: 'qwen2.5:3b', modelRoutingMode: 'prompt', useCustomLLM: false });
  bridge.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }, { name: 'qwen2.5:7b' }] });
  await mountReady();
  typeDraft('Compare two possible solutions.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(await screen.findByText('Suggest Better Model')).toBeInTheDocument();
  const creation = deferred<ConversationReply>();
  bridge.createConversation.mockImplementationOnce(() => creation.promise);
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use suggested model' })); });
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  await act(async () => { creation.resolve({ success: true, data: conversations.get('D') }); });
  await waitFor(() => expect(backendActive).toBe('D'));
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Compare two possible solutions.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});
