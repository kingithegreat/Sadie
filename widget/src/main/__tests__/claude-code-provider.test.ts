/**
 * claude-code-provider.test.ts
 * Tests for the 'claude-code' provider in src/main/custom-llm-client.ts —
 * streaming from a local Claude Code CLI on the user's own Claude subscription.
 *
 * child_process is mocked so these never spawn a real CLI or consume plan usage.
 */

jest.mock('axios');
jest.mock('child_process', () => ({ spawn: jest.fn() }));

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import {
  validateCustomLLMConfig,
  fetchAvailableCustomModels,
  streamFromCustomLLM,
} from '../custom-llm-client';
import type { CustomLLMConfig } from '../../shared/types';

const mockSpawn = spawn as unknown as jest.Mock;

const cfg: CustomLLMConfig = {
  name: 'Claude subscription',
  apiUrl: '',
  provider: 'claude-code',
  model: 'sonnet',
  enabled: true,
};

/** A fake child process whose stdout we can feed arbitrary bytes into. */
function makeFakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: jest.fn(), end: jest.fn() };
  child.kill = jest.fn();
  return child;
}

/** Wrap a Claude Code stream_event in its NDJSON envelope. */
const streamEvent = (event: any) => JSON.stringify({ type: 'stream_event', event }) + '\n';
const textDelta = (text: string) =>
  streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } });
const thinkingDelta = (thinking: string) =>
  streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } });
const resultEvent = (result: string, isError = false) =>
  JSON.stringify({ type: 'result', subtype: isError ? 'error' : 'success', is_error: isError, result }) + '\n';

/** Drive one streamFromCustomLLM call, feeding `emit` into stdout once spawned. */
function run(
  emit: (child: any) => void,
  overrides: Partial<CustomLLMConfig> = {},
): Promise<{ text: string; error: any; child: any }> {
  return new Promise((resolve) => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    let text = '';
    streamFromCustomLLM(
      'hello',
      [],
      { ...cfg, ...overrides },
      'You are HomeBot.',
      (chunk) => { text += chunk; },
      () => resolve({ text, error: null, child }),
      (error) => resolve({ text, error, child }),
    );

    setImmediate(() => emit(child));
  });
}

beforeEach(() => { mockSpawn.mockReset(); });

describe('claude-code config', () => {
  test('is valid with no API key and no API URL', () => {
    expect(validateCustomLLMConfig(cfg)).toEqual({ valid: true });
  });

  test('still requires a model', () => {
    const result = validateCustomLLMConfig({ ...cfg, model: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/model/i);
  });

  test('is ordered lightest-first so the plan-heavy models are a deliberate pick', async () => {
    const ids = (await fetchAvailableCustomModels({ provider: 'claude-code' })).map(m => m.id);
    expect(ids).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });

  test('other providers still require an API key', () => {
    const result = validateCustomLLMConfig({
      ...cfg, provider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', apiKey: undefined,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/API key/i);
  });

  test('lists CLI aliases without needing an endpoint', async () => {
    const models = await fetchAvailableCustomModels({ provider: 'claude-code' });
    // These are Claude Code's own `--model` aliases, per its --help: "an alias
    // for the latest model (e.g. 'fable', 'opus', or 'sonnet')". fable was
    // missing from the first version of this list.
    expect(models.map(m => m.id).sort()).toEqual(['fable', 'haiku', 'opus', 'sonnet']);
    // Aliases, not dated API IDs — so they cannot go stale as models are retired.
    expect(models.every(m => !/\d{8}/.test(m.id))).toBe(true);
  });
});

describe('claude-code streaming', () => {
  test('forwards text deltas and ends on result', async () => {
    const { text, error } = await run((child) => {
      child.stdout.emit('data', Buffer.from(textDelta('Hello ')));
      child.stdout.emit('data', Buffer.from(textDelta('world')));
      child.stdout.emit('data', Buffer.from(resultEvent('Hello world')));
    });
    expect(error).toBeNull();
    expect(text).toBe('Hello world');
  });

  test('never leaks thinking deltas into assistant output', async () => {
    const { text } = await run((child) => {
      child.stdout.emit('data', Buffer.from(thinkingDelta('internal reasoning')));
      child.stdout.emit('data', Buffer.from(textDelta('visible')));
      child.stdout.emit('data', Buffer.from(resultEvent('visible')));
    });
    expect(text).toBe('visible');
    expect(text).not.toMatch(/internal reasoning/);
  });

  test('handles NDJSON split across chunk boundaries', async () => {
    const line = textDelta('split-safe');
    const cut = Math.floor(line.length / 2);
    const { text, error } = await run((child) => {
      child.stdout.emit('data', Buffer.from(line.slice(0, cut)));
      child.stdout.emit('data', Buffer.from(line.slice(cut)));
      child.stdout.emit('data', Buffer.from(resultEvent('split-safe')));
    });
    expect(error).toBeNull();
    expect(text).toBe('split-safe');
  });

  test('falls back to the result payload when no deltas arrived', async () => {
    const { text } = await run((child) => {
      child.stdout.emit('data', Buffer.from(resultEvent('only-final')));
    });
    expect(text).toBe('only-final');
  });

  test('surfaces an error result', async () => {
    const { error } = await run((child) => {
      child.stdout.emit('data', Buffer.from(resultEvent('rate limit reached', true)));
    });
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/rate limit reached/);
  });

  test('gives an actionable error when the CLI is missing', async () => {
    const { error } = await run((child) => {
      const enoent: any = new Error('spawn claude ENOENT');
      enoent.code = 'ENOENT';
      child.emit('error', enoent);
    });
    expect(error.message).toMatch(/not found/i);
    expect(error.message).toMatch(/install/i);
  });

  test('reports a non-zero exit with stderr detail', async () => {
    const { error } = await run((child) => {
      child.stderr.emit('data', Buffer.from('not logged in'));
      child.emit('close', 1);
    });
    expect(error.message).toMatch(/exited with code 1/);
    expect(error.message).toMatch(/not logged in/);
  });
});

describe('claude-code invocation flags', () => {
  test('passes the flags that keep per-call context small', async () => {
    await run((child) => { child.stdout.emit('data', Buffer.from(resultEvent('ok'))); });

    const args: string[] = mockSpawn.mock.calls[0][1];

    // Replacing the system prompt, denying tools, and clearing MCP servers is
    // what takes a call from ~32.8k tokens down to ~780. Losing any of these
    // silently makes the provider burn the user's plan limits.
    expect(args).toContain('--system-prompt');
    expect(args).toContain('--disallowed-tools');
    expect(args).toContain('--mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');

    // Streaming + machine-readable output.
    expect(args).toContain('-p');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--include-partial-messages');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');

    // --bare would disable OAuth and force an API key, defeating the provider.
    expect(args).not.toContain('--bare');

    // The prompt goes over stdin, never argv — Windows argv limits and quoting.
    expect(child_stdinWrote()).toBe(true);
  });

  test('honours a configured CLI path override', async () => {
    await run(
      (child) => { child.stdout.emit('data', Buffer.from(resultEvent('ok'))); },
      { apiUrl: 'C:\\tools\\claude.exe' },
    );
    expect(mockSpawn.mock.calls[0][0]).toBe('C:\\tools\\claude.exe');
  });

  function child_stdinWrote(): boolean {
    const child = mockSpawn.mock.results[0].value;
    return child.stdin.write.mock.calls.length > 0 && child.stdin.end.mock.calls.length > 0;
  }
});

describe('claude-code is not an HTTP provider (the "Invalid URL" class)', () => {
  const { PROVIDER_API_URLS } = require('../custom-llm-client');

  it('has NO entry in PROVIDER_API_URLS — and must never get one', () => {
    // The Quiz panel showed "Invalid URL" because three features each did
    //   cfg.apiUrl || PROVIDER_API_URLS[cfg.provider] || ''
    // and then POSTed to it. claude-code is a CLI subprocess: it has no
    // endpoint, so that resolved to ''. The fix routes those callers through
    // generateFromCustomLLM instead. Adding a placeholder URL here would make
    // the symptom disappear while sending requests into the void — this test
    // exists to reject that shortcut.
    expect(PROVIDER_API_URLS['claude-code']).toBeUndefined();
  });

  it('exposes a non-streaming generator so callers never hand-roll HTTP', () => {
    const { generateFromCustomLLM } = require('../custom-llm-client');
    expect(typeof generateFromCustomLLM).toBe('function');
  });
});
