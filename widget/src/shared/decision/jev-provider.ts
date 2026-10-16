/**
 * TypeSafe "Jev" System One decision provider — Phase 1 STUB.
 *
 * Only used when `decision.provider` is "jev" (default "local"). Plain HTTP
 * POST to {baseUrl}/v1/systemone; no SDK packages. The API key is never stored
 * in settings or code: it comes from the caller or TYPESAFE_API_KEY. Without
 * one, decide() throws DecisionError('disabled'). fetch is injectable so tests
 * never touch the network.
 */
import {
  DecisionError, type DecisionProvider, type DecisionQuestion, type DecisionResult, type DecisionState,
} from './types';

export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const JEV_DEFAULT_MODEL = 'jev-latest';
export const JEV_DEFAULT_TIMEOUT_MS = 5000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JevProviderOptions {
  /** Overrides TYPESAFE_API_KEY. */
  apiKey?: string;
  /** Environment to read TYPESAFE_API_KEY from (default process.env). */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class JevDecisionProvider implements DecisionProvider {
  readonly id = 'jev' as const;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: JevProviderOptions = {}) {
    const env = opts.env ?? (typeof process !== 'undefined' ? process.env : {});
    const key = (opts.apiKey ?? env.TYPESAFE_API_KEY ?? '').trim();
    this.apiKey = key.length > 0 ? key : undefined;
    this.fetchImpl = opts.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as FetchLike : undefined);
    this.baseUrl = (opts.baseUrl ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = opts.model ?? JEV_DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
  }

  /** True when a key is present; the provider is otherwise disabled. */
  get enabled(): boolean {
    return this.apiKey !== undefined;
  }

  async decide(state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult> {
    if (!this.apiKey) {
      throw new DecisionError('disabled', 'Jev decision provider is disabled: TYPESAFE_API_KEY is not set. Set decision.provider back to "local" or provide a key.');
    }
    if (!this.fetchImpl) throw new DecisionError('network', 'No fetch implementation available for the Jev decision provider.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        // Local-only hints (keywords) never leave the machine.
        body: JSON.stringify({
          model: this.model,
          state,
          questions: questions.map(q => {
            const { keywords: _k, ...rest } = q as DecisionQuestion & { keywords?: unknown };
            return rest;
          }),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new DecisionError('timeout', `Jev request timed out after ${this.timeoutMs} ms.`);
      throw new DecisionError('network', `Jev request failed: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new DecisionError('http', `Jev returned HTTP ${res.status}.`, res.status);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new DecisionError('invalid_response', 'Jev response was not valid JSON.');
    }
    return parseJevResult(body, questions);
  }
}

/** Validate the response shape and keep only answers to the questions asked. */
export function parseJevResult(body: unknown, questions: DecisionQuestion[]): DecisionResult {
  if (!isRecord(body) || !isRecord(body.answers)) {
    throw new DecisionError('invalid_response', 'Jev response is missing "answers".');
  }
  const probs = isRecord(body.probabilities) ? body.probabilities : {};
  const conf = isRecord(body.confidence) ? body.confidence : {};
  const out: DecisionResult = { answers: {}, probabilities: {}, confidence: {} };
  for (const q of questions) {
    const a = body.answers[q.id];
    const ok = q.type === 'choice' ? typeof a === 'string' && q.options.includes(a)
      : q.type === 'score' ? typeof a === 'number' && Number.isFinite(a)
      : typeof a === 'boolean';
    if (!ok) throw new DecisionError('invalid_response', `Jev answer for "${q.id}" does not match a ${q.type} question.`);
    out.answers[q.id] = a as string | number | boolean;
    const p = probs[q.id];
    out.probabilities[q.id] = isRecord(p)
      ? Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'number')) as Record<string, number>
      : {};
    const c = conf[q.id];
    out.confidence[q.id] = typeof c === 'number' && c >= 0 && c <= 1 ? c : 0;
  }
  return out;
}
