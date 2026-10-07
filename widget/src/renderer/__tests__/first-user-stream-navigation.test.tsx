/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import type { Message } from '../../shared/types';

// Actual App/chat/sidebar paths, with an isolated conversation store and stream
// transport. No navigation, stream callback, or production component is replaced.
type Conversation = {
  id: string; title: string; messages: Message[]; createdAt: string;
  updatedAt: string; messageCount: number; systemPrompt?: string;
};
type StreamHandlers = {
  onStreamChunk: (payload: { streamId: string; chunk: string }) => void;
  onStreamEnd: (payload: { streamId: string; cancelled: boolean }) => void;
  onStreamError: (payload: { streamId: string; error: string }) => void;
};
type Subscription = { handlers: StreamHandlers; active: boolean; unsubscribe: jest.Mock };
let bridge: Record<string, jest.Mock>;
let conversations: Map<string, Conversation>;
let backendActive: string | null;
let subscriptions: Map<string, Subscription>;
let deliveredCancellations: string[];

const PREFIX = 'Prefix from the dispatched A reply. ';
const SUFFIX = 'Remaining A reply after navigation.';
const TERMINALS = ['finished', 'error', 'cancelled'] as const;
type Terminal = typeof TERMINALS[number];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function conversation(id: string): Conversation {
  return {
    id, title: `Conversation ${id}`, createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z', messageCount: 1,
    messages: [{ id: `reply-${id}`, role: 'assistant', content: `Saved reply from ${id}.`,
      timestamp: '2026-10-07T00:00:00.000Z', streamingState: 'finished' }],
  };
}

function copyRecord(record: Conversation): Conversation {
  return { ...record, messages: record.messages.map(row => ({ ...row })) };
}

function createEmptyConversation(id: string): Conversation {
  const created = { ...conversation(id), messages: [], messageCount: 0 };
  conversations.set(id, created);
  backendActive = id;
  return copyRecord(created);
}

beforeEach(() => {
  conversations = new Map(['A', 'B'].map(id => [id, conversation(id)]));
  backendActive = null;
  subscriptions = new Map();
  deliveredCancellations = [];
  window.localStorage.clear();
  const settings = { firstRun: false, theme: 'dark', chatModel: 'qwen2.5:7b',
    useCustomLLM: false, modelRoutingMode: 'off', uncensoredMode: false };
  bridge = {
    getSettings: jest.fn().mockResolvedValue(settings),
    getWidgetMode: jest.fn().mockResolvedValue(true),
    onWidgetModeChanged: jest.fn(() => jest.fn()),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    resolveActiveModel: jest.fn().mockResolvedValue({ success: true, source: 'local', model: 'qwen2.5:7b' }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }] }),
    loadConversations: jest.fn(async () => ({ success: true,
      data: { conversations: Array.from(conversations.values(), copyRecord) } })),
    createConversation: jest.fn(async () => ({ success: true, data: copyRecord(conversations.get('A')!) })),
    getConversation: jest.fn(async (id: string) => {
      const record = conversations.get(id);
      return { success: !!record, data: record ? copyRecord(record) : undefined };
    }),
    setActiveConversation: jest.fn(async (id: string) => { backendActive = id; return { success: true }; }),
    deleteConversation: jest.fn(async (id: string) => {
      conversations.delete(id);
      if (backendActive === id) backendActive = null;
      return { success: true };
    }),
    addMessage: jest.fn(async (id: string, message: Message) => {
      // Match MemoryManager: add-message can create an absent conversation.
      // This makes an accidental post-delete fallback resurrection observable.
      if (!conversations.has(id)) {
        conversations.set(id, { ...conversation(id), messages: [], messageCount: 0 });
      }
      const record = conversations.get(id)!;
      record.messages.push({ ...message });
      record.messageCount = record.messages.length;
      return { success: true };
    }),
    updateMessage: jest.fn(async (id: string, messageId: string, updates: Partial<Message>) => {
      const row = conversations.get(id)?.messages.find(message => message.id === messageId);
      if (!row) return { success: false, error: 'Missing fixture message' };
      Object.assign(row, updates);
      return { success: true };
    }),
    saveConversation: jest.fn(async (record: Conversation) => {
      conversations.set(record.id, copyRecord(record));
      return { success: true };
    }),
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    writeClipboard: jest.fn().mockResolvedValue({ success: true }),
    subscribeToStream: jest.fn((id: string, handlers: StreamHandlers) => {
      const subscription: Subscription = { handlers, active: true, unsubscribe: jest.fn() };
      subscription.unsubscribe.mockImplementation(() => { subscription.active = false; });
      subscriptions.set(id, subscription);
      return subscription.unsubscribe;
    }),
    cancelStream: jest.fn((id: string) => {
      // Main sends a cancelled end, but an unsubscribed preload listener no
      // longer receives it. Do not manufacture a callback after unsubscribe.
      void Promise.resolve().then(() => {
        const subscription = subscriptions.get(id);
        if (subscription?.active) {
          deliveredCancellations.push(id);
          subscription.handlers.onStreamEnd({ streamId: id, cancelled: true });
        }
      });
    }),
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

async function choose(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  const deleteControl = await screen.findByRole('button', { name: `Delete ${conversations.get(id)!.title}` });
  fireEvent.click(deleteControl.closest('.conversation-item')!);
  await waitFor(() => expect(backendActive).toBe(id));
  expect(await screen.findByText(`Saved reply from ${id}.`)).toBeInTheDocument();
}

async function dispatchA() {
  await mountReady();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), {
    target: { value: 'Continue the A conversation with a detailed reply.' },
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0] as { streamId: string; conversation_id: string };
  expect(request.conversation_id).toBe('A');
  const subscription = subscriptions.get(request.streamId)!;
  expect(subscription).toBeDefined();
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: PREFIX }); });
  expect(screen.getByText(PREFIX.trim())).toBeInTheDocument();
  return { request, subscription };
}

async function terminal(handlers: StreamHandlers, id: string, state: Terminal) {
  await act(async () => {
    if (state === 'error') handlers.onStreamError({ streamId: id, error: 'Fixture A stream failed.' });
    else handlers.onStreamEnd({ streamId: id, cancelled: state === 'cancelled' });
  });
}

async function expectDurableReply(id: string, content: string, state: Terminal) {
  await waitFor(() => expect(conversations.get('A')?.messages.find(row => row.id === id)).toMatchObject({
    content, streamingState: state, error: state === 'error',
  }));
  expect(conversations.get('A')!.messages.filter(row => row.id === id)).toHaveLength(1);
  expect(conversations.get('A')!.messages.filter(row => row.role === 'user')).toHaveLength(1);
}

const navigationCases = ['B', 'New'].flatMap(destination => TERMINALS.map(state => ({ destination, state })));
test.each(navigationCases)('dispatched A preserves the full $state reply after $destination navigation and selection reload', async ({ destination, state }) => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, subscription } = await dispatchA();
  if (destination === 'B') await choose('B');
  else {
    bridge.createConversation.mockImplementationOnce(async () => ({ success: true, data: createEmptyConversation('New') }));
    fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
    await waitFor(() => expect(backendActive).toBe('New'));
    expect(screen.queryByText('Saved reply from A.')).toBeNull();
  }
  const newerDraft = `Keep the current ${destination} draft untouched.`;
  fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: newerDraft } });
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: SUFFIX }); });
  await terminal(subscription.handlers, request.streamId, state);
  expect(screen.queryByText(PREFIX + SUFFIX)).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue(newerDraft);
  expect(backendActive).toBe(destination);
  expect(conversations.get('B')).toEqual(untouchedB);
  if (destination === 'New') expect(conversations.get('New')!.messages).toEqual([]);
  await expectDurableReply(request.streamId, PREFIX + SUFFIX, state);
  expect(subscription.unsubscribe).toHaveBeenCalled();
  await choose('A');
  expect(await screen.findByText(PREFIX + SUFFIX)).toBeInTheDocument();
  expect(document.querySelector(`[data-message-id="${request.streamId}"]`)).toHaveAttribute('data-state', state);
  expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
  expect(conversations.get('B')).toEqual(untouchedB);
});

test('A to B to A before completion retains the original streamed prefix in its durable reply', async () => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, subscription } = await dispatchA();
  await choose('B');
  await choose('A');
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: SUFFIX }); });
  await terminal(subscription.handlers, request.streamId, 'finished');
  await expectDurableReply(request.streamId, PREFIX + SUFFIX, 'finished');
  await choose('B');
  await choose('A');
  expect(await screen.findByText(PREFIX + SUFFIX)).toBeInTheDocument();
  expect(conversations.get('B')).toEqual(untouchedB);
});

test('actual Stop persists the partial cancelled reply before unsubscribe and survives a selection reload', async () => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, subscription } = await dispatchA();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop generating/i })); });
  expect(bridge.cancelStream).toHaveBeenCalledWith(request.streamId);
  expect(deliveredCancellations).toContain(request.streamId);
  expect(subscription.active).toBe(false);
  // Exercise a queued stale callback as well: it must not promote the cancelled
  // reply back to finished or append bytes after the user's Stop.
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: ' Late unwanted bytes.' }); });
  await terminal(subscription.handlers, request.streamId, 'finished');
  await expectDurableReply(request.streamId, PREFIX, 'cancelled');
  await choose('B');
  await choose('A');
  expect(await screen.findByText(PREFIX.trim())).toBeInTheDocument();
  expect(document.querySelector(`[data-message-id="${request.streamId}"]`)).toHaveAttribute('data-state', 'cancelled');
  expect(screen.queryByText(/Late unwanted bytes/)).toBeNull();
  expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
  expect(conversations.get('B')).toEqual(untouchedB);
});

test('a terminal reply waits for its deferred assistant placeholder acknowledgement before updating A', async () => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const assistantAck = deferred<{ success: boolean }>();
  const originalAdd = bridge.addMessage.getMockImplementation()!;
  bridge.addMessage.mockImplementation(async (id: string, message: Message) => {
    if (id === 'A' && message.role === 'assistant') await assistantAck.promise;
    return originalAdd(id, message);
  });
  const { request, subscription } = await dispatchA();
  await choose('B');
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: SUFFIX }); });
  await terminal(subscription.handlers, request.streamId, 'finished');
  try {
    expect(conversations.get('A')!.messages.some(row => row.id === request.streamId)).toBe(false);
    expect(bridge.updateMessage).not.toHaveBeenCalled();
    expect(screen.queryByText(/reply could not be saved/i)).toBeNull();
    expect(backendActive).toBe('B');
  } finally {
    await act(async () => { assistantAck.resolve({ success: true }); });
  }
  await expectDurableReply(request.streamId, PREFIX + SUFFIX, 'finished');
  expect(bridge.updateMessage.mock.calls.filter(([id, messageId]) => id === 'A' && messageId === request.streamId)).toEqual([
    ['A', request.streamId, expect.objectContaining({ content: PREFIX + SUFFIX, streamingState: 'finished', error: false })],
  ]);
  expect(conversations.get('B')).toEqual(untouchedB);
  await choose('A');
  expect(await screen.findByText(PREFIX + SUFFIX)).toBeInTheDocument();
});

test.each(['false acknowledgement', 'rejected'])('a background reply with %s persistence remains reachable for Copy with an honest unsaved warning', async failure => {
  const untouchedB = copyRecord(conversations.get('B')!);
  bridge.updateMessage.mockImplementation(async () => {
    if (failure === 'rejected') throw new Error('Fixture final write rejected.');
    return { success: false, error: 'Fixture final write refused.' };
  });
  const { request, subscription } = await dispatchA();
  await choose('B');
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: SUFFIX }); });
  await terminal(subscription.handlers, request.streamId, 'finished');
  expect((await screen.findAllByText(/reply could not be saved/i)).length).toBeGreaterThan(0);
  expect(conversations.get('A')!.messages.find(row => row.id === request.streamId)).toMatchObject({ content: '', streamingState: 'streaming' });
  expect(screen.queryByText(PREFIX + SUFFIX)).toBeNull();
  expect(backendActive).toBe('B');
  expect(conversations.get('B')).toEqual(untouchedB);
  await choose('A');
  expect(await screen.findByText(PREFIX + SUFFIX)).toBeInTheDocument();
  const reply = document.querySelector<HTMLElement>(`[data-message-id="${request.streamId}"]`)!;
  expect(reply).toHaveAttribute('data-state', 'finished');
  expect(screen.getAllByText(/Copy it before leaving this chat/i).length).toBeGreaterThan(0);
  await act(async () => { fireEvent.click(within(reply).getByRole('button', { name: 'Copy response' })); });
  expect(bridge.writeClipboard).toHaveBeenCalledWith(PREFIX + SUFFIX);
  expect(conversations.get('A')!.messages.find(row => row.id === request.streamId)).toMatchObject({ content: '', streamingState: 'streaming' });
  expect(conversations.get('A')!.messages.filter(row => row.id === request.streamId)).toHaveLength(1);
  expect(conversations.get('B')).toEqual(untouchedB);
});

test.each(TERMINALS)('acknowledged A deletion discards late %s stream callbacks without resurrecting it or changing B', async state => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, subscription } = await dispatchA();
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: `Delete ${conversations.get('A')!.title}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  await waitFor(() => expect(conversations.has('A')).toBe(false));
  await waitFor(() => expect(backendActive).toBeNull());
  const addCount = bridge.addMessage.mock.calls.length;
  const saveCount = bridge.saveConversation.mock.calls.length;
  await choose('B');
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: SUFFIX }); });
  await terminal(subscription.handlers, request.streamId, state);
  expect(conversations.has('A')).toBe(false);
  expect(backendActive).toBe('B');
  expect(conversations.get('B')).toEqual(untouchedB);
  expect(bridge.addMessage.mock.calls.slice(addCount).some(([id]) => id === 'A')).toBe(false);
  expect(bridge.saveConversation.mock.calls.slice(saveCount).some(([record]) => record.id === 'A')).toBe(false);
  expect(screen.queryByText(PREFIX + SUFFIX)).toBeNull();
});

async function failedPlaceholder(storedDespiteFalseAck = false) {
  const originalAdd = bridge.addMessage.getMockImplementation()!;
  let refusePlaceholder = true;
  bridge.addMessage.mockImplementation(async (id: string, message: Message) => {
    if (id === 'A' && message.role === 'assistant' && refusePlaceholder) {
      refusePlaceholder = false;
      if (storedDespiteFalseAck) await originalAdd(id, message);
      return { success: false, error: 'Fixture placeholder acknowledgement failed.' };
    }
    return originalAdd(id, message);
  });
  const started = await dispatchA();
  await act(async () => { started.subscription.handlers.onStreamChunk({ streamId: started.request.streamId, chunk: SUFFIX }); });
  await terminal(started.subscription.handlers, started.request.streamId, 'finished');
  await screen.findByRole('button', { name: 'Retry saving reply' });
  return { ...started, originalAdd };
}

test.each(['missing row', 'stored despite false acknowledgement'])('explicit Retry saving repairs a %s using a fresh A read without duplicate assistant rows', async failure => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, originalAdd } = await failedPlaceholder(failure !== 'missing row');
  expect(conversations.get('A')!.messages.filter(row => row.id === request.streamId)).toHaveLength(failure === 'missing row' ? 0 : 1);
  const originalGet = bridge.getConversation.getMockImplementation()!;
  const originalUpdate = bridge.updateMessage.getMockImplementation()!;
  const events: string[] = [];
  bridge.getConversation.mockClear().mockImplementation(async (id: string) => {
    const result = await originalGet(id);
    events.push(`read-completed:${id}:${result.success}`);
    return result;
  });
  bridge.updateMessage.mockClear().mockImplementation(async (id: string, messageId: string, updates: Partial<Message>) => {
    events.push(`update:${id}`);
    return originalUpdate(id, messageId, updates);
  });
  bridge.addMessage.mockClear().mockImplementation(async (id: string, message: Message) => {
    events.push(`add:${id}`);
    expect(conversations.has(id)).toBe(true);
    return originalAdd(id, message);
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry saving reply' })); });
  await expectDurableReply(request.streamId, PREFIX + SUFFIX, 'finished');
  expect(bridge.getConversation).toHaveBeenCalledWith('A');
  expect(events[0]).toBe('read-completed:A:true');
  expect(bridge.addMessage.mock.calls.filter(([id, message]) => id === 'A' && message.id === request.streamId))
    .toHaveLength(failure === 'missing row' ? 1 : 0);
  if (failure !== 'missing row') expect(bridge.updateMessage).toHaveBeenCalledWith('A', request.streamId, expect.objectContaining({ content: PREFIX + SUFFIX }));
  expect(screen.queryByRole('button', { name: 'Retry saving reply' })).toBeNull();
  await choose('B');
  await choose('A');
  expect(await screen.findByText(PREFIX + SUFFIX)).toBeInTheDocument();
  expect(document.querySelector(`[data-message-id="${request.streamId}"]`)).toHaveAttribute('data-state', 'finished');
  expect(conversations.get('B')).toEqual(untouchedB);
});

test('generation Retry waits for the old terminal save before resetting or dispatching and stale old callbacks cannot overwrite its replacement', async () => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const oldSave = deferred<void>();
  const originalUpdate = bridge.updateMessage.getMockImplementation()!;
  let holdErrorWrite = true;
  bridge.updateMessage.mockImplementation(async (id: string, messageId: string, updates: Partial<Message>) => {
    if (id === 'A' && updates.streamingState === 'error' && holdErrorWrite) {
      holdErrorWrite = false;
      await oldSave.promise;
    }
    return originalUpdate(id, messageId, updates);
  });
  const { request, subscription } = await dispatchA();
  await terminal(subscription.handlers, request.streamId, 'error');
  await waitFor(() => expect(bridge.updateMessage).toHaveBeenCalledWith('A', request.streamId, expect.objectContaining({ streamingState: 'error' })));
  try {
    const reply = document.querySelector<HTMLElement>(`[data-message-id="${request.streamId}"]`)!;
    await act(async () => { fireEvent.click(within(reply).getByRole('button', { name: 'Retry' })); });
    expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1);
    expect(reply).toHaveAttribute('data-state', 'error');
    expect(screen.getByText(PREFIX.trim())).toBeInTheDocument();
  } finally {
    await act(async () => { oldSave.resolve(undefined); });
  }
  await expectDurableReply(request.streamId, PREFIX, 'error');
  const reply = document.querySelector<HTMLElement>(`[data-message-id="${request.streamId}"]`)!;
  await act(async () => { fireEvent.click(within(reply).getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(2));
  const retried = subscriptions.get(request.streamId)!;
  expect(retried).not.toBe(subscription);
  const replacement = 'The new Retry result replaces the earlier failed reply.';
  await act(async () => { retried.handlers.onStreamChunk({ streamId: request.streamId, chunk: replacement }); });
  await terminal(retried.handlers, request.streamId, 'finished');
  await expectDurableReply(request.streamId, replacement, 'finished');
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: ' Stale old content.' }); });
  await terminal(subscription.handlers, request.streamId, 'error');
  await expectDurableReply(request.streamId, replacement, 'finished');
  await choose('B');
  await choose('A');
  expect(await screen.findByText(replacement)).toBeInTheDocument();
  expect(conversations.get('B')).toEqual(untouchedB);
});

test('Retry saving is single flight and acknowledged deletion waits for an already-issued missing-row repair', async () => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, subscription, originalAdd } = await failedPlaceholder();
  const repairWrite = deferred<void>();
  bridge.getConversation.mockClear();
  bridge.addMessage.mockClear().mockImplementation(async (id: string, message: Message) => {
    if (id === 'A' && message.id === request.streamId) await repairWrite.promise;
    return originalAdd(id, message);
  });
  const retry = screen.getByRole('button', { name: 'Retry saving reply' });
  await act(async () => { fireEvent.click(retry); fireEvent.click(retry); });
  await waitFor(() => expect(bridge.addMessage).toHaveBeenCalledTimes(1));
  const readsDuringRepair = bridge.getConversation.mock.calls.length;
  expect(readsDuringRepair).toBeGreaterThan(0);
  await act(async () => { fireEvent.click(retry); });
  expect(bridge.getConversation).toHaveBeenCalledTimes(readsDuringRepair);
  expect(bridge.addMessage).toHaveBeenCalledTimes(1);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${conversations.get('A')!.title}` }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete it' })); });
    expect(bridge.deleteConversation).not.toHaveBeenCalled();
    expect(conversations.has('A')).toBe(true);
    expect(bridge.addMessage).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { repairWrite.resolve(undefined); });
  }
  await waitFor(() => expect(conversations.has('A')).toBe(false));
  expect(bridge.deleteConversation).toHaveBeenCalledTimes(1);
  expect(bridge.deleteConversation).toHaveBeenCalledWith('A');
  const addsAtDeletion = bridge.addMessage.mock.calls.length;
  await act(async () => { subscription.handlers.onStreamChunk({ streamId: request.streamId, chunk: ' Late deleted repair bytes.' }); });
  await terminal(subscription.handlers, request.streamId, 'finished');
  expect(bridge.addMessage).toHaveBeenCalledTimes(addsAtDeletion);
  expect(conversations.has('A')).toBe(false);
  expect(conversations.get('B')).toEqual(untouchedB);
  expect(screen.queryByRole('button', { name: 'Retry saving reply' })).toBeNull();
});

test('a delete intent during the repair lookup prevents a later missing-row add and cannot resurrect the acknowledged deleted chat', async () => {
  const untouchedB = copyRecord(conversations.get('B')!);
  const { request, originalAdd } = await failedPlaceholder();
  const repairRead = deferred<void>();
  const originalGet = bridge.getConversation.getMockImplementation()!;
  bridge.getConversation.mockClear().mockImplementation(async (id: string) => {
    if (id === 'A') await repairRead.promise;
    return originalGet(id);
  });
  bridge.addMessage.mockClear().mockImplementation(originalAdd);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry saving reply' })); });
  await waitFor(() => expect(bridge.getConversation).toHaveBeenCalledWith('A'));
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${conversations.get('A')!.title}` }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete it' })); });
    expect(bridge.deleteConversation).not.toHaveBeenCalled();
    expect(bridge.addMessage).not.toHaveBeenCalled();
  } finally {
    await act(async () => { repairRead.resolve(undefined); });
  }
  await waitFor(() => expect(conversations.has('A')).toBe(false));
  expect(bridge.addMessage).not.toHaveBeenCalled();
  expect(conversations.get('B')).toEqual(untouchedB);
  expect(conversations.has(request.conversation_id)).toBe(false);
});
