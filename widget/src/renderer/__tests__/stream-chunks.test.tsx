import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

describe('stream chunks (renderer)', () => {
  beforeEach(() => {
    // Provide a typed mock for the electron preload API and capture handlers
    (window as any).electron = undefined;
  });

  test('message grows chunk-by-chunk and finalizes on stream end', async () => {
    let capturedStreamId: string | undefined;
    let chunkHandler: ((d: any) => void) | undefined;
    let endHandler: ((d: any) => void) | undefined;

    const chunkUnsub = jest.fn();
    const endUnsub = jest.fn();
    const errorUnsub = jest.fn();

    (window as any).electron = {
      cancelStream: jest.fn(),
      onStreamChunk: jest.fn((cb: (d: any) => void) => {
        chunkHandler = cb;
        return chunkUnsub;
      }),
      onStreamEnd: jest.fn((cb: (d: any) => void) => {
        endHandler = cb;
        return endUnsub;
      }),
      onStreamError: jest.fn(() => errorUnsub),
      getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      sendStreamMessage: jest.fn((payload: any) => {
        capturedStreamId = payload.streamId;
        return Promise.resolve();
      }),
      onMessage: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' })
    } as unknown as ElectronAPI;

    // Render App with no initial messages
    const { getByLabelText, getByText } = render(<App />);

    // Compose a user message and send to create a streaming assistant message and subscribe
    const textarea = getByLabelText('Message SADIE') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Kick off stream' } });
    const sendButton = getByText('Send');
    fireEvent.click(sendButton);

    // Ensure the sendStreamMessage handler captured the stream id and our handlers were registered
    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    expect(capturedStreamId).toBeDefined();
    expect(typeof chunkHandler).toBe('function');
    expect(typeof endHandler).toBe('function');

    // Simulate chunks arriving in order
    const streamId = capturedStreamId as string;

    // chunk1
    act(() => { chunkHandler?.({ streamId, chunk: 'Hello' }); });
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());

    // chunk2
    act(() => { chunkHandler?.({ streamId, chunk: ' world' }); });
    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());

    // chunk3
    act(() => { chunkHandler?.({ streamId, chunk: '!!!' }); });
    await waitFor(() => expect(screen.getByText('Hello world!!!')).toBeInTheDocument());

    // Now end the stream
    act(() => { endHandler?.({ streamId, cancelled: false }); });

    // Wait for final UI state: final content present and no streaming cancel button
    await waitFor(() => expect(screen.getByText('Hello world!!!')).toBeInTheDocument());

    // Cancel button should disappear after finish
    expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull();

    // Ensure unsubscribe functions still exist and can be called (cleanup implicit on end)
    // The test ensures our mocks were returned; actual cleanup on app is tested elsewhere.
    expect(chunkUnsub).toBeDefined();
    expect(endUnsub).toBeDefined();
    expect(errorUnsub).toBeDefined();
  });
});
