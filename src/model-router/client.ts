/**
 * OpenRouter chat-completions client with tiered routing.
 *
 * One request per attempt, shaped the way the research note recommends:
 *   - models[]: the tier's primary then its fallbacks (OpenRouter tries them in order)
 *   - session_id: stable for the whole task, so sticky routing keeps the cache warm
 *   - cache_control: only for anthropic/ and qwen/ primaries (others cache automatically)
 *   - max_tokens and provider.max_price from the tier config
 * On a failed attempt the router escalates one tier (cheap -> mid -> top), at
 * most once per tier, and never past top.
 *
 * DRY RUN IS THE DEFAULT. Nothing goes over the network unless live mode is
 * enabled AND OPENROUTER_API_KEY is set (see decideLive).
 */

import { createHash } from 'node:crypto';
import { decideLive, type Env, type RouterConfig } from './config';
import { SpendLedger } from './ledger';
import { escalateTier, pickTier, type Tier } from './pick-tier';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface RouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  [key: string]: unknown;
}

export interface OpenRouterChatBody {
  models: string[];
  messages: RouterMessage[];
  session_id: string;
  max_tokens: number;
  provider: { max_price: { prompt: number; completion: number }; require_parameters: boolean };
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  usage: { include: true };
  [key: string]: unknown;
}

/** Request fields a caller may pass through untouched (endpoint clients use these). */
const PASSTHROUGH_KEYS = ['temperature', 'top_p', 'stop', 'tools', 'tool_choice', 'response_format', 'seed'] as const;

export interface AttemptRecord {
  tier: Tier;
  models: string[];
  ok: boolean;
  status?: number;
  error?: string;
}

export interface RouteRequest {
  /** Task text used for tier picking (and as the user message when messages is absent). */
  task?: string;
  messages?: RouterMessage[];
  files?: number;
  diffLines?: number;
  failed?: boolean;
  /** Skip pickTier and start at this tier. */
  tier?: Tier;
  sessionId?: string;
  /** Who is spending: coder, chat, endpoint, vibe-code. Recorded in the ledger. */
  source?: string;
  /** Content returned in dry-run mode instead of the generic mock text. */
  mockContent?: string;
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface RouteResult {
  dryRun: boolean;
  /** Human-readable reason for dry run vs live. */
  mode: string;
  tier: Tier;
  /** The model that answered (live) or the primary that would have (dry run). */
  model: string;
  content: string;
  costUsd: number;
  /** True for dry-run estimates and for live responses with no usage.cost. */
  costEstimated: boolean;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number };
  sessionId: string;
  attempts: AttemptRecord[];
  /** The last request body sent (or, in dry run, that would have been sent). Never contains the key. */
  request: OpenRouterChatBody;
  monthSpentUsd: number;
  capUsd: number;
  raw?: unknown;
}

export class RouterRequestError extends Error {
  constructor(message: string, readonly attempts: AttemptRecord[], readonly status?: number) {
    super(message);
    this.name = 'RouterRequestError';
  }
}

export function stableSessionId(seed: string): string {
  return `homebot-${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}

export function usesCacheControl(config: RouterConfig, model: string): boolean {
  return config.cacheControlPrefixes.some(prefix => model.startsWith(prefix));
}

export function buildChatRequest(
  config: RouterConfig,
  tier: Tier,
  messages: RouterMessage[],
  sessionId: string,
  extra: Record<string, unknown> = {},
): OpenRouterChatBody {
  const t = config.tiers[tier];
  const body: OpenRouterChatBody = {
    models: [t.model, ...t.fallbacks],
    messages,
    session_id: sessionId,
    max_tokens: t.maxTokens,
    provider: { max_price: { prompt: t.maxPrice.prompt, completion: t.maxPrice.completion }, require_parameters: config.requireParameters },
    usage: { include: true },
  };
  if (usesCacheControl(config, t.model)) {
    body.cache_control = config.cacheTtl ? { type: 'ephemeral', ttl: config.cacheTtl } : { type: 'ephemeral' };
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (extra[key] !== undefined) body[key] = extra[key];
  }
  return body;
}

/** Rough token estimate (chars / 4) for dry-run cost previews. */
export function estimateTokens(messages: RouterMessage[]): number {
  const chars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length), 0);
  return Math.ceil(chars / 4);
}

export function estimateCostUsd(config: RouterConfig, tier: Tier, promptTokens: number, completionTokens: number): number {
  const t = config.tiers[tier];
  const p = t.pricing ?? t.maxPrice;
  return (promptTokens * p.prompt + completionTokens * p.completion) / 1_000_000;
}

/** Errors that another tier cannot fix: bad key, no credits, OpenRouter key limit. */
function isTerminalStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

function messageText(messages: RouterMessage[]): string {
  return messages.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');
}

export interface ModelRouterOptions {
  config: RouterConfig;
  ledger?: SpendLedger;
  fetch?: FetchLike;
  env?: Env;
  now?: () => Date;
}

export class ModelRouter {
  readonly config: RouterConfig;
  readonly ledger: SpendLedger;
  private readonly fetchImpl?: FetchLike;
  private readonly env: Env;

  constructor(options: ModelRouterOptions) {
    this.config = options.config;
    this.ledger = options.ledger ?? new SpendLedger(options.config.ledgerPath, options.config.monthlyCapUsd, options.now);
    this.fetchImpl = options.fetch;
    this.env = options.env ?? process.env;
  }

  mode() {
    return decideLive(this.config, this.env);
  }

  async complete(req: RouteRequest): Promise<RouteResult> {
    const messages: RouterMessage[] = req.messages?.length ? req.messages : [{ role: 'user', content: req.task ?? '' }];
    const taskText = req.task ?? messageText(messages.filter(m => m.role === 'user'));
    const startTier: Tier = req.tier ?? pickTier(taskText, req.files ?? -1, req.diffLines ?? -1, req.failed ?? false);
    const sessionId = req.sessionId ?? stableSessionId(taskText);
    const source = req.source ?? 'coder';
    const decision = this.mode();

    // The cap applies to dry runs too, so a capped month is obvious before Aden flips live on.
    this.ledger.assertUnderCap();

    if (!decision.live) {
      const request = buildChatRequest(this.config, startTier, messages, sessionId, req.extra);
      const t = this.config.tiers[startTier];
      const content = req.mockContent
        ?? `[dry run] No request was sent. HomeBot would ask ${request.models.join(' -> ')} (${startTier} tier).`;
      const promptTokens = estimateTokens(messages);
      const completionTokens = Math.ceil(content.length / 4);
      return {
        dryRun: true,
        mode: decision.reason,
        tier: startTier,
        model: t.model,
        content,
        costUsd: estimateCostUsd(this.config, startTier, promptTokens, completionTokens),
        costEstimated: true,
        usage: { promptTokens, completionTokens, cachedTokens: 0 },
        sessionId,
        attempts: [{ tier: startTier, models: request.models, ok: true }],
        request,
        monthSpentUsd: this.ledger.monthTotal(),
        capUsd: this.ledger.capUsd,
      };
    }

    const fetchImpl = this.fetchImpl ?? ((globalThis as unknown as { fetch?: FetchLike }).fetch);
    if (!fetchImpl) throw new RouterRequestError('No fetch implementation available for a live call', []);
    const apiKey = (this.env.OPENROUTER_API_KEY || '').trim();
    const attempts: AttemptRecord[] = [];
    const triedTiers = new Set<Tier>();
    let tier = startTier;

    for (;;) {
      triedTiers.add(tier);
      this.ledger.assertUnderCap();
      const request = buildChatRequest(this.config, tier, messages, sessionId, req.extra);
      let status: number | undefined;
      let failure = "";
      try {
        const res = await fetchImpl(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/kingithegreat/Sadie',
            'X-Title': 'HomeBot model router',
          },
          body: JSON.stringify(request),
          signal: req.signal,
        });
        status = res.status;
        const text = await res.text();
        let json: any;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
        if (!res.ok) {
          const detail = json?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
          failure = `HTTP ${res.status}: ${detail}`;
        } else {
          const choice = json?.choices?.[0];
          const content: string = typeof choice?.message?.content === 'string' ? choice.message.content : '';
          const hasToolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0;
          if (!content.trim() && !hasToolCalls) {
            failure = json?.error?.message ? `provider error: ${json.error.message}` : 'empty completion';
          } else {
            attempts.push({ tier, models: request.models, ok: true, status });
            const usage = json.usage ?? {};
            const promptTokens = Number(usage.prompt_tokens) || 0;
            const completionTokens = Number(usage.completion_tokens) || 0;
            const cachedTokens = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
            const reportedCost = typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : undefined;
            const costUsd = reportedCost ?? estimateCostUsd(this.config, tier, promptTokens, completionTokens);
            const model = typeof json.model === 'string' && json.model ? json.model : request.models[0];
            this.ledger.record({
              source, tier, model, sessionId, promptTokens, completionTokens, cachedTokens, costUsd,
              estimated: reportedCost === undefined,
            });
            return {
              dryRun: false,
              mode: decision.reason,
              tier,
              model,
              content,
              costUsd,
              costEstimated: reportedCost === undefined,
              usage: { promptTokens, completionTokens, cachedTokens },
              sessionId,
              attempts,
              request,
              monthSpentUsd: this.ledger.monthTotal(),
              capUsd: this.ledger.capUsd,
              raw: json,
            };
          }
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        failure = `network error: ${(e as Error)?.message || String(e)}`;
      }

      attempts.push({ tier, models: request.models, ok: false, status, error: failure });
      if (status !== undefined && isTerminalStatus(status)) {
        throw new RouterRequestError(`OpenRouter refused the request (${failure}). Not escalating: another tier would fail the same way.`, attempts, status);
      }
      const next = escalateTier(tier);
      if (next === tier || triedTiers.has(next)) {
        throw new RouterRequestError(`All tiers failed (${attempts.map(a => `${a.tier}: ${a.error}`).join('; ')})`, attempts, status);
      }
      tier = next;
    }
  }
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(4)}`;
}

/** One line for chat: which model answered and what it cost. Dry runs are labelled mock. */
export function formatRouteBadge(result: Pick<RouteResult, 'dryRun' | 'tier' | 'model' | 'costUsd' | 'costEstimated' | 'monthSpentUsd' | 'capUsd'>): string {
  const cost = result.dryRun
    ? `${formatUsd(result.costUsd)} (mock estimate, dry run, nothing was sent or billed)`
    : `${formatUsd(result.costUsd)}${result.costEstimated ? ' (estimated)' : ''}`;
  return `Model: ${result.model} (${result.tier} tier) · Cost: ${cost} · Month: ${formatUsd(result.monthSpentUsd)} of $${result.capUsd.toFixed(2)} cap`;
}
