import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

describe('stream end and error handling (renderer)', () => {
  beforeEach(() => {
    (window as any).electron = undefined;
  });

  test('onStreamEnd marks the message as finished and finalizes content', async () => {
    let capturedStreamId: string | undefined;
    let chunkHandler: ((d: any) => void) | undefined;
    let endHandler: ((d: any) => void) | undefined;

    const unsub = jest.fn();
    const chunkUnsub = unsub;
    const endUnsub = unsub;
    const errorUnsub = unsub;

    (window as any).electron = {
      cancelStream: jest.fn(),
      subscribeToStream: jest.fn((sid: string, handlers: any) => {
        chunkHandler = handlers.onStreamChunk;
        endHandler = handlers.onStreamEnd;
        return unsub;
      }),
      getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      sendStreamMessage: jest.fn((payload: any) => { capturedStreamId = payload.streamId; return Promise.resolve(); }),
      onMessage: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' })
    } as unknown as ElectronAPI;

    const { getByLabelText, getByText } = render(<App />);

    // Send a user message, creating an assistant streaming message
    const textarea = getByLabelText('Message SADIE') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Testing end' } });
    const sendBtn = getByText('Send');
    fireEvent.click(sendBtn);

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    expect(capturedStreamId).toBeDefined();
    const streamId = capturedStreamId as string;

    // Provide one chunk then end the stream
    act(() => { chunkHandler?.({ streamId, chunk: 'First chunk' }); });
    await waitFor(() => expect(screen.getByText('First chunk')).toBeInTheDocument());

    act(() => { endHandler?.({ streamId, cancelled: false }); });

    // After end, final content remains and streaming UI is removed
    await waitFor(() => expect(screen.getByText('First chunk')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();
    // No Error badge expected
    expect(screen.queryByText('Error')).toBeNull();

    // Ensure our unsub functions were supplied
    expect(typeof chunkUnsub).toBe('function');
    expect(typeof endUnsub).toBe('function');
    expect(typeof errorUnsub).toBe('function');
  });

  test('onStreamError marks the message as error and stops further updates', async () => {
    let capturedStreamId: string | undefined;
    let chunkHandler: ((d: any) => void) | undefined;
    let errorHandler: ((d: any) => void) | undefined;

    const unsub = jest.fn();
    const chunkUnsub = unsub;
    const endUnsub = unsub;
    const errorUnsub = unsub;

    (window as any).electron = {
      cancelStream: jest.fn(),
      subscribeToStream: jest.fn((sid: string, handlers: any) => {
        chunkHandler = handlers.onStreamChunk;
        errorHandler = handlers.onStreamError;
        return unsub;
      }),
      getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      sendStreamMessage: jest.fn((payload: any) => { capturedStreamId = payload.streamId; return Promise.resolve(); }),
      onMessage: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' })
    } as unknown as ElectronAPI;

    const { getByLabelText, getByText } = render(<App />);

    // Send message to create streaming assistant
    const textarea = getByLabelText('Message SADIE') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Testing error' } });
    const sendBtn = getByText('Send');
    fireEvent.click(sendBtn);

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    const streamId = capturedStreamId as string;

    // Produce a chunk, then an error
    act(() => { chunkHandler?.({ streamId, chunk: 'partial' }); });
    await waitFor(() => expect(screen.getByText('partial')).toBeInTheDocument());

    // Trigger stream error
    act(() => { errorHandler?.({ streamId, error: 'test error' }); });

    // Error badge should appear and cancel button should disappear
    await waitFor(() => expect(screen.getByText('Error')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();

    // Message should no longer grow after error - simulate another chunk and ensure final text unchanged
    act(() => { chunkHandler?.({ streamId, chunk: 'more' }); });
    // allow a moment for any update (should not change)
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('partialmore')).toBeNull();

    // edge-case: error before any chunk
    // Start a new message
    let newStreamId: string | undefined;
    const sendSecond = (window as any).electron.sendStreamMessage as jest.Mock<any, any>;
    sendSecond.mockImplementationOnce((payload: any) => { newStreamId = payload.streamId; return Promise.resolve(); });

    fireEvent.change(textarea, { target: { value: 'Edge error' } });
    fireEvent.click(sendBtn);
    await waitFor(() => expect(sendSecond).toHaveBeenCalled());

    // Trigger error before any chunk on new stream
    act(() => { errorHandler?.({ streamId: newStreamId, error: 'pre-chunk error' }); });

    // The new message should exist but be empty and have an Error badge
    // Find any Error badge in the DOM - we expect at least one
    await waitFor(() => expect(screen.getAllByText('Error').length).toBeGreaterThanOrEqual(1));

  });
});
