jest.mock('../custom-llm-client', () => ({ streamFromCustomLLM: jest.fn() }));
jest.mock('../tools', () => ({ executeToolBatch: jest.fn() }));
jest.mock('../config-manager', () => ({ getSettings: jest.fn(), saveSettings: jest.fn() }));
import { streamFromCustomLLM } from '../custom-llm-client';
import { executeToolBatch } from '../tools';
import { createCustomToolRoundTrip } from '../custom-tool-round-trip';
import type { CustomLLMConfig } from '../../shared/types';
import { getSettings, saveSettings } from '../config-manager';

function start(requestPermission?: (missing: string[], reason: string) => Promise<{ decision: 'allow_once' | 'always_allow' | 'cancel' }>) {
  const controller = new AbortController();
  const onChunk = jest.fn(), onToolCall = jest.fn(), onToolResult = jest.fn(), onEnd = jest.fn(), onError = jest.fn();
  const context = { executionId: 'fixture', requestConfirmation: jest.fn() };
  const handler = createCustomToolRoundTrip({
    message: 'Find both files', history: [], systemPrompt: 'system', apiConfig: {} as CustomLLMConfig,
    signal: controller.signal, context, onChunk, onToolCall, onToolResult, onEnd, onError, requestPermission,
  });
  return { ...handler, callbacks: { onChunk, onToolCall, onToolResult, onEnd, onError }, controller, context };
}

beforeEach(() => {
  jest.resetAllMocks();
  (getSettings as jest.Mock).mockReturnValue({ permissions: { web_search: true, write_file: false } });
  (streamFromCustomLLM as jest.Mock).mockImplementation(async (...args) => { args[4]('Summary'); args[5](); return { cancel: () => {} }; });
});

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
  ], call.context, { signal: call.controller.signal });
  expect(streamFromCustomLLM).toHaveBeenCalledTimes(1);
  const history = (streamFromCustomLLM as jest.Mock).mock.calls[0][1];
  expect(history[1].content).toBe('Checking both.');
  expect(history[1].tool_calls.map((tool: any) => tool.id)).toEqual(['first', 'second']);
  expect(history.slice(2)).toEqual([
    { role: 'tool', content: JSON.stringify({ result: 'First result' }), tool_call_id: 'first' },
    { role: 'tool', content: JSON.stringify({ result: 'Second result' }), tool_call_id: 'second' },
  ]);
  expect(call.callbacks.onToolResult.mock.calls.flat()).toEqual([{ result: 'First result' }, { result: 'Second result' }]);
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

const denial = { success: false, status: 'needs_confirmation', missingPermissions: ['read_file'], reason: 'Reading files needs permission' };

test('Allow once reruns precisely the denied batch without persisting a permission', async () => {
  (executeToolBatch as jest.Mock).mockResolvedValueOnce([denial]).mockResolvedValueOnce([{ success: true, result: 'Read result' }]);
  const permission = jest.fn(async () => ({ decision: 'allow_once' as const }));
  const call = start(permission);
  call.onToolCall({ id: 'a', name: 'read_file', arguments: { path: 'a' } });
  await call.onEnd();
  expect(permission).toHaveBeenCalledWith(['read_file'], denial.reason);
  expect(executeToolBatch).toHaveBeenCalledTimes(2);
  expect((executeToolBatch as jest.Mock).mock.calls[1]).toEqual([
    [{ name: 'read_file', arguments: { path: 'a' } }], call.context,
    { overrideAllowed: ['read_file'], signal: call.controller.signal },
  ]);
  expect(saveSettings).not.toHaveBeenCalled();
  expect(call.callbacks.onEnd).toHaveBeenCalledTimes(1);
});

test('Always allow persists only the actual denied permissions and retains previous choices', async () => {
  (executeToolBatch as jest.Mock).mockResolvedValueOnce([denial]).mockResolvedValueOnce([{ success: true, result: 'Read result' }]);
  const call = start(async () => ({ decision: 'always_allow' }));
  call.onToolCall({ id: 'a', name: 'read_file', arguments: {} });
  await call.onEnd();
  expect(saveSettings).toHaveBeenCalledWith({ permissions: { web_search: true, write_file: false, read_file: true } });
  expect((executeToolBatch as jest.Mock).mock.calls[1][2]).toEqual({ signal: call.controller.signal });
});

test.each([true, false])('permission denial or unavailable permission UI stops without synthesis (%s)', async hasUI => {
  (executeToolBatch as jest.Mock).mockResolvedValue([denial]);
  const call = start(hasUI ? async () => ({ decision: 'cancel' }) : undefined);
  call.onToolCall({ name: 'read_file', arguments: {} });
  await call.onEnd();
  expect(executeToolBatch).toHaveBeenCalledTimes(1);
  expect(streamFromCustomLLM).not.toHaveBeenCalled();
  expect(saveSettings).not.toHaveBeenCalled();
  expect(call.callbacks.onToolResult).toHaveBeenCalledWith(expect.objectContaining(denial));
  expect(call.callbacks.onEnd).toHaveBeenCalledTimes(1);
});

test('Stop during permission approval prevents a late permanent grant and tool rerun', async () => {
  (executeToolBatch as jest.Mock).mockResolvedValue([denial]);
  let resolve!: (value: { decision: 'always_allow' }) => void;
  const permission = jest.fn(() => new Promise<{ decision: 'always_allow' }>(res => { resolve = res; }));
  const call = start(permission);
  call.onToolCall({ name: 'read_file', arguments: {} });
  const pending = call.onEnd();
  await new Promise<void>(res => setImmediate(res));
  call.controller.abort();
  resolve({ decision: 'always_allow' });
  await pending;
  expect(saveSettings).not.toHaveBeenCalled();
  expect(executeToolBatch).toHaveBeenCalledTimes(1);
  expect(streamFromCustomLLM).not.toHaveBeenCalled();
  expect(call.callbacks.onEnd).toHaveBeenCalledTimes(1);
});

test('failed results preserve success and error metadata in the followup transcript', async () => {
  (executeToolBatch as jest.Mock).mockResolvedValue([{ success: false, error: 'File does not exist', code: 'NOT_FOUND' }]);
  const call = start();
  call.onToolCall({ id: 'a', name: 'read_file', arguments: {} });
  await call.onEnd();
  const history = (streamFromCustomLLM as jest.Mock).mock.calls[0][1];
  expect(JSON.parse(history[2].content)).toEqual({ success: false, error: 'File does not exist', code: 'NOT_FOUND' });
});
