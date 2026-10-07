import { PassThrough } from 'stream';
import axios from 'axios';

jest.mock('electron', () => ({
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false },
  BrowserWindow: jest.fn(), dialog: {}, shell: {},
}));
jest.mock('axios');
jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => ({ chatModel: 'llama3.1:70b', ollamaUrl: 'http://127.0.0.1:11434' })),
  saveSettings: jest.fn(),
}));
jest.mock('../memory-manager', () => ({
  MemoryManager: { getConversation: jest.fn(() => null) },
}));
jest.mock('../tools', () => ({
  initializeTools: jest.fn(), getSmallModelTools: jest.fn(() => [{ type: 'function', function: { name: 'read_file' } }]),
  getFocusedOllamaTools: jest.fn(() => [{ type: 'function', function: { name: 'read_file' } }]),
  executeToolBatch: jest.fn(async () => []),
}));
jest.mock('../tools/rag', () => ({ ragSearchWarmup: jest.fn(async () => {}), ragSearch: jest.fn(() => null) }));
jest.mock('../skills', () => ({ matchSkills: jest.fn(() => null), getSkillCatalogue: jest.fn(() => '') }));
jest.mock('../custom-llm-client', () => ({ streamFromCustomLLM: jest.fn(), validateCustomLLMConfig: jest.fn(() => ({ valid: false })) }));
jest.mock('../tools/web', () => ({ setSearxngUrl: jest.fn(), setTavilyApiKey: jest.fn(), setSerperApiKey: jest.fn(), setOpenaiApiKey: jest.fn() }));
jest.mock('../tools/enrichment', () => ({ enrichNbaGames: jest.fn(), enrichWeather: jest.fn(), enrichGenericQuery: jest.fn() }));
jest.mock('../stream-proxy-client', () => ({ __esModule: true, default: jest.fn() }));

import { streamFromOllamaWithTools, setUncensoredMode, clearHistory } from '../message-router';
import { executeToolBatch } from '../tools';
import { getSettings } from '../config-manager';
import { OLLAMA_CHAT_MODEL } from '../router/model-size';

const post = axios.post as jest.Mock;
const batch = executeToolBatch as jest.Mock;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const record = (content: string, done = false) => JSON.stringify({ message: { content }, done }) + '\n';

beforeEach(() => {
  jest.clearAllMocks();
  setUncensoredMode(false);
  clearHistory('local-stream-test');
  (getSettings as jest.Mock).mockReturnValue({ chatModel: 'llama3.1:70b', ollamaUrl: 'http://127.0.0.1:11434' });
});

async function start(message = 'Explain how rainbows form') {
  const stream = new PassThrough();
  post.mockResolvedValueOnce({ data: stream });
  const callbacks = { onChunk: jest.fn(), onToolCall: jest.fn(), onToolResult: jest.fn(), onEnd: jest.fn(), onError: jest.fn() };
  const handle = await streamFromOllamaWithTools(message, undefined, 'local-stream-test',
    callbacks.onChunk, callbacks.onToolCall, callbacks.onToolResult, callbacks.onEnd, callbacks.onError);
  await tick();
  return { stream, ...callbacks, ...handle };
}

test('preserves records split across chunks, combined records, and split UTF-8 bytes', async () => {
  const state = await start();
  const bytes = Buffer.from(record('Hello 🌈 ') + record('from this PC.', true));
  const emoji = bytes.indexOf(Buffer.from('🌈'));
  state.stream.write(bytes.subarray(0, 11));
  state.stream.write(bytes.subarray(11, emoji + 2));
  state.stream.end(bytes.subarray(emoji + 2));
  await tick();
  expect(state.onChunk.mock.calls.map(call => call[0]).join('')).toBe('Hello 🌈 from this PC.');
  expect(state.onEnd).toHaveBeenCalledTimes(1);
  expect(state.onError).not.toHaveBeenCalled();
});

test('accepts a final done record without a trailing newline', async () => {
  const state = await start();
  state.stream.end(record('A complete response.', true).trim());
  await tick();
  expect(state.onChunk).toHaveBeenCalledWith('A complete response.');
  expect(state.onEnd).toHaveBeenCalledTimes(1);
});

test('a done record closes the remaining transport even when the server keeps it open', async () => {
  const state = await start();
  state.stream.write(record('A complete response.', true));
  await tick();
  expect(state.stream.destroyed).toBe(true);
  expect(state.onEnd).toHaveBeenCalledTimes(1);
  expect(state.onError).not.toHaveBeenCalled();
});

test.each([
  ['provider error', JSON.stringify({ error: 'model runner has unexpectedly stopped' }) + '\n', 'model runner'],
  ['truncated JSON', '{"message":{"content":"unfinished', 'incomplete'],
  ['missing done record', record('Partial response'), 'finished'],
  ['malformed record', 'this is not json\n', 'invalid'],
])('surfaces %s rather than reporting success', async (_label, body, expected) => {
  const state = await start();
  state.stream.end(body);
  await tick();
  expect(state.onError).toHaveBeenCalledTimes(1);
  expect(state.onError.mock.calls[0][0].message.toLowerCase()).toContain(expected);
  expect(state.onEnd).not.toHaveBeenCalled();
});

test('cancel closes an idle stream once and suppresses late text and errors', async () => {
  const state = await start();
  state.cancel();
  await tick();
  expect(state.stream.destroyed).toBe(true);
  expect(state.onEnd).toHaveBeenCalledTimes(1);
  state.stream.emit('data', Buffer.from(record('late text', true)));
  state.stream.emit('error', new Error('late error'));
  await tick();
  expect(state.onChunk).not.toHaveBeenCalled();
  expect(state.onError).not.toHaveBeenCalled();
  expect(state.onEnd).toHaveBeenCalledTimes(1);
});

test('a prematurely closed stream reports a failure', async () => {
  const state = await start();
  state.stream.destroy();
  await tick();
  expect(state.onError).toHaveBeenCalledTimes(1);
  expect(state.onEnd).not.toHaveBeenCalled();
});

test('cancelling while permission is pending prevents tool rerun and follow-up generation', async () => {
  let allow!: (result: any) => void;
  const permission = jest.fn(() => new Promise<any>(resolve => { allow = resolve; }));
  batch.mockImplementation(async (calls: any[]) => calls[0]?.name === 'read_file'
    ? [{ success: false, status: 'needs_confirmation', missingPermissions: ['filesystem'] }]
    : []);
  const stream = new PassThrough();
  post.mockResolvedValueOnce({ data: stream });
  const onEnd = jest.fn();
  const onError = jest.fn();
  const onToolResult = jest.fn();
  const handle = await streamFromOllamaWithTools('Read my file', undefined, 'local-stream-test',
    jest.fn(), jest.fn(), onToolResult, onEnd, onError, undefined, permission);
  await tick();
  stream.end(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'example.txt' } } }] }, done: true }) + '\n');
  await tick();
  expect(permission).toHaveBeenCalledTimes(1);
  const callsAtStop = batch.mock.calls.length;
  handle.cancel();
  allow({ decision: 'allow_once' });
  await tick();
  expect(batch).toHaveBeenCalledTimes(callsAtStop);
  const actualToolCall = batch.mock.calls.find(call => call[0][0]?.name === 'read_file');
  expect(actualToolCall?.[2]?.signal).toBeInstanceOf(AbortSignal);
  expect(actualToolCall?.[2]?.signal.aborted).toBe(true);
  expect(post).toHaveBeenCalledTimes(1);
  expect(onToolResult).not.toHaveBeenCalled();
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

test('keeps tool calls from separate records and announces both before one batch execution', async () => {
  batch.mockImplementation(async (calls: any[]) => calls[0]?.name === 'read_file'
    ? calls.map(() => ({ success: true, result: { text: 'File contents.' } }))
    : []);
  const state = await start('Read my file');
  const followup = new PassThrough();
  post.mockResolvedValueOnce({ data: followup });
  for (const path of ['one.txt', 'two.txt']) {
    state.stream.write(JSON.stringify({ message: { tool_calls: [{ function: { name: 'read_file', arguments: { path } } }] }, done: false }) + '\n');
  }
  state.stream.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
  await tick();
  expect(batch.mock.calls.filter(call => call[0][0]?.name === 'read_file')[0][0]).toEqual([
    { name: 'read_file', arguments: { path: 'one.txt' } },
    { name: 'read_file', arguments: { path: 'two.txt' } },
  ]);
  expect(state.onToolCall).toHaveBeenCalledWith('read_file', { path: 'one.txt' });
  expect(state.onToolCall).toHaveBeenCalledWith('read_file', { path: 'two.txt' });
  followup.end(record('Both files have been read.', true));
  await tick();
  expect(state.onEnd).toHaveBeenCalledTimes(1);
  expect(state.onError).not.toHaveBeenCalled();
});

test('a synthesis request with noTools cannot execute hallucinated tool calls', async () => {
  const stream = new PassThrough();
  post.mockResolvedValueOnce({ data: stream });
  const onEnd = jest.fn();
  const onToolCall = jest.fn();
  const onError = jest.fn();
  await streamFromOllamaWithTools('Read my file', undefined, 'local-stream-test',
    jest.fn(), onToolCall, jest.fn(), onEnd, onError, undefined, undefined, { noTools: true });
  await tick();
  stream.end(JSON.stringify({ message: { content: 'Here is the supplied answer.', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'one.txt' } } }] }, done: true }) + '\n');
  await tick();
  expect(batch).not.toHaveBeenCalled();
  expect(onToolCall).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

test('model failover updates its badge and keeps the successful model for tool followup', async () => {
  const primaryError = Object.assign(new Error('Model not found'), { response: { status: 404 } });
  post.mockRejectedValueOnce(primaryError);
  const fallback = new PassThrough(), followup = new PassThrough();
  post.mockResolvedValueOnce({ data: fallback });
  post.mockResolvedValueOnce({ data: followup });
  batch.mockImplementation(async (calls: any[]) => calls[0]?.name === 'read_file'
    ? [{ success: true, result: { text: 'File contents.' } }] : []);
  const onMeta = jest.fn(), onEnd = jest.fn(), onError = jest.fn();
  await streamFromOllamaWithTools('Read my file', undefined, 'local-stream-test', jest.fn(), jest.fn(), jest.fn(),
    onEnd, onError, undefined, undefined, { conversationPrompt: 'Always mention the friendly tui.' }, onMeta);
  await tick();
  fallback.end(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'one.txt' } } }] }, done: true }) + '\n');
  await tick();
  expect(post).toHaveBeenCalledTimes(3);
  expect(post.mock.calls[2][1].model).toBe(OLLAMA_CHAT_MODEL);
  expect(onMeta).toHaveBeenLastCalledWith({ model: OLLAMA_CHAT_MODEL });
  expect(post.mock.calls[1][1].messages.some((entry: any) => entry.role === 'system' && entry.content.includes('Always mention the friendly tui.'))).toBe(true);
  expect(post.mock.calls[1][1].options.num_ctx).toBe(4096);
  followup.end(record('The friendly tui says the file has been read.', true));
  await tick();
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

test('a quality retry keeps tools disabled rather than offering them again', async () => {
  (getSettings as jest.Mock).mockReturnValue({ chatModel: 'qwen2.5:3b', ollamaUrl: 'http://127.0.0.1:11434' });
  const state = await start('Read my file');
  const retry = new PassThrough();
  post.mockResolvedValueOnce({ data: retry });
  state.stream.end(record('', true));
  await tick();
  expect(post.mock.calls[0][1].tools).toHaveLength(1);
  expect(post.mock.calls[1][1].tools).toBeUndefined();
  retry.end(record('Here is a clear answer after the quality retry.', true));
  await tick();
  expect(state.onEnd).toHaveBeenCalledTimes(1);
  expect(state.onError).not.toHaveBeenCalled();
});
