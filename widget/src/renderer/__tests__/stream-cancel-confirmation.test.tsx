import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

jest.useFakeTimers();

let _chunkHandler: any;
let _endHandler: any;
let _errorHandler: any;

// Provide a fully mocked preload API
beforeEach(() => {
  _chunkHandler = undefined;
  _endHandler = undefined;
  _errorHandler = undefined;

  (window as any).electron = {
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    cancelStream: jest.fn(),
    subscribeToStream: jest.fn((sid: string, handlers: any) => {
      _chunkHandler = handlers.onStreamChunk;
      _endHandler = handlers.onStreamEnd;
      _errorHandler = handlers.onStreamError;
      return jest.fn();
    }),
    onStreamError: jest.fn(),
    getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
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

    // send a message to create streaming assistant
    const textarea = screen.getByLabelText('Message SADIE') as HTMLTextAreaElement;
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
    const streamId = 'stream-999';

    // second scenario: send a new message so handlers are registered
    let capturedStreamId2: string | undefined;
    (window as any).electron.sendStreamMessage = jest.fn((payload: any) => { capturedStreamId2 = payload.streamId; return Promise.resolve(); });

    render(<App />);

    const textarea2 = screen.getByLabelText('Message SADIE') as HTMLTextAreaElement;
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
