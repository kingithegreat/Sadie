/**
 * stream-proxy-client.test.ts
 * Tests for src/main/stream-proxy-client.ts
 */

import { EventEmitter } from 'events';

// Mock axios before importing the module under test
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    isCancel: jest.fn().mockReturnValue(false),
  },
}));

import axios from 'axios';
import { streamFromHomeBotProxy } from '../stream-proxy-client';

const mockPost = (axios as any).post as jest.Mock;
const mockIsCancel = (axios as any).isCancel as jest.Mock;

class MockStream extends EventEmitter {}

function makeStream(): MockStream {
  return new MockStream();
}

function resolveWith(stream: MockStream) {
  mockPost.mockResolvedValueOnce({ data: stream });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsCancel.mockReturnValue(false);
  // restore default env vars
  delete process.env.HOMEBOT_PROXY_URL;
  delete process.env.PROXY_API_KEYS;
  delete process.env.PROXY_API_KEY;
});

// Flush microtasks so the .then() of axios.post executes
function flushPromises() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe('streamFromHomeBotProxy — URL resolution', () => {
  test('uses default URL when no env or opts provided', async () => {
    resolveWith(makeStream());
    streamFromHomeBotProxy({ model: 'gpt-4' }, jest.fn());
    await flushPromises();
    expect(mockPost).toHaveBeenCalledWith(
      'http://localhost:5050/stream',
      expect.anything(),
      expect.anything()
    );
  });

  test('uses HOMEBOT_PROXY_URL env var when set', async () => {
    process.env.HOMEBOT_PROXY_URL = 'http://myproxy:9000/stream';
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn());
    await flushPromises();
    expect(mockPost).toHaveBeenCalledWith(
      'http://myproxy:9000/stream',
      expect.anything(),
      expect.anything()
    );
  });

  test('opts.proxyUrl takes precedence over env var', async () => {
    process.env.HOMEBOT_PROXY_URL = 'http://envproxy/stream';
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn(), undefined, undefined, { proxyUrl: 'http://opts-proxy/stream' });
    await flushPromises();
    expect(mockPost).toHaveBeenCalledWith(
      'http://opts-proxy/stream',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('streamFromHomeBotProxy — apiKey / x-homebot-key header', () => {
  test('sets x-homebot-key header when apiKey is a plain string', async () => {
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn(), undefined, undefined, { apiKey: 'my-secret-key' });
    await flushPromises();
    const config = mockPost.mock.calls[0][2];
    expect(config.headers['x-homebot-key']).toBe('my-secret-key');
  });

  test('does NOT set x-homebot-key when apiKey is empty string', async () => {
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn(), undefined, undefined, { apiKey: '' });
    await flushPromises();
    const config = mockPost.mock.calls[0][2];
    expect(config.headers['x-homebot-key']).toBeUndefined();
  });

  test('takes first element when apiKey is an array', async () => {
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn(), undefined, undefined, { apiKey: ['key-one', 'key-two'] as any });
    await flushPromises();
    const config = mockPost.mock.calls[0][2];
    expect(config.headers['x-homebot-key']).toBe('key-one');
  });

  test('takes first segment when apiKey is comma-separated', async () => {
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn(), undefined, undefined, { apiKey: 'key-a,key-b,key-c' });
    await flushPromises();
    const config = mockPost.mock.calls[0][2];
    expect(config.headers['x-homebot-key']).toBe('key-a');
  });

  test('uses PROXY_API_KEYS env var when opts.apiKey not set', async () => {
    process.env.PROXY_API_KEYS = 'env-key-1,env-key-2';
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn());
    await flushPromises();
    const config = mockPost.mock.calls[0][2];
    expect(config.headers['x-homebot-key']).toBe('env-key-1');
  });

  test('PROXY_API_KEY env var used as fallback', async () => {
    process.env.PROXY_API_KEY = 'fallback-key';
    resolveWith(makeStream());
    streamFromHomeBotProxy({}, jest.fn());
    await flushPromises();
    const config = mockPost.mock.calls[0][2];
    expect(config.headers['x-homebot-key']).toBe('fallback-key');
  });
});

describe('streamFromHomeBotProxy — stream events', () => {
  test('calls onChunk with string data from stream', async () => {
    const stream = makeStream();
    resolveWith(stream);
    const onChunk = jest.fn();
    streamFromHomeBotProxy({}, onChunk);
    await flushPromises();
    stream.emit('data', Buffer.from('hello world'));
    expect(onChunk).toHaveBeenCalledWith('hello world');
  });

  test('calls onEnd when stream ends', async () => {
    const stream = makeStream();
    resolveWith(stream);
    const onEnd = jest.fn();
    streamFromHomeBotProxy({}, jest.fn(), onEnd);
    await flushPromises();
    stream.emit('end');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test('calls onError on stream error event', async () => {
    const stream = makeStream();
    resolveWith(stream);
    const onError = jest.fn();
    streamFromHomeBotProxy({}, jest.fn(), undefined, onError);
    await flushPromises();
    const err = new Error('stream broken');
    stream.emit('error', err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  test('does not call onChunk after cancel()', async () => {
    const stream = makeStream();
    resolveWith(stream);
    const onChunk = jest.fn();
    const handle = streamFromHomeBotProxy({}, onChunk);
    await flushPromises();
    handle.cancel();
    stream.emit('data', Buffer.from('late data'));
    expect(onChunk).not.toHaveBeenCalled();
  });
});

describe('streamFromHomeBotProxy — axios error handling', () => {
  test('silently ignores canceled requests (axios.isCancel === true)', async () => {
    const cancelError = new Error('canceled');
    mockPost.mockRejectedValueOnce(cancelError);
    mockIsCancel.mockReturnValue(true);
    const onError = jest.fn();
    streamFromHomeBotProxy({}, jest.fn(), undefined, onError);
    await flushPromises();
    expect(onError).not.toHaveBeenCalled();
  });

  test('calls onError for non-cancel axios errors', async () => {
    const netError = new Error('Network Error');
    mockPost.mockRejectedValueOnce(netError);
    mockIsCancel.mockReturnValue(false);
    const onError = jest.fn();
    streamFromHomeBotProxy({}, jest.fn(), undefined, onError);
    await flushPromises();
    expect(onError).toHaveBeenCalledWith(netError);
  });

  test('does not throw when onError is not provided on network error', async () => {
    const netError = new Error('Network Error');
    mockPost.mockRejectedValueOnce(netError);
    mockIsCancel.mockReturnValue(false);
    expect(() => streamFromHomeBotProxy({}, jest.fn())).not.toThrow();
    await flushPromises();
  });
});

describe('streamFromHomeBotProxy — cancel()', () => {
  test('returns an object with a cancel function', () => {
    mockPost.mockReturnValue(new Promise(() => {})); // never resolves
    const handle = streamFromHomeBotProxy({}, jest.fn());
    expect(typeof handle.cancel).toBe('function');
  });

  test('cancel() does not throw', async () => {
    resolveWith(makeStream());
    const handle = streamFromHomeBotProxy({}, jest.fn());
    await flushPromises();
    expect(() => handle.cancel()).not.toThrow();
  });
});
