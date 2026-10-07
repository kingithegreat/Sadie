jest.mock('axios');
jest.mock('../config-manager', () => ({ getSettings: () => ({}) }));

import axios from 'axios';
import { EventEmitter } from 'events';
import { streamFromCustomLLM } from '../custom-llm-client';
import type { CustomLLMConfig } from '../../shared/types';

const config = (provider: CustomLLMConfig['provider'] = 'custom'): CustomLLMConfig => ({
  name: 'Fixture', enabled: true, provider, model: provider === 'anthropic' ? 'claude-sonnet-4' : 'fixture-model',
  apiUrl: 'http://127.0.0.1:12345/v1', apiKey: provider === 'custom' ? '' : 'fixture-key',
});
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;

async function start(cfg = config()) {
  const stream = new EventEmitter();
  (axios.post as jest.Mock).mockResolvedValue({ data: stream, headers: { 'content-type': 'text/event-stream' } });
  const onChunk = jest.fn(), onEnd = jest.fn(), onError = jest.fn(), onToolCall = jest.fn();
  const result = await streamFromCustomLLM('hello', [], cfg, 'system', onChunk, onEnd, onError, undefined, undefined, onToolCall);
  await new Promise<void>(resolve => setImmediate(resolve));
  return { stream, onChunk, onEnd, onError, onToolCall, ...result };
}

beforeEach(() => jest.clearAllMocks());

test('accepts multiline SSE data, comments and fields without a space', async () => {
  const call = await start();
  call.stream.emit('data', Buffer.from(': keepalive\r\nevent: message\r\ndata:{"choices":[\r\ndata:{"delta":{"content":"Hello"}}]}\r\n\r\n'));
  call.stream.emit('end');
  expect(call.onChunk).toHaveBeenCalledWith('Hello');
  expect(call.onEnd).toHaveBeenCalledTimes(1);
});

test.each(['custom', 'anthropic', 'google-gemini'] as const)('%s preserves UTF-8 text and events split at every byte', async provider => {
  const call = await start(config(provider));
  const content = provider === 'anthropic'
    ? { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Kia ora 🌏' } }
    : provider === 'google-gemini'
      ? { candidates: [{ content: { parts: [{ text: 'Kia ora 🌏' }] } }] }
      : { choices: [{ delta: { content: 'Kia ora 🌏' } }] };
  for (const byte of Buffer.from(frame(content))) call.stream.emit('data', Buffer.from([byte]));
  call.stream.emit('end');
  expect(call.onChunk.mock.calls.flat().join('')).toBe('Kia ora 🌏');
  expect(call.onEnd).toHaveBeenCalledTimes(1);
  expect(call.onError).not.toHaveBeenCalled();
});

test('keeps parallel tool arguments separate and flushes them on EOF without DONE', async () => {
  const call = await start();
  call.stream.emit('data', Buffer.from(frame({ choices: [{ delta: { tool_calls: [
    { index: 0, id: 'a', function: { name: 'first', arguments: '{"x":' } },
    { index: 1, id: 'b', function: { name: 'second', arguments: '{"y":' } },
  ] } }] })));
  call.stream.emit('data', Buffer.from(frame({ choices: [{ delta: { tool_calls: [
    { index: 0, function: { arguments: '1}' } },
    { index: 1, function: { arguments: '2}' } },
  ] } }] })));
  call.stream.emit('end');
  expect(call.onToolCall.mock.calls.map(([value]) => value)).toEqual([
    { id: 'a', name: 'first', arguments: { x: 1 } },
    { id: 'b', name: 'second', arguments: { y: 2 } },
  ]);
  expect(call.onEnd).toHaveBeenCalledTimes(1);
});

test('reports an in-band OpenAI error once and suppresses later text/end', async () => {
  const call = await start();
  call.stream.emit('data', Buffer.from(frame({ error: { message: 'Model unavailable' } })));
  call.stream.emit('data', Buffer.from(frame({ choices: [{ delta: { content: 'late' } }] })));
  call.stream.emit('error', new Error('socket closed'));
  call.stream.emit('end');
  expect(call.onError).toHaveBeenCalledTimes(1);
  expect(call.onError.mock.calls[0][0].message).toBe('Model unavailable');
  expect(call.onChunk).not.toHaveBeenCalled();
  expect(call.onEnd).not.toHaveBeenCalled();
});

test('cancel aborts the HTTP request and suppresses late provider callbacks', async () => {
  const call = await start();
  const signal = (axios.post as jest.Mock).mock.calls[0][2].signal as AbortSignal;
  call.cancel();
  expect(signal.aborted).toBe(true);
  call.stream.emit('data', Buffer.from(frame({ choices: [{ delta: { content: 'late' } }] })));
  call.stream.emit('end');
  expect(call.onChunk).not.toHaveBeenCalled();
  expect(call.onEnd).toHaveBeenCalledTimes(1);
});

test('supports a complete chat URL and omits Authorization for a keyless custom server', async () => {
  const call = await start({ ...config(), apiUrl: ' http://127.0.0.1:12345/v1/chat/completions/ ' });
  const [url, , request] = (axios.post as jest.Mock).mock.calls[0];
  expect(url).toBe('http://127.0.0.1:12345/v1/chat/completions');
  expect(request.headers.Authorization).toBeUndefined();
  call.stream.emit('end');
});

test('reads JSON from a compatible endpoint that ignores stream=true', async () => {
  const stream = new EventEmitter();
  (axios.post as jest.Mock).mockResolvedValue({ data: stream, headers: { 'content-type': 'application/json' } });
  const onChunk = jest.fn(), onEnd = jest.fn(), onError = jest.fn();
  await streamFromCustomLLM('hello', [], config(), 'system', onChunk, onEnd, onError);
  await new Promise<void>(resolve => setImmediate(resolve));
  stream.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Full reply' } }] })));
  stream.emit('end');
  expect(onChunk).toHaveBeenCalledWith('Full reply');
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

test('omits an empty user turn when synthesizing tool results', async () => {
  const stream = new EventEmitter();
  (axios.post as jest.Mock).mockResolvedValue({ data: stream });
  await streamFromCustomLLM('', [{ role: 'user', content: 'Find it' }, { role: 'tool', tool_call_id: 'a', content: 'Found' }],
    config(), 'system', jest.fn(), jest.fn(), jest.fn());
  await new Promise<void>(resolve => setImmediate(resolve));
  const messages = (axios.post as jest.Mock).mock.calls[0][1].messages;
  expect(messages[messages.length - 1]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'Found' });
  stream.emit('end');
});

test('an already aborted request does not contact the provider', async () => {
  const controller = new AbortController(); controller.abort();
  const onEnd = jest.fn();
  await streamFromCustomLLM('hello', [], config(), 'system', jest.fn(), onEnd, jest.fn(), controller.signal);
  expect(axios.post).not.toHaveBeenCalled();
  expect(onEnd).toHaveBeenCalledTimes(1);
});

test('cancel interrupts retry backoff before a second HTTP attempt', async () => {
  (axios.post as jest.Mock).mockRejectedValue(new Error('Connection refused'));
  const onEnd = jest.fn(), onError = jest.fn();
  const result = await streamFromCustomLLM('hello', [], config(), 'system', jest.fn(), onEnd, onError);
  await new Promise<void>(resolve => setImmediate(resolve));
  result.cancel();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

test('rejects malformed tool arguments instead of executing an empty-input tool', async () => {
  const call = await start(config('anthropic'));
  call.stream.emit('data', Buffer.from(frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a', name: 'write_file' } })));
  call.stream.emit('data', Buffer.from(frame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } })));
  call.stream.emit('data', Buffer.from(frame({ type: 'content_block_stop', index: 0 })));
  call.stream.emit('end');
  expect(call.onToolCall).not.toHaveBeenCalled();
  expect(call.onError).toHaveBeenCalledTimes(1);
  expect(call.onEnd).not.toHaveBeenCalled();
});
