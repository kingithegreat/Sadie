import { randomUUID } from 'crypto';
import { streamFromCustomLLM } from './custom-llm-client';
import type { ChatMessage } from './custom-llm-client';
import { executeToolBatch } from './tools';
import type { ToolContext } from './tools';
import type { CustomLLMConfig } from '../shared/types';

interface RoundTripOptions {
  message: string;
  history: ChatMessage[];
  apiConfig: CustomLLMConfig;
  systemPrompt: string;
  context: ToolContext;
  signal: AbortSignal;
  onChunk: (text: string) => void;
  onToolCall: (name: string, args: any) => void;
  onToolResult: (result: any) => void;
  onEnd: () => void;
  onError: (error: any) => void;
  onInitialError?: (error: any) => void;
}

/** One response may request several tools. Finish all of them in one transcript. */
export function createCustomToolRoundTrip(options: RoundTripOptions) {
  const calls: Array<{ name: string; arguments: any; id: string }> = [];
  let assistantText = '';
  let responseEnded = false;
  let settled = false;
  const active = () => !settled && !options.signal.aborted;
  const finish = () => {
    if (settled) return;
    settled = true;
    options.signal.removeEventListener('abort', finish);
    options.onEnd();
  };
  const fail = (error: any, initial = false) => {
    if (settled) return;
    settled = true;
    options.signal.removeEventListener('abort', finish);
    (initial && options.onInitialError ? options.onInitialError : options.onError)(error);
  };
  options.signal.addEventListener('abort', finish, { once: true });
  if (options.signal.aborted) finish();

  return {
    onChunk: (text: string) => {
      if (!active() || responseEnded) return;
      assistantText += text;
      options.onChunk(text);
    },
    onToolCall: (call: { name: string; arguments: any; id?: string }) => {
      if (!active() || responseEnded) return;
      calls.push({ ...call, id: call.id || `call_${randomUUID()}` });
      options.onToolCall(call.name, call.arguments);
    },
    onError: (error: any) => fail(error, true),
    onEnd: async () => {
      if (!active() || responseEnded) return;
      responseEnded = true;
      if (!calls.length) { finish(); return; }
      try {
        const results = await executeToolBatch(
          calls.map(call => ({ name: call.name, arguments: call.arguments })), options.context,
        );
        if (!active()) return;
        const resultMessages: ChatMessage[] = [];
        for (const [index, call] of calls.entries()) {
          if (!active()) return;
          // A batch-wide permission denial may be returned as a single row.
          const row = results[index] || (results.length === 1 ? results[0] : undefined);
          const result = row?.result ?? row?.error ?? row ?? 'No result';
          options.onToolResult(result);
          resultMessages.push({ role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result), tool_call_id: call.id });
        }
        const history: ChatMessage[] = [
          ...options.history,
          { role: 'user', content: options.message },
          { role: 'assistant', content: assistantText, tool_calls: calls.map(call => ({
            id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })) },
          ...resultMessages,
        ];
        if (!active()) return;
        await streamFromCustomLLM('', history, options.apiConfig, options.systemPrompt,
          text => { if (active()) options.onChunk(text); }, finish, fail, options.signal);
      } catch (error) { if (active()) fail(error); }
    },
  };
}
