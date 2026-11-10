/**
 * HomeBot chat through the router. Chat turns default to the cheap tier (or
 * chat.defaultTier), hard topics go up to chat.maxTier (mid by default), and a
 * failed attempt escalates one tier at a time like coder calls.
 *
 * Chat, the CLI coder, the local endpoint and vibe-code all build their router
 * with createRouter(), so they share ONE ledger file and ONE monthly cap.
 */

import { loadRouterConfig, type Env, type LoadConfigOptions } from './config';
import { ModelRouter, formatRouteBadge, stableSessionId, type FetchLike, type RouteResult, type RouterMessage } from './client';
import { SpendLedger } from './ledger';
import { pickChatTier } from './pick-tier';

export interface CreateRouterOptions extends LoadConfigOptions {
  fetch?: FetchLike;
  now?: () => Date;
}

export function createRouter(options: CreateRouterOptions = {}): ModelRouter {
  const env: Env = options.env ?? process.env;
  const config = loadRouterConfig({ ...options, env });
  const ledger = new SpendLedger(config.ledgerPath, config.monthlyCapUsd, options.now);
  return new ModelRouter({ config, ledger, fetch: options.fetch, env, now: options.now });
}

export interface ChatTurn {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
  conversationId: string;
  signal?: AbortSignal;
}

export interface ChatTurnResult {
  route: RouteResult;
  /** Reply text plus the model / cost line, ready for chat. */
  display: string;
}

export async function routeChatTurn(router: ModelRouter, turn: ChatTurn): Promise<ChatTurnResult> {
  const messages: RouterMessage[] = [];
  if (turn.systemPrompt) messages.push({ role: 'system', content: turn.systemPrompt });
  for (const m of turn.history ?? []) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: turn.message });
  const tier = pickChatTier(turn.message, router.config.chat);
  const route = await router.complete({
    task: turn.message,
    messages,
    tier,
    // One session per conversation keeps the provider cache warm across turns.
    sessionId: stableSessionId(`chat:${turn.conversationId}`),
    source: 'chat',
    signal: turn.signal,
  });
  return { route, display: `${route.content}\n\n---\n*${formatRouteBadge(route)}*` };
}
