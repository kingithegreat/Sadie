/** @jest-environment jsdom */

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import type { Message } from '../../shared/types';

jest.useFakeTimers();

let _endHandler: any;

// Provide a fully mocked preload API
beforeEach(() => {
  _endHandler = undefined;

  (window as any).electron = {
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    cancelStream: jest.fn(),
    subscribeToStream: jest.fn((_sid: string, handlers: any) => {
      _endHandler = handlers.onStreamEnd;
      return jest.fn();
    }),
    onStreamError: jest.fn(),
    getSettings: jest.fn().mockResolvedValue({ firstRun: false, modelRoutingMode: 'off', alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'cancel-confirmation-fixture', systemPrompt: '' } }),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    onMessage: jest.fn(() => jest.fn()),
    sendMessage: jest.fn(),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' })
  } as any;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('cancel-confirmation flow', () => {
  test('user clicks cancel → immediate optimistic UI → onStreamEnd({ cancelled:true }) finalizes state', async () => {
    // We'll send a message to ensure App registers stream handlers and we can capture the streamId
    let capturedStreamId: string | undefined;
    (window as any).electron.sendStreamMessage = jest.fn((payload: any) => {
      capturedStreamId = payload.streamId;
      return Promise.resolve();
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true'));

    // send a message to create streaming assistant
    const textarea = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Start cancel test' } });
    const sendBtn = screen.getByText('Send');
    fireEvent.click(sendBtn);

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    expect(capturedStreamId).toBeDefined();

    // Cancel button should be visible for the streaming assistant message
    const cancelBtn = await screen.findByRole('button', { name: /stop generating/i });
    expect(cancelBtn).toBeInTheDocument();

    // Act: user clicks cancel
    fireEvent.click(cancelBtn);

    // Optimistic UI: immediately show cancelled badge and no cancel button
    expect((window as any).electron.cancelStream).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();

    // Now simulate proxy confirmation: our mocked subscribeToStream captured the handler
    expect(typeof _endHandler).toBe('function');
    act(() => {
      _endHandler({ streamId: capturedStreamId, cancelled: true });
    });

    // Confirm final authoritative state: cancelled badge still present
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
  });

  test('cancel + onStreamEnd without cancelled flag → should finalize but not mark cancelled', async () => {
    

    // second scenario: send a new message so handlers are registered
    let capturedStreamId2: string | undefined;
    (window as any).electron.sendStreamMessage = jest.fn((payload: any) => { capturedStreamId2 = payload.streamId; return Promise.resolve(); });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true'));

    const textarea2 = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
    fireEvent.change(textarea2, { target: { value: 'Start cancel test 2' } });
    const sendBtn2 = screen.getByText('Send');
    fireEvent.click(sendBtn2);

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    expect(capturedStreamId2).toBeDefined();

    const cancelBtn2 = await screen.findByRole('button', { name: /stop generating/i });
    fireEvent.click(cancelBtn2);

    // optimistic cancel
    expect((window as any).electron.cancelStream).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();

    // simulate proxy end without cancelled flag
    expect(typeof _endHandler).toBe('function');
    act(() => {
      _endHandler({ streamId: capturedStreamId2 });
    });

    // authoritative state: cancelled badge should DISAPPEAR (proxy did not confirm cancellation)
    expect(screen.queryByText(/cancelled/i)).toBeNull();
  });
});

type StopSubscription = {
  active: boolean;
  handlers: {
    onStreamChunk: (payload: { streamId: string; chunk: string }) => void;
    onStreamEnd: (payload: { streamId: string; cancelled?: boolean }) => void;
  };
  unsubscribe: jest.Mock;
};

function heldStopWrite() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function durableStopFixture() {
  const messages: Message[] = [];
  const subscriptions: StopSubscription[] = [];
  const api = (window as any).electron;
  api.addMessage = jest.fn(async (_id: string, message: Message) => {
    messages.push({ ...message });
    return { success: true };
  });
  api.updateMessage = jest.fn(async (_id: string, messageId: string, updates: Partial<Message>) => {
    const row = messages.find(message => message.id === messageId);
    if (!row) return { success: false };
    Object.assign(row, updates);
    return { success: true };
  });
  api.subscribeToStream = jest.fn((_id: string, handlers: StopSubscription['handlers']) => {
    const subscription: StopSubscription = { active: true, handlers, unsubscribe: jest.fn() };
    subscription.unsubscribe.mockImplementation(() => { subscription.active = false; });
    subscriptions.push(subscription);
    return subscription.unsubscribe;
  });
  return { api, messages, subscriptions };
}

async function startStoppedReply(fixture: ReturnType<typeof durableStopFixture>) {
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true'));
  fireEvent.change(screen.getByLabelText('Message HomeBot'), { target: { value: 'Explain the stopped reply.' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await waitFor(() => expect(fixture.api.sendStreamMessage).toHaveBeenCalledTimes(1));
  const streamId = fixture.api.sendStreamMessage.mock.calls[0][0].streamId as string;
  const subscription = fixture.subscriptions[0];
  await act(async () => { subscription.handlers.onStreamChunk({ streamId, chunk: 'Durable stopped content.' }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop generating' })); });
  expect(subscription.active).toBe(true);
  return { streamId, subscription };
}

function deliverStopEnd(subscription: StopSubscription, streamId: string, cancelled?: boolean) {
  // Match preload: an unsubscribed listener cannot receive a genuine end.
  expect(subscription.active).toBe(true);
  subscription.handlers.onStreamEnd({ streamId, ...(cancelled === undefined ? {} : { cancelled }) });
}

test('genuine Stop confirmation serializes status after a held partial save without replacing stopped content', async () => {
  const fixture = durableStopFixture();
  const held = heldStopWrite();
  const originalUpdate = fixture.api.updateMessage.getMockImplementation();
  fixture.api.updateMessage.mockImplementation(async (id: string, messageId: string, updates: Partial<Message>) => {
    if (updates.streamingState === 'cancelled') await held.promise;
    return originalUpdate(id, messageId, updates);
  });
  const { streamId, subscription } = await startStoppedReply(fixture);
  await waitFor(() => expect(fixture.api.updateMessage).toHaveBeenCalledTimes(1));
  try {
    await act(async () => { deliverStopEnd(subscription, streamId); });
    expect(subscription.active).toBe(false);
    expect(screen.queryByText(/cancelled/i)).toBeNull();
    expect(fixture.api.updateMessage).toHaveBeenCalledTimes(1);
    await act(async () => { subscription.handlers.onStreamChunk({ streamId, chunk: ' Late bytes.' }); });
    expect(screen.queryByText('Durable stopped content. Late bytes.')).toBeNull();
  } finally {
    await act(async () => { held.resolve(); });
  }
  await waitFor(() => expect(fixture.messages.find(message => message.id === streamId))
    .toMatchObject({ content: 'Durable stopped content.', streamingState: 'finished' }));
  expect(fixture.api.updateMessage).toHaveBeenCalledTimes(2);
  expect(fixture.api.updateMessage.mock.calls[1][2]).toEqual({ streamingState: 'finished' });
});

test('a failed Stop status acknowledgement keeps the saved partial and reports the status failure honestly', async () => {
  const fixture = durableStopFixture();
  const { streamId, subscription } = await startStoppedReply(fixture);
  await waitFor(() => expect(fixture.messages.find(message => message.id === streamId))
    .toMatchObject({ content: 'Durable stopped content.', streamingState: 'cancelled' }));
  fixture.api.updateMessage.mockResolvedValueOnce({ success: false, error: 'Status acknowledgement refused.' });
  await act(async () => { deliverStopEnd(subscription, streamId); });
  expect(await screen.findByText('Your partial reply is kept, but its final status could not be saved.')).toBeInTheDocument();
  expect(fixture.messages.find(message => message.id === streamId))
    .toMatchObject({ content: 'Durable stopped content.', streamingState: 'cancelled' });
  expect(screen.queryByText(/cancelled/i)).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
});

test('generation Retry waits for Stop status persistence and an old confirmed end cannot overwrite its replacement', async () => {
  const fixture = durableStopFixture();
  const { streamId, subscription } = await startStoppedReply(fixture);
  await waitFor(() => expect(fixture.messages.find(message => message.id === streamId)?.streamingState).toBe('cancelled'));
  const held = heldStopWrite();
  const originalUpdate = fixture.api.updateMessage.getMockImplementation();
  fixture.api.updateMessage.mockImplementationOnce(async (id: string, messageId: string, updates: Partial<Message>) => {
    await held.promise;
    return originalUpdate(id, messageId, updates);
  });
  await act(async () => { deliverStopEnd(subscription, streamId); });
  await waitFor(() => expect(fixture.api.updateMessage).toHaveBeenCalledTimes(2));
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' })); });
    expect(fixture.api.sendStreamMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Durable stopped content.')).toBeInTheDocument();
  } finally {
    await act(async () => { held.resolve(); });
  }
  await waitFor(() => expect(fixture.messages.find(message => message.id === streamId)?.streamingState).toBe('finished'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' })); });
  await waitFor(() => expect(fixture.api.sendStreamMessage).toHaveBeenCalledTimes(2));
  const replacement = fixture.subscriptions[1];
  await act(async () => { replacement.handlers.onStreamChunk({ streamId, chunk: 'New Retry content.' }); });
  await act(async () => { deliverStopEnd(replacement, streamId, false); });
  await waitFor(() => expect(fixture.messages.find(message => message.id === streamId))
    .toMatchObject({ content: 'New Retry content.', streamingState: 'finished' }));
  const writesAfterRetry = fixture.api.updateMessage.mock.calls.length;
  await act(async () => { subscription.handlers.onStreamEnd({ streamId, cancelled: true }); });
  expect(fixture.api.updateMessage).toHaveBeenCalledTimes(writesAfterRetry);
  expect(fixture.messages.find(message => message.id === streamId))
    .toMatchObject({ content: 'New Retry content.', streamingState: 'finished' });
});
