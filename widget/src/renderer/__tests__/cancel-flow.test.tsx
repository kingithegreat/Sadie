import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { Message as SharedMessage, ElectronAPI } from '../../shared/types';

describe('cancel flow (renderer)', () => {
  beforeEach(() => {
    // default minimal electron mock
    (window as any).electron = {
      cancelStream: jest.fn(),
      // use subscribeToStream (returns an unsubscribe function)
      subscribeToStream: jest.fn(() => jest.fn()),
      // Other methods used by App
      getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      sendStreamMessage: jest.fn(),
      onMessage: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' })
    } as unknown as ElectronAPI;
  });

  test('clicking cancel calls cancelStream, updates messages state and shows cancelled badge', async () => {
    const initialMessages: SharedMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Hello',
        timestamp: new Date().toISOString(),
        streamingState: 'streaming'
      }
    ];

    render(<App initialMessages={initialMessages} />);

    // cancel button should be present for streaming message
    const cancelBtn = await screen.findByRole('button', { name: /stop generating/i });
    expect(cancelBtn).toBeInTheDocument();

    // click cancel button
    fireEvent.click(cancelBtn);

    // cancelStream should be called with message id
    expect((window as any).electron.cancelStream).toHaveBeenCalledWith('m1');

    // UI should immediately show Cancelled badge for the message
    const cancelledBadge = await screen.findByText('Cancelled');
    expect(cancelledBadge).toBeInTheDocument();

    // Confirm there is no longer a cancel button for the message
    expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
  });

  test('unmount calls unsubscribe functions returned by onStream*', async () => {
    // Prepare unsub mocks so we can observe calls
    const chunkUnsub = jest.fn();
    const endUnsub = jest.fn();
    const errorUnsub = jest.fn();

    (window as any).electron.subscribeToStream = jest.fn(() => {
      return jest.fn(() => { chunkUnsub(); endUnsub(); errorUnsub(); });
    });

    // Start with an empty message list and then trigger a send to create subscriptions
    const { getByLabelText, getByText, unmount } = render(<App />);

    // Type a user message and send to create a streaming assistant placeholder and subscriptions
    const textarea = getByLabelText('Message SADIE') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Start streaming' } });
    const sendBtn = getByText('Send') as HTMLButtonElement;
    // Send should be enabled now
    fireEvent.click(sendBtn);

    // Wait for subscriptions to be registered; subscribeToStream should have been called
    await waitFor(() => expect((window as any).electron.subscribeToStream).toHaveBeenCalled());

    // Unmount the App which should trigger unsubscribe cleanup
    unmount();

    // All unsubscribe functions should have been called during cleanup
    expect(chunkUnsub).toHaveBeenCalled();
    expect(endUnsub).toHaveBeenCalled();
    expect(errorUnsub).toHaveBeenCalled();
  });
});
