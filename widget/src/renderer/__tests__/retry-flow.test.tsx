/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

describe('retry flow (renderer)', () => {
  let capturedStreamId: string | undefined;
  let chunkHandler: ((d: any) => void) | undefined;
  let endHandler: ((d: any) => void) | undefined;
  let errorHandler: ((d: any) => void) | undefined;

  beforeEach(() => {
    capturedStreamId = undefined;
    chunkHandler = undefined;
    endHandler = undefined;
    errorHandler = undefined;

    (window as any).electron = {
      cancelStream: jest.fn(),
      subscribeToStream: jest.fn((_sid: string, handlers: any) => {
        chunkHandler = handlers.onStreamChunk;
        endHandler = handlers.onStreamEnd;
        errorHandler = handlers.onStreamError;
        return jest.fn();
      }),
      getSettings: jest.fn().mockResolvedValue({
        alwaysOnTop: true,
        n8nUrl: 'http://localhost:5678',
        widgetHotkey: 'Ctrl+Shift+Space',
      }),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      sendStreamMessage: jest.fn((payload: any) => {
        capturedStreamId = payload.streamId;
        return Promise.resolve();
      }),
      onMessage: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    } as unknown as ElectronAPI;
  });

  test('clicking Retry on an error message re-sends the preceding user message', async () => {
    render(<App />);

    // Send a user message
    const textarea = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Tell me a joke' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    const streamId = capturedStreamId as string;

    // Simulate a chunk then an error
    act(() => { chunkHandler?.({ streamId, chunk: 'partial' }); });
    await waitFor(() => expect(screen.getByText('partial')).toBeInTheDocument());

    act(() => { errorHandler?.({ streamId, error: 'upstream error' }); });
    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());

    // The Retry button should now be visible
    const retryBtn = screen.getByText('↻ Retry');
    expect(retryBtn).toBeInTheDocument();

    // Clear mock to track the retry call
    const sendMock = (window as any).electron.sendStreamMessage as jest.Mock;
    sendMock.mockClear();

    // Click Retry
    fireEvent.click(retryBtn);

    // sendStreamMessage should be called again with the original user message
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const retryPayload = sendMock.mock.calls[0][0];
    expect(retryPayload.message).toBe('Tell me a joke');

    // subscribeToStream should have been called again for the retry
    expect((window as any).electron.subscribeToStream).toHaveBeenCalled();
  });

  test('Retry button is NOT shown for non-error states', async () => {
    render(<App />);

    const textarea = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    const streamId = capturedStreamId as string;

    // End successfully
    act(() => { chunkHandler?.({ streamId, chunk: 'Response' }); });
    act(() => { endHandler?.({ streamId, cancelled: false }); });

    await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument());

    // Retry should NOT be present
    expect(screen.queryByText('↻ Retry')).toBeNull();
  });

  test('retrying a document-attached turn asks for reattach instead of resending a marker-only request', async () => {
    render(<App />);

    const textarea = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: '[Document attached: SADIE_Midpoint_Review.docx]\n\nthis was you what do i think?'
      }
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    const streamId = capturedStreamId as string;

    act(() => { errorHandler?.({ streamId, error: 'upstream error' }); });
    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());

    const sendMock = (window as any).electron.sendStreamMessage as jest.Mock;
    sendMock.mockClear();

    fireEvent.click(screen.getByText('↻ Retry'));

    await waitFor(() => {
      expect(screen.getByText('This request included a document attachment. Please reattach the document and send it again.')).toBeInTheDocument();
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(screen.queryByText('↻ Retry')).toBeNull();
  });
});
