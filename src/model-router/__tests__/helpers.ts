import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RouterFetch } from '../client';
import { REPO_DEFAULT_CONFIG_PATH } from '../config';

export interface MockCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

export type MockReply = { status?: number; body?: unknown } | Error;

/** A fetch that records calls and plays back canned replies. No network, ever. */
export function mockFetch(replies: MockReply[] | ((call: MockCall, index: number) => MockReply)): { fetch: RouterFetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetch: RouterFetch = async (url, init) => {
    const call: MockCall = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    const reply = typeof replies === 'function' ? replies(call, calls.length - 1) : replies[calls.length - 1];
    if (!reply) throw new Error(`mockFetch: no reply for call ${calls.length}`);
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => (reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)) };
  };
  return { fetch, calls };
}

export function completion(content: string, opts: { model?: string; cost?: number; prompt?: number; completion?: number; cached?: number } = {}) {
  return {
    status: 200,
    body: {
      id: 'gen-test',
      model: opts.model ?? 'qwen/qwen3.7-flash',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: opts.prompt ?? 100,
        completion_tokens: opts.completion ?? 20,
        prompt_tokens_details: { cached_tokens: opts.cached ?? 0 },
        ...(opts.cost !== undefined ? { cost: opts.cost } : {}),
      },
    },
  };
}

export function tempDir(prefix = 'model-router-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Env for tests: a fake key only matters when live is also switched on. */
export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { MODEL_ROUTER_CONFIG: REPO_DEFAULT_CONFIG_PATH, ...overrides };
}

export const LIVE_ENV = { MODEL_ROUTER_LIVE: '1', OPENROUTER_API_KEY: 'test-key-not-real' };

/** Fail loudly if anything reaches for the real global fetch. */
export function forbidRealFetch(): void {
  const original = (globalThis as any).fetch;
  beforeAll(() => { (globalThis as any).fetch = () => { throw new Error('real fetch is forbidden in model-router tests'); }; });
  afterAll(() => { (globalThis as any).fetch = original; });
}
