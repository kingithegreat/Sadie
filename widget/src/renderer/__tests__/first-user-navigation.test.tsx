/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { resizeImageFile } from '../utils/imageUtils';
import { COMPOSER_DRAFT_RETENTION_LIMITS } from '../utils/composerDraftBudget';
import type { Message } from '../../shared/types';

jest.mock('../utils/imageUtils', () => ({ resizeImageFile: jest.fn() }));

const PHOTO_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=';

type Conversation = { id: string; title: string; messages: Message[]; createdAt: string; updatedAt: string; messageCount: number; systemPrompt?: string };
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

function editGuidelines(prompt: string) {
  if (!screen.queryByRole('textbox', { name: 'Conversation system prompt' })) {
    fireEvent.click(screen.getByRole('button', { name: 'Set chat guidelines' }));
  }
  fireEvent.change(screen.getByRole('textbox', { name: 'Conversation system prompt' }), { target: { value: prompt } });
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

test('rapid guideline edits after acknowledged deletion share one replacement and save the latest edit after activation acknowledgement', async () => {
  await mountReady();
  await deleteActiveA();
  const creation = deferred<ConversationReply>();
  const activation = deferred<Ack>();
  let created!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => { created = createEmptyConversation('guideline-replacement'); return creation.promise; });
  bridge.setActiveConversation.mockImplementationOnce((id: string) => activation.promise.then(reply => { if (reply.success) activate(id); return reply; }));
  editGuidelines('First edit');
  editGuidelines('Second edit');
  editGuidelines('Latest edit before creation');
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  await act(async () => { creation.resolve({ success: true, data: created }); });
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith(created.id));
  expect(bridge.saveConversation).not.toHaveBeenCalled();
  editGuidelines('Latest edit during activation');
  await act(async () => { activation.resolve({ success: true }); });
  await waitFor(() => expect(conversations.get(created.id)?.systemPrompt).toBe('Latest edit during activation'));
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  expect(bridge.saveConversation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Latest edit during activation');
  expect(conversations.has('A')).toBe(false);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test.each(['finished', 'cancelled', 'error'] as const)('the first reply after active deletion persists its %s content to the actual replacement and survives selection reload', async terminalState => {
  await mountReady();
  await deleteActiveA();
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('first-reply-replacement') }));
  typeDraft('Please provide a detailed first reply in the replacement conversation after the original chat is deleted.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('first-reply-replacement');
  const handlers = bridge.subscribeToStream.mock.calls[0][1];
  const content = `Replacement reply preserved as ${terminalState}.`;
  await act(async () => { handlers.onStreamChunk({ streamId: request.streamId, chunk: content }); });
  await act(async () => {
    if (terminalState === 'error') handlers.onStreamError({ streamId: request.streamId, error: 'Fixture stream refused.' });
    else handlers.onStreamEnd({ streamId: request.streamId, cancelled: terminalState === 'cancelled' });
  });
  await waitFor(() => expect(conversations.get(request.conversation_id)?.messages.find(row => row.id === request.streamId)).toEqual(expect.objectContaining({
    role: 'assistant', content, streamingState: terminalState, error: terminalState === 'error',
  })));
  expect(bridge.updateMessage.mock.calls.filter(call => call[1] === request.streamId)).toEqual([
    [request.conversation_id, request.streamId, expect.objectContaining({ content, streamingState: terminalState })],
  ]);
  expect(conversations.has('A')).toBe(false);
  expect(conversations.get('B')!.messages).toEqual([expect.objectContaining({ id: 'reply-B', content: 'Saved reply from B.' })]);
  await choose('B');
  await expectActive('B');
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByText(conversations.get(request.conversation_id)!.title));
  await waitFor(() => expect(backendActive).toBe(request.conversation_id));
  expect(await screen.findByText(content)).toBeInTheDocument();
  expect(document.querySelector(`[data-message-id="${request.streamId}"]`)).toHaveAttribute('data-state', terminalState);
  expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
});

test('Retry of a replacement chat reply keeps original document bytes and persists completion to that same replacement', async () => {
  await mountReady();
  await deleteActiveA();
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('retry-replacement') }));
  typeDraft('Summarize the original attached notes in this replacement conversation without dropping their contents.');
  await attach('replacement-retry.txt');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const original = bridge.sendStreamMessage.mock.calls[0][0];
  const firstHandlers = bridge.subscribeToStream.mock.calls[0][1];
  await act(async () => { firstHandlers.onStreamChunk({ streamId: original.streamId, chunk: 'Original partial replacement reply.' }); });
  await act(async () => { firstHandlers.onStreamError({ streamId: original.streamId, error: 'Fixture interrupted stream.' }); });
  await waitFor(() => expect(conversations.get('retry-replacement')?.messages.find(row => row.id === original.streamId)?.streamingState).toBe('error'));
  await choose('B');
  await expectActive('B');
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByText(conversations.get('retry-replacement')!.title));
  await waitFor(() => expect(backendActive).toBe('retry-replacement'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(2));
  const retry = bridge.sendStreamMessage.mock.calls[1][0];
  expect(retry.conversation_id).toBe(original.conversation_id);
  expect(retry.streamId).toBe(original.streamId);
  expect(retry.retry).toBe(true);
  expect(retry.message).toBe(original.message);
  expect(retry.documents).toEqual(original.documents);
  const retryHandlers = bridge.subscribeToStream.mock.calls[1][1];
  await act(async () => { retryHandlers.onStreamChunk({ streamId: retry.streamId, chunk: 'Completed replacement reply after Retry.' }); });
  await act(async () => { retryHandlers.onStreamEnd({ streamId: retry.streamId, cancelled: false }); });
  await waitFor(() => expect(conversations.get('retry-replacement')?.messages.find(row => row.id === retry.streamId)).toEqual(expect.objectContaining({
    content: 'Completed replacement reply after Retry.', streamingState: 'finished', error: false,
  })));
  expect(conversations.get('retry-replacement')!.messages.filter(row => row.role === 'user')).toHaveLength(1);
  expect(bridge.updateMessage.mock.calls.filter(call => call[1] === retry.streamId).every(call => call[0] === 'retry-replacement')).toBe(true);
  expect(conversations.has('A')).toBe(false);
  expect(conversations.get('B')!.messages).toEqual([expect.objectContaining({ id: 'reply-B', content: 'Saved reply from B.' })]);
  await choose('B');
  await expectActive('B');
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByText(conversations.get('retry-replacement')!.title));
  await waitFor(() => expect(backendActive).toBe('retry-replacement'));
  expect(await screen.findByText('Completed replacement reply after Retry.')).toBeInTheDocument();
  expect(document.querySelector(`[data-message-id="${retry.streamId}"]`)).toHaveAttribute('data-state', 'finished');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

test('guideline adoption keeps the same nonempty composer and document recoverable without a null-ID ghost draft', async () => {
  await mountReady();
  await deleteActiveA();
  typeDraft('Keep this same-chat request.');
  await attach('same-chat-guidelines.txt');
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('same-composer') }));
  editGuidelines('Guidelines for the same composer.');
  await waitFor(() => expect(conversations.get('same-composer')?.systemPrompt).toBe('Guidelines for the same composer.'));
  expect(inputValue()).toBe('Keep this same-chat request.');
  expect(screen.getByText('same-chat-guidelines.txt')).toBeInTheDocument();
  await choose('B');
  await expectActive('B');
  await choose('same-composer');
  await waitFor(() => expect(backendActive).toBe('same-composer'));
  expect(inputValue()).toBe('Keep this same-chat request.');
  expect(screen.getByText('same-chat-guidelines.txt')).toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('guideline adoption at eight inactive drafts adds no inaccessible new-key draft and retained chats remain recoverable', async () => {
  await fillInactiveDraftCapacity();
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation budget-7' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  await waitFor(() => expect(backendActive).toBeNull());
  typeDraft('Same active composer at full inactive capacity.');
  await attach('full-capacity-guidelines.txt');
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('full-capacity-guidelines') }));
  editGuidelines('Keep these guidelines without retaining the active composer twice.');
  await waitFor(() => expect(conversations.get('full-capacity-guidelines')?.systemPrompt).toBe('Keep these guidelines without retaining the active composer twice.'));
  expect(backendActive).toBe('full-capacity-guidelines');
  expect(inputValue()).toBe('Same active composer at full inactive capacity.');
  expect(screen.getByText('full-capacity-guidelines.txt')).toBeInTheDocument();
  expect(screen.queryByText('Too many unfinished chats. Send or clear a draft before switching chats. Your current draft is kept.')).toBeNull();
  typeDraft('');
  fireEvent.click(screen.getByRole('button', { name: 'Remove full-capacity-guidelines.txt' }));
  await choose('budget-0');
  await expectActive('budget-0');
  expect(inputValue()).toBe('Retained budget-0 request.');
  const creates = bridge.createConversation.mock.calls.length;
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('no-ghost-capacity') }));
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await waitFor(() => expect(backendActive).toBe('no-ghost-capacity'));
  expect(bridge.createConversation).toHaveBeenCalledTimes(creates + 1);
  await choose('budget-1');
  await expectActive('budget-1');
  expect(inputValue()).toBe('Retained budget-1 request.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('guideline adoption exempts active attachment bytes while ordinary New still enforces inactive byte capacity', async () => {
  await mountReady();
  await deleteActiveA();
  typeDraft('Active bytes stay in this composer.');
  await attach('active-byte-guidelines.txt');
  const limits = COMPOSER_DRAFT_RETENTION_LIMITS as { maxEstimatedBytes: number };
  const originalLimit = limits.maxEstimatedBytes;
  // Exercise the real App retention branch with ordinary file bytes, without
  // allocating a production-sized 128 MiB fixture in the test runner.
  limits.maxEstimatedBytes = 64;
  try {
    bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('active-byte-guidelines') }));
    editGuidelines('Keep the same active attachment bytes.');
    await waitFor(() => expect(conversations.get('active-byte-guidelines')?.systemPrompt).toBe('Keep the same active attachment bytes.'));
    expect(inputValue()).toBe('Active bytes stay in this composer.');
    expect(screen.getByText('active-byte-guidelines.txt')).toBeInTheDocument();
    const creates = bridge.createConversation.mock.calls.length;
    fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
    expect(bridge.createConversation).toHaveBeenCalledTimes(creates);
    expect(await screen.findByText('These unfinished chats contain too many files to keep while switching. Send a draft or remove some attachments first. Your current draft is kept.')).toBeInTheDocument();
    expect(backendActive).toBe('active-byte-guidelines');
  } finally {
    limits.maxEstimatedBytes = originalLimit;
  }
});

test.each(['New', 'Select'])('failed %s keeps unsaved current A guidelines eligible for Send retry', async navigation => {
  await mountReady();
  bridge.saveConversation.mockResolvedValueOnce({ success: false, error: 'Fixture save refused.' });
  editGuidelines('Retry these exact current A guidelines.');
  await screen.findByText('Could not save these chat guidelines. Your edits are kept. Edit them again or retry your message.');
  if (navigation === 'New') {
    bridge.createConversation.mockResolvedValueOnce({ success: false, error: 'Fixture New refused.' });
    fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
    await screen.findByText('Could not start a new conversation. Your draft is kept. Please try again.');
  } else {
    bridge.getConversation.mockResolvedValueOnce({ success: false, error: 'Fixture Select refused.' });
    await choose('B');
    await screen.findByText('Could not open that conversation. Your draft is kept. Please try again.');
  }
  typeDraft('Send the request after failed navigation.');
  await attach('failed-navigation-guidelines.txt');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.conversationPrompt).toBe('Retry these exact current A guidelines.');
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'failed-navigation-guidelines.txt', data: btoa('Exact bytes for failed-navigation-guidelines.txt') }));
  expect(conversations.get('A')?.systemPrompt).toBe('Retry these exact current A guidelines.');
  // The new user turn also saves its automatic title after the guideline retry.
  expect(bridge.saveConversation.mock.calls.filter(([record]) => record.title === 'Conversation A')).toHaveLength(2);
  expect(backendActive).toBe('A');
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test.each(['New', 'Select'])('failed %s during null-editor creation preserves latest guidelines and sends only through their replacement', async navigation => {
  await mountReady();
  await deleteActiveA();
  const creation = deferred<ConversationReply>();
  let unused!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => { unused = createEmptyConversation('stale-null-guidelines'); return creation.promise; });
  editGuidelines('First pending null-editor guidelines.');
  // Select exercises a direct Send retry with no edit after the failed switch;
  // New exercises an additional edit while the old creation is still pending.
  if (navigation === 'Select') editGuidelines('Latest null-editor guidelines.');
  if (navigation === 'New') {
    bridge.createConversation.mockResolvedValueOnce({ success: false, error: 'Fixture New refused.' });
    fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
    await screen.findByText('Could not start a new conversation. Your draft is kept. Please try again.');
  } else {
    bridge.getConversation.mockResolvedValueOnce({ success: false, error: 'Fixture Select refused.' });
    await choose('B');
    await screen.findByText('Could not open that conversation. Your draft is kept. Please try again.');
  }
  const createsBeforeRetry = bridge.createConversation.mock.calls.length;
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('rebased-null-guidelines') }));
  if (navigation === 'New') editGuidelines('Latest null-editor guidelines.');
  typeDraft('Send only with my latest guidelines.');
  await attach('null-editor-guidelines.txt');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(bridge.createConversation).toHaveBeenCalledTimes(createsBeforeRetry);
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  await act(async () => { creation.resolve({ success: true, data: unused }); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('rebased-null-guidelines');
  expect(request.conversationPrompt).toBe('Latest null-editor guidelines.');
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'null-editor-guidelines.txt', data: btoa('Exact bytes for null-editor-guidelines.txt') }));
  expect(conversations.get('rebased-null-guidelines')?.systemPrompt).toBe('Latest null-editor guidelines.');
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Latest null-editor guidelines.');
  expect(bridge.createConversation).toHaveBeenCalledTimes(createsBeforeRetry + 1);
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith(unused.id);
  expect(bridge.deleteConversation).toHaveBeenCalledWith(unused.id);
  expect(conversations.has(unused.id)).toBe(false);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test('successful navigation still invalidates a rebased null-editor request awaiting its older creation', async () => {
  await mountReady();
  await deleteActiveA();
  const creation = deferred<ConversationReply>();
  let unused!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => { unused = createEmptyConversation('unused-rebased-guidelines'); return creation.promise; });
  editGuidelines('Old pending guidelines.');
  bridge.getConversation.mockResolvedValueOnce({ success: false, error: 'Fixture Select refused.' });
  await choose('B');
  await screen.findByText('Could not open that conversation. Your draft is kept. Please try again.');
  editGuidelines('Rebased guidelines that still belong to the original editor.');
  typeDraft('Original editor request.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await choose('B');
  await expectActive('B');
  typeDraft('Keep the successfully selected B draft.');
  await act(async () => { creation.resolve({ success: true, data: unused }); });
  await waitFor(() => expect(conversations.has(unused.id)).toBe(false));
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(backendActive).toBe('B');
  expect(inputValue()).toBe('Keep the successfully selected B draft.');
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('');
});

test('Send during guideline creation uses that same acknowledged replacement, its latest guidelines and unchanged document bytes', async () => {
  await mountReady();
  await deleteActiveA();
  const creation = deferred<ConversationReply>();
  let created!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => { created = createEmptyConversation('guideline-send'); return creation.promise; });
  editGuidelines('Initial guidelines');
  typeDraft('Summarize the original notes.');
  await attach('guideline-notes.txt');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  editGuidelines('Use these latest guidelines.');
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.addMessage).not.toHaveBeenCalled();
  await act(async () => { creation.resolve({ success: true, data: created }); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe(created.id);
  expect(request.conversationPrompt).toBe('Use these latest guidelines.');
  expect(request.message).toBe('[Document attached: guideline-notes.txt]\n\nSummarize the original notes.');
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'guideline-notes.txt', data: btoa('Exact bytes for guideline-notes.txt') }));
  expect(conversations.get(created.id)?.systemPrompt).toBe('Use these latest guidelines.');
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  expect(bridge.setActiveConversation).toHaveBeenCalledWith(created.id);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test('navigation during replacement guideline creation cannot adopt the stale chat or replace B guidelines and draft', async () => {
  conversations.get('B')!.systemPrompt = 'Saved B guidelines.';
  await mountReady();
  await deleteActiveA();
  const creation = deferred<ConversationReply>();
  let created!: Conversation;
  bridge.createConversation.mockImplementationOnce(() => { created = createEmptyConversation('unused-guideline'); return creation.promise; });
  editGuidelines('Guidelines for the pending replacement.');
  await choose('B');
  await expectActive('B');
  typeDraft('Keep B words.');
  await attach('keep-b-guidelines.txt');
  await act(async () => { creation.resolve({ success: true, data: created }); });
  await waitFor(() => expect(conversations.has(created.id)).toBe(false));
  expect(backendActive).toBe('B');
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith(created.id);
  expect(bridge.saveConversation).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Saved B guidelines.');
  expect(inputValue()).toBe('Keep B words.');
  expect(screen.getByText('keep-b-guidelines.txt')).toBeInTheDocument();
});

test.each(['create', 'activate'])('failed guideline replacement %s keeps the acknowledged deletion and latest edits, then retries safely', async failure => {
  await mountReady();
  await deleteActiveA();
  if (failure === 'create') bridge.createConversation.mockResolvedValueOnce({ success: false, error: 'Fixture creation unavailable.' });
  else {
    bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('refused-guideline') }));
    bridge.setActiveConversation.mockResolvedValueOnce({ success: false, error: 'Fixture activation unavailable.' });
  }
  editGuidelines('Keep these unsaved guidelines.');
  await screen.findByText('Could not open a chat for these guidelines. Your edits are kept. Edit them again or retry your message.');
  expect(conversations.has('A')).toBe(false);
  expect(backendActive).toBeNull();
  expect(bridge.saveConversation).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Keep these unsaved guidelines.');
  bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('retried-guideline') }));
  editGuidelines('Keep these latest retried guidelines.');
  await waitFor(() => expect(conversations.get('retried-guideline')?.systemPrompt).toBe('Keep these latest retried guidelines.'));
  expect(backendActive).toBe('retried-guideline');
  expect(bridge.createConversation).toHaveBeenCalledTimes(3);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('guideline reads and saves are serialized so older replies cannot overwrite later edits', async () => {
  await mountReady();
  const lookup = deferred<ConversationReply>();
  const write = deferred<Ack>();
  bridge.getConversation.mockReturnValueOnce(lookup.promise);
  bridge.saveConversation.mockImplementationOnce((record: Conversation) => write.promise.then(reply => { if (reply.success) saveRecord(record); return reply; }));
  editGuidelines('Old edit');
  await waitFor(() => expect(bridge.getConversation).toHaveBeenCalledTimes(1));
  editGuidelines('Later edit before lookup returns');
  expect(bridge.getConversation).toHaveBeenCalledTimes(1);
  await act(async () => { lookup.resolve({ success: true, data: copyRecord(conversations.get('A')!) }); });
  await waitFor(() => expect(bridge.saveConversation).toHaveBeenCalledTimes(1));
  expect(bridge.saveConversation.mock.calls[0][0].systemPrompt).toBe('Later edit before lookup returns');
  const readsDuringSave = bridge.getConversation.mock.calls.length;
  editGuidelines('Newest edit while save awaits');
  expect(bridge.getConversation).toHaveBeenCalledTimes(readsDuringSave);
  expect(bridge.saveConversation).toHaveBeenCalledTimes(1);
  await act(async () => { write.resolve({ success: true }); });
  await waitFor(() => expect(conversations.get('A')?.systemPrompt).toBe('Newest edit while save awaits'));
  expect(bridge.saveConversation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Newest edit while save awaits');
});

test('Send waits for an existing guideline snapshot and save so that snapshot cannot remove the new user turn', async () => {
  await mountReady();
  const lookup = deferred<ConversationReply>();
  const write = deferred<Ack>();
  const captured = copyRecord(conversations.get('A')!);
  bridge.getConversation.mockReturnValueOnce(lookup.promise);
  bridge.saveConversation.mockImplementationOnce((record: Conversation) => write.promise.then(reply => { if (reply.success) saveRecord(record); return reply; }));
  editGuidelines('Guidelines saved before this message.');
  await waitFor(() => expect(bridge.getConversation).toHaveBeenCalledTimes(1));
  typeDraft('Send the original request after the guidelines.');
  await attach('ordered-guidelines.txt');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  await act(async () => { lookup.resolve({ success: true, data: captured }); });
  await waitFor(() => expect(bridge.saveConversation).toHaveBeenCalledTimes(1));
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  await act(async () => { write.resolve({ success: true }); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.conversationPrompt).toBe('Guidelines saved before this message.');
  expect(request.documents[0]).toEqual(expect.objectContaining({ filename: 'ordered-guidelines.txt', data: btoa('Exact bytes for ordered-guidelines.txt') }));
  expect(conversations.get('A')!.messages.filter(message => message.role === 'user')).toEqual([expect.objectContaining({ content: request.message })]);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test('an A guideline read finishing after navigation saves only A and preserves B guidelines and draft', async () => {
  conversations.get('B')!.systemPrompt = 'Saved B guidelines.';
  await mountReady();
  const lookup = deferred<ConversationReply>();
  const captured = copyRecord(conversations.get('A')!);
  bridge.getConversation.mockReturnValueOnce(lookup.promise);
  editGuidelines('Captured A guidelines.');
  await waitFor(() => expect(bridge.getConversation).toHaveBeenCalledTimes(1));
  await choose('B');
  await expectActive('B');
  typeDraft('Current B request.');
  await attach('current-b-guidelines.txt');
  await act(async () => { lookup.resolve({ success: true, data: captured }); });
  await waitFor(() => expect(conversations.get('A')?.systemPrompt).toBe('Captured A guidelines.'));
  expect(bridge.saveConversation).toHaveBeenCalledTimes(1);
  expect(bridge.saveConversation.mock.calls[0][0].id).toBe('A');
  expect(backendActive).toBe('B');
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Saved B guidelines.');
  expect(inputValue()).toBe('Current B request.');
  expect(screen.getByText('current-b-guidelines.txt')).toBeInTheDocument();
  expect(conversations.get('B')?.systemPrompt).toBe('Saved B guidelines.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test.each(['read', 'save'])('a failed guideline %s retains the latest A text through navigation and same-text retry', async failure => {
  await mountReady();
  if (failure === 'read') bridge.getConversation.mockResolvedValueOnce({ success: false, error: 'Fixture read refused.' });
  else bridge.saveConversation.mockResolvedValueOnce({ success: false, error: 'Fixture save refused.' });
  editGuidelines('Keep the latest failed A edit.');
  await screen.findByText('Could not save these chat guidelines. Your edits are kept. Edit them again or retry your message.');
  expect(conversations.get('A')?.systemPrompt).toBeUndefined();
  await choose('B');
  await expectActive('B');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Keep the latest failed A edit.');
  expect(await screen.findByText('These chat guidelines have not been saved. Your edits are kept; edit them again or send a message to retry.')).toBeInTheDocument();
  typeDraft('Retry this request with my retained guidelines.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.conversationPrompt).toBe('Keep the latest failed A edit.');
  expect(conversations.get('A')?.systemPrompt).toBe('Keep the latest failed A edit.');
  expect(bridge.createConversation).toHaveBeenCalledTimes(1);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test('oversized guideline edits are refused visibly without replacing the last acknowledged text', async () => {
  await mountReady();
  editGuidelines('Keep these acknowledged guidelines.');
  await waitFor(() => expect(conversations.get('A')?.systemPrompt).toBe('Keep these acknowledged guidelines.'));
  const writes = bridge.saveConversation.mock.calls.length;
  editGuidelines('x'.repeat(64 * 1024 + 1));
  expect(await screen.findByText('These guidelines exceed the limit for unsaved edits. Your previous text is kept. Save or shorten existing guidelines before adding more.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Keep these acknowledged guidelines.');
  expect(conversations.get('A')?.systemPrompt).toBe('Keep these acknowledged guidelines.');
  expect(bridge.saveConversation).toHaveBeenCalledTimes(writes);
});

test('returning A through B does not allow a newer A guideline save to overtake its prior pending save', async () => {
  await mountReady();
  const oldWrite = deferred<Ack>();
  bridge.saveConversation.mockImplementationOnce((record: Conversation) => oldWrite.promise.then(reply => { if (reply.success) saveRecord(record); return reply; }));
  editGuidelines('Old A guidelines waiting for acknowledgement.');
  await waitFor(() => expect(bridge.saveConversation).toHaveBeenCalledTimes(1));
  await choose('B');
  await expectActive('B');
  await choose('A');
  await expectActive('A');
  editGuidelines('New A guidelines must win.');
  await act(async () => {});
  expect(bridge.saveConversation).toHaveBeenCalledTimes(1);
  await act(async () => { oldWrite.resolve({ success: true }); });
  await waitFor(() => expect(conversations.get('A')?.systemPrompt).toBe('New A guidelines must win.'));
  expect(bridge.saveConversation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('New A guidelines must win.');
  expect(conversations.get('B')?.systemPrompt).toBeUndefined();
});

test('failed guideline save blocks Send without losing the message and retries against the same chat', async () => {
  await mountReady();
  bridge.saveConversation.mockResolvedValue({ success: false, error: 'Fixture save refused.' });
  editGuidelines('Unacknowledged guidelines.');
  await screen.findByText('Could not save these chat guidelines. Your edits are kept. Edit them again or retry your message.');
  typeDraft('Keep my unsent request.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await screen.findByText('This request was not sent because its chat guidelines could not be saved. Your message is kept. Retry after saving the guidelines.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(inputValue()).toBe('Keep my unsent request.');
  bridge.saveConversation.mockImplementation(async (record: Conversation) => saveRecord(record));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  expect(request.conversation_id).toBe('A');
  expect(request.conversationPrompt).toBe('Unacknowledged guidelines.');
  expect(request.message).toBe('Keep my unsent request.');
  expect(bridge.createConversation).toHaveBeenCalledTimes(1);
  act(() => { bridge.subscribeToStream.mock.calls[0][1].onStreamEnd({ streamId: request.streamId, cancelled: false }); });
});

test.each([true, false])('deletion waits for an issued guideline write and never resurrects the record (both acknowledgements succeed: %s)', async success => {
  await mountReady();
  const write = deferred<Ack>();
  bridge.saveConversation.mockImplementationOnce((record: Conversation) => write.promise.then(reply => { if (reply.success) saveRecord(record); return reply; }));
  if (!success) bridge.deleteConversation.mockResolvedValueOnce({ success: false, error: 'Fixture deletion refused.' });
  editGuidelines('First pending guideline save.');
  await waitFor(() => expect(bridge.saveConversation).toHaveBeenCalledTimes(1));
  await deleteA();
  expect(bridge.deleteConversation).not.toHaveBeenCalled();
  editGuidelines('Latest edits during pending deletion.');
  await act(async () => { write.resolve({ success, error: success ? undefined : 'Fixture save refused.' }); });
  await waitFor(() => expect(bridge.deleteConversation).toHaveBeenCalledWith('A'));
  expect(bridge.saveConversation).toHaveBeenCalledTimes(1);
  if (success) {
    expect(conversations.has('A')).toBe(false);
    expect(backendActive).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('');
  } else {
    await screen.findByText('Fixture deletion refused.');
    expect(screen.getByText('Could not save these chat guidelines. Your edits are kept. Edit them again or retry your message.')).toBeInTheDocument();
    expect(conversations.has('A')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Conversation system prompt' })).toHaveValue('Latest edits during pending deletion.');
    editGuidelines('Latest edits after failed deletion.');
    await waitFor(() => expect(conversations.get('A')?.systemPrompt).toBe('Latest edits after failed deletion.'));
  }
  expect(conversations.get('B')!.messages).toHaveLength(1);
});

function inputValue() { return (screen.getByRole('textbox', { name: 'Message HomeBot' }) as HTMLTextAreaElement).value; }

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
