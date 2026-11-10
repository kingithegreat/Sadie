/**
 * Optional OpenAI-compatible local endpoint: POST /v1/chat/completions on
 * 127.0.0.1. Any OpenAI-style agent can point its base URL here and get tier
 * routing, fallbacks, the spend ledger and the cap for free.
 *
 * model: "auto" (default) picks a tier from the last user message;
 * "router/cheap" | "router/mid" | "router/top" (or just the tier name) forces one.
 * Optional body.router = { files, diffLines, failed } feeds pickTier.
 * Streaming is not supported (stream: true returns 400).
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RouterRequestError, type ModelRouter, type RouterMessage } from './client';
import { SpendCapExceededError } from './ledger';
import { TIER_ORDER, type Tier } from './pick-tier';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function errorBody(message: string, code: string) {
  return { error: { message, type: code, code } };
}

function forcedTier(model: unknown): Tier | undefined {
  if (typeof model !== 'string') return undefined;
  const name = model.replace(/^router\//, '');
  return (TIER_ORDER as readonly string[]).includes(name) ? (name as Tier) : undefined;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createRouterServer(router: ModelRouter): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = (req.url || '/').split('?')[0];
      if (req.method === 'GET' && url === '/health') {
        send(res, 200, { ok: true, mode: router.mode().reason, spend: router.ledger.summary() });
        return;
      }
      if (req.method === 'GET' && url === '/v1/models') {
        send(res, 200, {
          object: 'list',
          data: ['auto', ...TIER_ORDER.map(t => `router/${t}`)].map(id => ({ id, object: 'model', owned_by: 'homebot-model-router' })),
        });
        return;
      }
      if (req.method !== 'POST' || url !== '/v1/chat/completions') {
        send(res, 404, errorBody(`No route for ${req.method} ${url}`, 'not_found'));
        return;
      }
      let body: any;
      try { body = JSON.parse(await readBody(req)); } catch { send(res, 400, errorBody('Request body must be JSON', 'invalid_request_error')); return; }
      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
        send(res, 400, errorBody('messages must be a non-empty array', 'invalid_request_error'));
        return;
      }
      if (body.stream === true) {
        send(res, 400, errorBody('stream: true is not supported by the HomeBot router endpoint', 'invalid_request_error'));
        return;
      }
      const messages = body.messages as RouterMessage[];
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const task = typeof lastUser?.content === 'string' ? lastUser.content : '';
      const hints = body.router && typeof body.router === 'object' ? body.router : {};
      const result = await router.complete({
        task,
        messages,
        tier: forcedTier(body.model),
        files: Number.isFinite(hints.files) ? hints.files : undefined,
        diffLines: Number.isFinite(hints.diffLines) ? hints.diffLines : undefined,
        failed: hints.failed === true,
        sessionId: typeof body.session_id === 'string' ? body.session_id : (typeof req.headers['x-session-id'] === 'string' ? req.headers['x-session-id'] : undefined),
        source: 'endpoint',
        extra: body,
      });
      const raw = result.raw as any;
      send(res, 200, {
        id: raw?.id ?? `homebot-router-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: raw?.choices ?? [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.promptTokens + result.usage.completionTokens,
        },
        router: {
          dry_run: result.dryRun, mode: result.mode, tier: result.tier, cost_usd: result.costUsd,
          cost_estimated: result.costEstimated, month_spent_usd: result.monthSpentUsd, cap_usd: result.capUsd, attempts: result.attempts,
        },
      });
    } catch (e) {
      if (e instanceof SpendCapExceededError) { send(res, 402, errorBody(e.message, e.code)); return; }
      if (e instanceof RouterRequestError) { send(res, 502, errorBody(e.message, 'upstream_error')); return; }
      send(res, 500, errorBody((e as Error)?.message || String(e), 'internal_error'));
    }
  });
}

/** Listen on 127.0.0.1 only. Port 0 picks a free port. */
export function startRouterServer(router: ModelRouter, port = 8787): Promise<{ server: http.Server; url: string }> {
  const server = createRouterServer(router);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}
