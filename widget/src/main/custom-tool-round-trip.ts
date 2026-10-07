import { randomUUID } from 'crypto';
import { streamFromCustomLLM } from './custom-llm-client';
import type { ChatMessage } from './custom-llm-client';
import { executeToolBatch } from './tools';
import type { ToolContext } from './tools';
import type { CustomLLMConfig } from '../shared/types';
import { getSettings, saveSettings } from './config-manager';

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
  requestPermission?: (missing: string[], reason: string) => Promise<{ decision: 'allow_once' | 'always_allow' | 'cancel' }>;
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
        const batch = calls.map(call => ({ name: call.name, arguments: call.arguments }));
        let results = await executeToolBatch(batch, options.context, { signal: options.signal });
        if (!active()) return;
        const blocked = results.length === 1 && results[0].success === false && results[0].status === 'needs_confirmation'
          ? results[0] : undefined;
        if (blocked) {
          const missing = blocked.missingPermissions || [];
          const decision = options.requestPermission
            ? await options.requestPermission(missing, blocked.reason || `This action requires: ${missing.join(', ')}`)
            : undefined;
          if (!active()) return;
          if (!decision || decision.decision === 'cancel') {
            options.onToolResult({ ...blocked, error: decision ? 'User declined permission request' : 'Missing tool permissions' });
            if (!active()) return;
            options.onChunk(decision
              ? 'Okay — I won’t do that. Nothing was changed. If you change your mind, just ask again.'
              : 'That needs a permission I don’t have, so I stopped. You can allow it in Settings → Privacy & Permissions, then ask again.');
            finish();
            return;
          }
          if (decision.decision === 'always_allow') {
            const settings = getSettings();
            saveSettings({ ...settings, permissions: { ...settings.permissions,
              ...Object.fromEntries(missing.map(permission => [permission, true])),
            } });
          }
          results = await executeToolBatch(batch, options.context, {
            ...(decision.decision === 'allow_once' ? { overrideAllowed: missing } : {}), signal: options.signal,
          });
          if (!active()) return;
          if (results.length === 1 && results[0].success === false && results[0].status === 'needs_confirmation') {
            options.onToolResult(results[0]);
            if (!active()) return;
            options.onChunk('That still needs permission, so I stopped. Check Privacy & Permissions in Settings, then ask again.');
            finish();
            return;
          }
        }
        const resultMessages: ChatMessage[] = [];
        for (const [index, call] of calls.entries()) {
          if (!active()) return;
          // A batch-wide permission denial may be returned as a single row.
          const row = results[index] || (results.length === 1 ? results[0] : undefined);
          // Keep success/denial metadata alongside the payload. A failed tool
          // must not reach the model as an apparently successful plain string.
          const result = row || { success: false, error: 'No result was returned for this tool.' };
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
