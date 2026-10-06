/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import type { Message } from '../../shared/types';

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

beforeEach(() => {
  conversations = new Map(['A', 'B', 'C', 'D'].map(id => [id, conversation(id)]));
  backendActive = null;
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
    deleteConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage: jest.fn().mockResolvedValue({ success: true }),
    updateMessage: jest.fn().mockResolvedValue({ success: true }),
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

async function choose(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByText(`Conversation ${id}`));
}

async function expectActive(id: string) {
  await waitFor(() => expect(backendActive).toBe(id));
  expect(await screen.findByText(`Saved reply from ${id}.`)).toBeInTheDocument();
}

test('failed explicit New reports the failure and retains the current conversation and draft', async () => {
  await mountReady();
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

test('a late New response cannot override a subsequently selected conversation', async () => {
  await mountReady();
  typeDraft('A draft before New.');
  const creation = deferred<ConversationReply>();
  bridge.createConversation.mockImplementationOnce(() => creation.promise);
  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  expect(bridge.createConversation).toHaveBeenCalledTimes(2);
  await choose('B');
  await expectActive('B');
  typeDraft('B draft after selecting B.');
  await act(async () => { creation.resolve({ success: true, data: conversations.get('D') }); });
  expect(backendActive).toBe('B');
  expect(bridge.setActiveConversation).not.toHaveBeenCalledWith('D');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('B draft after selecting B.');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('A draft before New.');
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

test('a send paused while its conversation title loads cannot append a placeholder or dispatch into a new conversation', async () => {
  await mountReady();
  typeDraft('Explain the first topic.');
  const title = deferred<ConversationReply>();
  bridge.getConversation.mockImplementationOnce(() => title.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.getConversation).toHaveBeenCalledWith('A'));
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  await choose('B');
  await expectActive('B');
  typeDraft('Current B topic.');
  await act(async () => { title.resolve({ success: true, data: conversations.get('A') }); });
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.subscribeToStream).not.toHaveBeenCalled();
  expect(screen.getByText('Saved reply from B.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Current B topic.');
  await choose('A');
  await expectActive('A');
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Explain the first topic.');
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
