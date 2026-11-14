/**
 * Router config loading. Model IDs, fallbacks, caps and prices live in a JSON
 * file (config/model-router.json by default), never in code.
 *
 * Resolution order, first hit wins:
 *   1. an explicit path (CLI --config, or a caller option)
 *   2. MODEL_ROUTER_CONFIG in the environment
 *   3. ~/.homebot/model-router/config.json (shared by the CLI and the app)
 *   4. the repo default config/model-router.json (or a caller-supplied
 *      fallback object, which is how the Electron bundle ships it)
 *
 * Env overrides applied last: MODEL_ROUTER_MONTHLY_CAP_USD,
 * MODEL_ROUTER_LEDGER, MODEL_ROUTER_LIVE.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TIER_ORDER, type RouterTier, type ChatTierPolicy } from './pick-tier';

export interface PricePerMillion {
  prompt: number;
  completion: number;
}

export interface TierConfig {
  model: string;
  fallbacks: string[];
  maxTokens: number;
  maxPrice: PricePerMillion;
  /** List price, only used to estimate cost when a response has no usage.cost. */
  pricing?: PricePerMillion;
}

export interface RouterConfig {
  baseUrl: string;
  monthlyCapUsd: number;
  /** Live calls also need OPENROUTER_API_KEY in the environment. */
  live: boolean;
  ledgerPath: string;
  cacheControlPrefixes: string[];
  cacheTtl: '5m' | '1h' | null;
  requireParameters: boolean;
  chat: ChatTierPolicy;
  tiers: Record<RouterTier, TierConfig>;
  /** Where the config came from, for messages. */
  source: string;
}

export class RouterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouterConfigError';
  }
}

export type Env = Record<string, string | undefined>;

export function homebotRouterDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.homebot', 'model-router');
}

export function defaultLedgerPath(homeDir?: string): string {
  return path.join(homebotRouterDir(homeDir), 'ledger.json');
}

/** The repo's committed default config. */
export const REPO_DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'model-router.json');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTier(value: unknown): value is RouterTier {
  return typeof value === 'string' && (TIER_ORDER as readonly string[]).includes(value);
}

function modelId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^~?[\w.-]+\/[\w.:-]+$/.test(value.trim())) {
    throw new RouterConfigError(`${where} must be an OpenRouter model ID like "vendor/model", got ${JSON.stringify(value)}`);
  }
  return value.trim();
}

function positive(value: unknown, where: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RouterConfigError(`${where} must be a ${allowZero ? 'non-negative' : 'positive'} number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function price(value: unknown, where: string): PricePerMillion {
  if (!isObject(value)) throw new RouterConfigError(`${where} must be an object with prompt and completion`);
  return { prompt: positive(value.prompt, `${where}.prompt`, true), completion: positive(value.completion, `${where}.completion`, true) };
}

/** Validate a parsed config object. Throws RouterConfigError with the field at fault. */
export function parseRouterConfig(raw: unknown, source: string, homeDir?: string): RouterConfig {
  if (!isObject(raw)) throw new RouterConfigError(`Router config ${source} must be a JSON object`);
  if (!isObject(raw.tiers)) throw new RouterConfigError(`Router config ${source} is missing "tiers"`);
  const tiersRaw = raw.tiers;
  const tiers = {} as Record<RouterTier, TierConfig>;
  for (const tier of TIER_ORDER) {
    const t = tiersRaw[tier];
    if (!isObject(t)) throw new RouterConfigError(`Router config ${source} is missing tiers.${tier}`);
    const fallbacks = t.fallbacks === undefined ? [] : t.fallbacks;
    if (!Array.isArray(fallbacks)) throw new RouterConfigError(`tiers.${tier}.fallbacks must be an array`);
    tiers[tier] = {
      model: modelId(t.model, `tiers.${tier}.model`),
      fallbacks: fallbacks.map((f, i) => modelId(f, `tiers.${tier}.fallbacks[${i}]`)),
      maxTokens: Math.floor(positive(t.maxTokens, `tiers.${tier}.maxTokens`)),
      maxPrice: price(t.maxPrice, `tiers.${tier}.maxPrice`),
      ...(t.pricing !== undefined ? { pricing: price(t.pricing, `tiers.${tier}.pricing`) } : {}),
    };
  }
  const chatRaw = isObject(raw.chat) ? raw.chat : {};
  const defaultTier = chatRaw.defaultTier ?? 'cheap';
  const maxTier = chatRaw.maxTier ?? 'mid';
  if (!isTier(defaultTier) || !isTier(maxTier)) throw new RouterConfigError('chat.defaultTier and chat.maxTier must be cheap, mid or top');
  const cacheTtl = raw.cacheTtl ?? null;
  if (cacheTtl !== null && cacheTtl !== '5m' && cacheTtl !== '1h') throw new RouterConfigError('cacheTtl must be null, "5m" or "1h"');
  const prefixes = raw.cacheControlPrefixes ?? ['anthropic/', 'qwen/'];
  if (!Array.isArray(prefixes) || prefixes.some(p => typeof p !== 'string')) throw new RouterConfigError('cacheControlPrefixes must be an array of strings');
  const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim().replace(/\/+$/, '') : 'https://openrouter.ai/api/v1';
  const ledgerPath = typeof raw.ledgerPath === 'string' && raw.ledgerPath.trim() ? raw.ledgerPath.trim() : defaultLedgerPath(homeDir);
  return {
    baseUrl,
    monthlyCapUsd: positive(raw.monthlyCapUsd, 'monthlyCapUsd', true),
    live: raw.live === true,
    ledgerPath,
    cacheControlPrefixes: prefixes as string[],
    cacheTtl: cacheTtl as RouterConfig['cacheTtl'],
    requireParameters: raw.requireParameters !== false,
    chat: { defaultTier, maxTier },
    tiers,
    source,
  };
}

export interface LoadConfigOptions {
  path?: string;
  env?: Env;
  homeDir?: string;
  /** Used instead of the repo file when nothing else is found (Electron bundle). */
  fallback?: unknown;
}

export function resolveConfigPath(options: LoadConfigOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  if (options.path) return path.resolve(options.path);
  if (env.MODEL_ROUTER_CONFIG) return path.resolve(env.MODEL_ROUTER_CONFIG);
  const shared = path.join(homebotRouterDir(options.homeDir), 'config.json');
  if (fs.existsSync(shared)) return shared;
  if (options.fallback !== undefined) return undefined;
  return REPO_DEFAULT_CONFIG_PATH;
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value || '').trim());
}

export function loadRouterConfig(options: LoadConfigOptions = {}): RouterConfig {
  const env = options.env ?? process.env;
  const file = resolveConfigPath(options);
  let raw: unknown;
  let source: string;
  if (file) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      throw new RouterConfigError(`Router config not found at ${file}`);
    }
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new RouterConfigError(`Router config ${file} is not valid JSON: ${(e as Error).message}`);
    }
    source = file;
  } else {
    raw = options.fallback;
    source = 'bundled default config/model-router.json';
  }
  const config = parseRouterConfig(raw, source, options.homeDir);
  if (env.MODEL_ROUTER_MONTHLY_CAP_USD !== undefined && env.MODEL_ROUTER_MONTHLY_CAP_USD !== '') {
    config.monthlyCapUsd = positive(Number(env.MODEL_ROUTER_MONTHLY_CAP_USD), 'MODEL_ROUTER_MONTHLY_CAP_USD', true);
  }
  if (env.MODEL_ROUTER_LEDGER) config.ledgerPath = path.resolve(env.MODEL_ROUTER_LEDGER);
  if (env.MODEL_ROUTER_LIVE !== undefined && env.MODEL_ROUTER_LIVE !== '') config.live = truthy(env.MODEL_ROUTER_LIVE);
  return config;
}

export interface LiveDecision {
  live: boolean;
  reason: string;
}

/**
 * A real request needs BOTH live mode switched on (config "live": true,
 * MODEL_ROUTER_LIVE=1 or the CLI --live flag) AND OPENROUTER_API_KEY set.
 * Anything else is a dry run.
 */
export function decideLive(config: RouterConfig, env: Env = process.env): LiveDecision {
  const hasKey = !!(env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.trim());
  if (!config.live) return { live: false, reason: 'dry run (live mode is off; set MODEL_ROUTER_LIVE=1 or pass --live)' };
  if (!hasKey) return { live: false, reason: 'dry run (live mode is on but OPENROUTER_API_KEY is not set)' };
  return { live: true, reason: 'live' };
}
