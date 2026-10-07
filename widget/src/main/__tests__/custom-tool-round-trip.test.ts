jest.mock('../custom-llm-client', () => ({ streamFromCustomLLM: jest.fn() }));
jest.mock('../tools', () => ({ executeToolBatch: jest.fn() }));
import { streamFromCustomLLM } from '../custom-llm-client';
import { executeToolBatch } from '../tools';
import { createCustomToolRoundTrip } from '../custom-tool-round-trip';
import type { CustomLLMConfig } from '../../shared/types';

function start() {
  const controller = new AbortController();
  const onChunk = jest.fn(), onToolCall = jest.fn(), onToolResult = jest.fn(), onEnd = jest.fn(), onError = jest.fn();
  const context = { executionId: 'fixture', requestConfirmation: jest.fn() };
  const handler = createCustomToolRoundTrip({
    message: 'Find both files', history: [], systemPrompt: 'system', apiConfig: {} as CustomLLMConfig,
    signal: controller.signal, context, onChunk, onToolCall, onToolResult, onEnd, onError,
  });
  return { ...handler, callbacks: { onChunk, onToolCall, onToolResult, onEnd, onError }, controller, context };
}

beforeEach(() => jest.clearAllMocks());

test('coordinates two tools into one permission-gated batch, complete transcript and terminal callback', async () => {
  (executeToolBatch as jest.Mock).mockResolvedValue([{ result: 'First result' }, { result: 'Second result' }]);
  (streamFromCustomLLM as jest.Mock).mockImplementation(async (...args) => { args[4]('Summary'); args[5](); return { cancel: () => {} }; });
  const call = start();
  call.onChunk('Checking both.');
  call.onToolCall({ id: 'first', name: 'read_file', arguments: { path: 'a' } });
  call.onToolCall({ id: 'second', name: 'read_file', arguments: { path: 'b' } });
  expect(executeToolBatch).not.toHaveBeenCalled();
  await call.onEnd();
  await call.onEnd();
  expect(executeToolBatch).toHaveBeenCalledTimes(1);
  expect(executeToolBatch).toHaveBeenCalledWith([
    { name: 'read_file', arguments: { path: 'a' } }, { name: 'read_file', arguments: { path: 'b' } },
  ], call.context);
  expect(streamFromCustomLLM).toHaveBeenCalledTimes(1);
  const history = (streamFromCustomLLM as jest.Mock).mock.calls[0][1];
  expect(history[1].content).toBe('Checking both.');
  expect(history[1].tool_calls.map((tool: any) => tool.id)).toEqual(['first', 'second']);
  expect(history.slice(2)).toEqual([
    { role: 'tool', content: 'First result', tool_call_id: 'first' },
    { role: 'tool', content: 'Second result', tool_call_id: 'second' },
  ]);
  expect(call.callbacks.onToolResult.mock.calls.flat()).toEqual(['First result', 'Second result']);
  expect(call.callbacks.onEnd).toHaveBeenCalledTimes(1);
  expect(call.callbacks.onError).not.toHaveBeenCalled();
});

test('cancel while tools are pending prevents result delivery and followup', async () => {
  let resolve!: (results: any[]) => void;
  (executeToolBatch as jest.Mock).mockReturnValue(new Promise(res => { resolve = res; }));
  const call = start();
  call.onToolCall({ name: 'read_file', arguments: {} });
  const pending = call.onEnd();
  call.controller.abort();
  resolve([{ result: 'late' }]);
  await pending;
  expect(streamFromCustomLLM).not.toHaveBeenCalled();
  expect(call.callbacks.onToolResult).not.toHaveBeenCalled();
  expect(call.callbacks.onEnd).toHaveBeenCalledTimes(1);
});

test('generates one matching id for a tool call missing a provider id', async () => {
  (executeToolBatch as jest.Mock).mockResolvedValue([{ result: 'ok' }]);
  const call = start();
  call.onToolCall({ name: 'read_file', arguments: {} });
  await call.onEnd();
  const history = (streamFromCustomLLM as jest.Mock).mock.calls[0][1];
  expect(history[1].tool_calls[0].id).toMatch(/^call_/);
  expect(history[2].tool_call_id).toBe(history[1].tool_calls[0].id);
});

test('a failed tool batch reports an error once and does not synthesize a reply', async () => {
  (executeToolBatch as jest.Mock).mockRejectedValue(new Error('Tool failed'));
  const call = start();
  call.onToolCall({ name: 'read_file', arguments: {} });
  await call.onEnd();
  call.onError(new Error('late'));
  expect(call.callbacks.onError).toHaveBeenCalledTimes(1);
  expect(call.callbacks.onEnd).not.toHaveBeenCalled();
  expect(streamFromCustomLLM).not.toHaveBeenCalled();
});
