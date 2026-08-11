/**
 * anthropic-caching-and-limits.test.ts
 *
 * Three defects on the direct Anthropic path, all of which cost money or
 * truncated answers without failing anything:
 *
 *   1. No prompt caching at all. The system prompt and every tool schema were
 *      re-sent in full on every turn. Blocks render tools → system → messages,
 *      so a single cache_control breakpoint at the end of the system block
 *      covers the tool schemas too — the expensive part.
 *   2. max_tokens was a hard-coded 2000 while the metadata table this file
 *      already maintains says Sonnet 5 allows 64000. A long answer was cut off
 *      at 2000 and handed back looking complete.
 *   3. No message_delta handling, so stop_reason and usage were both dropped.
 *      That left truncation indistinguishable from a clean finish, and left
 *      caching unverifiable — a breakpoint that never hits looks exactly like
 *      no caching from the outside.
 *
 * (3) is what makes (1) checkable, which is why it is tested here rather than
 * deferred: cacheRead is the only evidence caching actually works.
 */

jest.mock('axios');

import { EventEmitter } from 'events';
import axios from 'axios';
import { streamFromCustomLLM, getLastAnthropicUsage } from '../custom-llm-client';
import type { CustomLLMConfig } from '../../shared/types';
import type { ToolDefinition } from '../tools/types';

function makeFakeStream() {
  const s: any = new EventEmitter();
  s.destroy = jest.fn();
  return s;
}

const TOOLS: ToolDefinition[] = [
  { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: {}, required: [] } },
];

/**
 * Run one Anthropic request and hand back both the body axios received and the
 * live stream, so a test can feed SSE frames back in.
 */
async function requestFor(opts: {
  model: string;
  system?: string;
  tools?: ToolDefinition[];
}): Promise<{ body: any; stream: any }> {
  const stream = makeFakeStream();
  (axios.post as jest.Mock).mockResolvedValue({ data: stream });

  const cfg: CustomLLMConfig = {
    name: 'test',
    apiUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    model: opts.model,
    provider: 'anthropic',
    enabled: true,
  };

  streamFromCustomLLM(
    'hello', [], cfg, opts.system ?? 'You are HomeBot.',
    () => {}, () => {}, () => {}, undefined, opts.tools,
  );
  await new Promise(r => setTimeout(r, 0));
  return { body: (axios.post as jest.Mock).mock.calls[0][1], stream };
}

/** Feed one SSE frame in exactly the shape Anthropic sends it. */
function sse(stream: any, obj: any) {
  stream.emit('data', Buffer.from(`data: ${JSON.stringify(obj)}\n\n`, 'utf8'));
}

beforeEach(() => { (axios.post as jest.Mock).mockReset(); });

describe('prompt caching', () => {
  test('the system block carries a cache breakpoint', async () => {
    const { body } = await requestFor({ model: 'claude-sonnet-5' });
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[0].text).toContain('HomeBot');
  });

  test('one breakpoint covers the tools too — they are not marked separately', async () => {
    // Tools render BEFORE system, so the system breakpoint already caches them.
    // A second marker would spend one of the four available breakpoints for
    // nothing.
    const { body } = await requestFor({ model: 'claude-sonnet-5', tools: TOOLS });
    expect(body.tools).toHaveLength(2);
    for (const t of body.tools) expect(t.cache_control).toBeUndefined();
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('with no system prompt the last tool is marked instead', async () => {
    // Otherwise there is no block to attach to and the schemas — the bulk of
    // the prefix — would go uncached on every request.
    const { body } = await requestFor({ model: 'claude-sonnet-5', system: '', tools: TOOLS });
    expect(body.system).toBeUndefined();
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
  });
});

/**
 * Two defects reported against this file turned out to be unreachable, and are
 * recorded here so nobody re-reports them from a code read:
 *
 *  - "max_tokens defaults to 2000, so long answers are truncated." The
 *    `maxTokens = 2000` destructuring default in streamAnthropic is dead: the
 *    dispatcher always passes a value from the metadata table. A test asserting
 *    64000 passes with or against the fix, which is how this was caught.
 *  - "An empty model sends 'gpt-3.5-turbo' to Anthropic." The dispatcher does
 *    substitute that ID, but validateConfig rejects an empty model before any
 *    request is built, so it never reaches the wire. The /claude/ guard now in
 *    streamAnthropic is defence in depth, not a live fix.
 *
 * What remains true and is asserted below: an explicitly chosen model is sent
 * verbatim with that model's own ceiling.
 */
describe('model and output ceiling', () => {
  test('an explicitly chosen model is honoured exactly', async () => {
    const { body } = await requestFor({ model: 'claude-3-5-sonnet' });
    expect(body.model).toBe('claude-3-5-sonnet');
    expect(body.max_tokens).toBe(8192);
  });
});

describe('mid-stream errors', () => {
  test('an SSE error frame surfaces as an error, not a short clean answer', async () => {
    // Anthropic sends overloaded/rate-limit failures as data: {"type":"error"}
    // after the headers. With no case for it the turn ended quietly and the
    // partial reply looked finished.
    const errors: any[] = [];
    let endedCleanly = false;
    const stream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: stream });

    streamFromCustomLLM(
      'hello', [],
      { name: 't', apiUrl: 'https://api.anthropic.com/v1', apiKey: 'k',
        model: 'claude-sonnet-5', provider: 'anthropic', enabled: true } as CustomLLMConfig,
      'sys', () => {}, () => { endedCleanly = true; }, (e) => errors.push(e),
    );
    await new Promise(r => setTimeout(r, 0));

    sse(stream, { type: 'message_start', message: { usage: { input_tokens: 1 } } });
    sse(stream, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    stream.emit('end');

    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.message)).toMatch(/overloaded/i);
    expect(endedCleanly).toBe(false);
  });
});

describe('stream bookkeeping', () => {
  test('usage and stop_reason survive the stream, including cache counters', async () => {
    const { stream } = await requestFor({ model: 'claude-sonnet-5' });

    sse(stream, {
      type: 'message_start',
      message: { usage: {
        input_tokens: 12,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 8400,
      } },
    });
    sse(stream, {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 55 },
    });

    const usage = getLastAnthropicUsage();
    expect(usage).not.toBeNull();
    // The one number that proves caching is live rather than merely configured.
    expect(usage!.cacheRead).toBe(8400);
    expect(usage!.inputTokens).toBe(12);
    expect(usage!.outputTokens).toBe(55);
    expect(usage!.stopReason).toBe('end_turn');
  });

  test('a truncated reply says so instead of looking finished', async () => {
    const chunks: string[] = [];
    const stream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: stream });

    streamFromCustomLLM(
      'hello', [],
      { name: 't', apiUrl: 'https://api.anthropic.com/v1', apiKey: 'k',
        model: 'claude-sonnet-5', provider: 'anthropic', enabled: true } as CustomLLMConfig,
      'sys', (c) => chunks.push(c), () => {}, () => {},
    );
    await new Promise(r => setTimeout(r, 0));

    sse(stream, { type: 'message_start', message: { usage: { input_tokens: 1 } } });
    sse(stream, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 64000 } });

    expect(chunks.join('')).toMatch(/cut off/i);
  });

  test('a clean finish adds no truncation notice', async () => {
    const chunks: string[] = [];
    const stream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: stream });

    streamFromCustomLLM(
      'hello', [],
      { name: 't', apiUrl: 'https://api.anthropic.com/v1', apiKey: 'k',
        model: 'claude-sonnet-5', provider: 'anthropic', enabled: true } as CustomLLMConfig,
      'sys', (c) => chunks.push(c), () => {}, () => {},
    );
    await new Promise(r => setTimeout(r, 0));

    sse(stream, { type: 'message_start', message: { usage: { input_tokens: 1 } } });
    sse(stream, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });

    expect(chunks.join('')).not.toMatch(/cut off/i);
  });
});
