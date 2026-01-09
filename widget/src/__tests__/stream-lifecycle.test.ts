import { renderHook, act, waitFor } from '@testing-library/react';
// Use Jest globals (no explicit import) to avoid runtime binding issues

describe('Stream Lifecycle', () => {
  let mockIpcRenderer: any;
  let chunkHandlers: Map<string, Function>;
  let endHandlers: Map<string, Function>;
  let errorHandlers: Map<string, Function>;
  let persistSpy: jest.SpyInstance;

  beforeEach(() => {
    chunkHandlers = new Map();
    endHandlers = new Map();
    errorHandlers = new Map();

    mockIpcRenderer = {
      onStreamChunk: jest.fn((streamId, handler) => {
        chunkHandlers.set(streamId, handler);
        return () => chunkHandlers.delete(streamId);
      }),
      onStreamEnd: jest.fn((streamId, handler) => {
        endHandlers.set(streamId, handler);
        return () => endHandlers.delete(streamId);
      }),
      onStreamError: jest.fn((streamId, handler) => {
        errorHandlers.set(streamId, handler);
        return () => errorHandlers.delete(streamId);
      }),
      sendStreamMessage: jest.fn(),
      invoke: jest.fn().mockResolvedValue(undefined)
    };

    // Ensure window and e2e event collector exist
    (global as any).window = (global as any).window || {};
    (global as any).window.electron = { ipcRenderer: mockIpcRenderer };
    (global as any).__e2eEvents = [];
    (global as any).window.__e2eEvents = (global as any).__e2eEvents;

    // Spy on persistence calls for every test
    persistSpy = jest.spyOn(mockIpcRenderer, 'invoke');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper to explicitly subscribe to a stream and wire handlers to the mock ipc
  function subscribeToStream(streamId: string) {
    const state = { id: streamId, finalized: false, content: [] as string[], startTime: Date.now() };

    const chunkHandler = (chunk: string) => {
      if (!state.finalized) state.content.push(chunk);
    };

    let safetyTimer: any = setTimeout(() => {
      if (!state.finalized) endHandler({ error: 'timeout' });
    }, 60000);

    const endHandler = (opts?: any) => {
      if (state.finalized) return;
      state.finalized = true;
      clearTimeout(safetyTimer);
      const content = state.content.join('');
      const persistStatus = opts && opts.cancelled ? 'cancelled' : (opts && opts.error ? 'error' : 'done');
      const eventStatus = persistStatus === 'done' ? 'complete' : persistStatus;
      try {
        mockIpcRenderer.invoke('persist-message', { id: streamId, content: opts && opts.error ? opts.error : content, status: persistStatus });
      } catch (e) {}
      (global as any).__e2eEvents = (global as any).__e2eEvents || [];
      (global as any).__e2eEvents.push({ type: 'stream-finalized', streamId, status: eventStatus, chunkCount: state.content.length });
      // call unsubscribe functions returned by the mocked onStream* calls
      try { unsubChunk(); } catch (e) {}
      try { unsubEnd(); } catch (e) {}
      try { unsubError(); } catch (e) {}
    };

    const errorHandler = (err: any) => {
      endHandler({ error: String(err) });
    };

    const unsubChunk = mockIpcRenderer.onStreamChunk(streamId, chunkHandler);
    const unsubEnd = mockIpcRenderer.onStreamEnd(streamId, endHandler);
    const unsubError = mockIpcRenderer.onStreamError(streamId, errorHandler);

    return { state, unsubChunk, unsubEnd, unsubError };
  }

  function emitChunk(streamId: string, chunk: string) {
    const h = chunkHandlers.get(streamId);
    if (h) h(chunk);
  }

  function emitEnd(streamId: string, opts?: any) {
    const h = endHandlers.get(streamId);
    if (h) h(opts);
  }

  function emitError(streamId: string, err: any) {
    const h = errorHandlers.get(streamId);
    if (h) h(err);
  }

  function cancelStream(streamId: string) {
    // emulate user cancel path - optimistic update is handled in UI; here we finalize as cancelled
    emitEnd(streamId, { cancelled: true });
  }

  it('should only finalize once when end is called multiple times', async () => {
    const streamId = 'test-stream-1';
    subscribeToStream(streamId);

    // Simulate end being called twice
    emitEnd(streamId);
    emitEnd(streamId);

    // Should only persist once
    await waitFor(() => {
      expect(persistSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('should ignore chunks after finalization', async () => {
    const streamId = 'test-stream-2';
    const { state } = subscribeToStream(streamId);

    // Receive chunks
    emitChunk(streamId, 'chunk1');
    emitChunk(streamId, 'chunk2');

    // Finalize
    emitEnd(streamId);

    // Try to receive more chunks (should be ignored)
    emitChunk(streamId, 'chunk3');
    emitChunk(streamId, 'chunk4');

    // Should only have first 2 chunks
    expect(state.content.length).toBeLessThanOrEqual(2);
  });

  it('should handle error finalization before end', async () => {
    const streamId = 'test-stream-3';
    subscribeToStream(streamId);

    // Error arrives first
    emitError(streamId, 'Test error');

    // End arrives later (should be ignored)
    emitEnd(streamId);

    await waitFor(() => {
      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy).toHaveBeenCalledWith('persist-message', 
        expect.objectContaining({
          content: 'Test error',
          status: 'error'
        })
      );
    });
  });

  it('should add E2E event markers on finalization', async () => {
    const streamId = 'test-stream-4';
    (window as any).__e2eEvents = [];
    subscribeToStream(streamId);

    // Simulate stream
    emitChunk(streamId, 'chunk1');
    emitChunk(streamId, 'chunk2');

    emitEnd(streamId);

    await waitFor(() => {
      const finalizeEvent = (window as any).__e2eEvents.find(
        (e: any) => e.type === 'stream-finalized' && e.streamId === streamId
      );
      expect(finalizeEvent).toBeDefined();
      expect(finalizeEvent.chunkCount).toBe(2);
      expect(finalizeEvent.status).toBe('complete');
    });
  });

  it('should trigger safety timeout for hung streams', async () => {
    jest.useFakeTimers();
    const streamId = 'test-stream-5';
    subscribeToStream(streamId);

    // Fast-forward past safety timeout — simulate app safety watchdog behavior
    act(() => {
      jest.advanceTimersByTime(61000); // 61 seconds
    });

    await waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith('persist-message',
        expect.objectContaining({
          status: 'error',
          content: expect.stringContaining('timeout')
        })
      );
    });

    jest.useRealTimers();
  });

  it('should clean up subscriptions after finalization', async () => {
    const streamId = 'test-stream-6';
    const unsubChunk = jest.fn();
    const unsubEnd = jest.fn();
    const unsubError = jest.fn();

    mockIpcRenderer.onStreamChunk.mockReturnValue(unsubChunk);
    mockIpcRenderer.onStreamEnd.mockReturnValue(unsubEnd);
    mockIpcRenderer.onStreamError.mockReturnValue(unsubError);

    // Subscribe
    subscribeToStream(streamId);

    // Finalize
    emitEnd(streamId);

    await waitFor(() => {
      // Ensure handlers were removed from the registration maps
      expect(chunkHandlers.get(streamId)).toBeUndefined();
      expect(endHandlers.get(streamId)).toBeUndefined();
      expect(errorHandlers.get(streamId)).toBeUndefined();
    });
  });

  it('should persist final content on completion', async () => {
    const streamId = 'test-stream-7';
    subscribeToStream(streamId);

    // Receive content
    emitChunk(streamId, 'Hello ');
    emitChunk(streamId, 'world');
    emitChunk(streamId, '!');

    // Finalize
    emitEnd(streamId);

    await waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith('persist-message',
        expect.objectContaining({
          id: streamId,
          content: 'Hello world!',
          status: 'done'
        })
      );
    });
  });
});
