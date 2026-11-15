/**
 * episode-script-generator.ts — "Generate episode script" for Media Studio.
 *
 * Turns a one-line premise into a directed episode script by asking the
 * owner's configured OpenAI-compatible provider (Settings → custom LLM) for
 * strict JSON, then validating and normalizing that JSON into exactly the
 * DirectedShot shape script-director produces. Saving reuses
 * directScriptToStoryboard, so a generated script lands on disk the same way
 * an auto-directed one does and Media Studio loads it with the normal
 * storyboard loader.
 *
 * Runs in the main process only: the API key never reaches the renderer, and
 * the request goes only to the endpoint the owner configured for that key.
 */

import type { CustomLLMConfig } from '../../shared/types';
import {
  buildDirectedPrompt,
  detectGenre,
  type CameraFraming,
  type CameraLens,
  type CameraMovement,
  type DirectedShot,
} from './script-director';

export const EPISODE_SCRIPT_SCHEMA_VERSION = 1;
export const MIN_SHOTS = 3;
export const MAX_SHOTS = 8;
export const MAX_PREMISE_CHARS = 4000;

const FRAMINGS: readonly CameraFraming[] = ['wide', 'medium', 'close', 'extreme_close'];
const LENSES: readonly CameraLens[] = ['24mm', '35mm', '50mm', '85mm'];
const MOVEMENTS: readonly CameraMovement[] = ['slow push in', 'pan right', 'tilt up', 'tracking', 'static'];
const BEAT_TYPES: readonly DirectedShot['beatType'][] = ['establishing', 'action', 'investigation', 'conflict', 'climax', 'resolution'];
export const GENRES = ['historical_epic', 'cyberpunk_scifi', 'noir_thriller', 'documentary_nature', 'fantasy_myth', 'action_cinematic'] as const;

/** Providers whose wire format is not OpenAI chat/completions. */
const NON_OPENAI_PROVIDERS = new Set(['anthropic', 'claude-code', 'codex', 'google-gemini']);

export interface EpisodeScript {
  schemaVersion: number;
  title: string;
  logline: string;
  genre: string;
  shots: DirectedShot[];
  totalDurationSec: number;
}

export type EpisodeScriptErrorCode =
  | 'EMPTY_PREMISE'
  | 'NO_PROVIDER'
  | 'UNSUPPORTED_PROVIDER'
  | 'ONLINE_ACCESS_DISABLED'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'BAD_JSON'
  | 'INVALID_SCRIPT';

export class EpisodeScriptError extends Error {
  constructor(public readonly code: EpisodeScriptErrorCode, message: string) {
    super(message);
    this.name = 'EpisodeScriptError';
  }
}

export interface GenerateEpisodeScriptOptions {
  premise: string;
  shotCount?: number;
  genre?: string;
}

export interface GenerateEpisodeScriptDeps {
  /** The owner's saved custom-LLM config (main process; key already decrypted). */
  config: CustomLLMConfig | undefined;
  fetchImpl?: typeof fetch;
  /** Throws when a remote provider is not allowed (the app's Online consent). */
  assertOnline?: (providerLabel: string) => void;
  timeoutMs?: number;
}

export interface ChatCompletionRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

function clampShotCount(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 4;
  return Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, v));
}

export function buildEpisodeScriptMessages(options: GenerateEpisodeScriptOptions): Array<{ role: 'system' | 'user'; content: string }> {
  const shotCount = clampShotCount(options.shotCount);
  const genreHint = options.genre && (GENRES as readonly string[]).includes(options.genre)
    ? options.genre
    : `one of ${GENRES.join(', ')}`;
  const system = [
    'You are a film director writing a short episode script as a shot list.',
    'Reply with ONE JSON object and nothing else: no prose, no markdown fences.',
    'Schema:',
    '{"title": string, "logline": string, "genre": string, "shots": [',
    '  {"title": string, "visual": string, "narration": string,',
    `   "framing": ${FRAMINGS.map(f => `"${f}"`).join('|')},`,
    `   "lens": ${LENSES.map(l => `"${l}"`).join('|')},`,
    `   "movement": ${MOVEMENTS.map(m => `"${m}"`).join('|')},`,
    '   "durationSec": number (4-10),',
    `   "beatType": ${BEAT_TYPES.map(b => `"${b}"`).join('|')},`,
    '   "characters": string[] }',
    ']}',
    '"visual" is what the camera sees (one sentence, no dialogue). "narration" is the spoken line for that shot (under 25 words).',
  ].join('\n');
  const user = [
    `Premise: ${options.premise.trim()}`,
    `Write exactly ${shotCount} shots.`,
    `Genre: ${genreHint}.`,
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** Base URL → chat/completions endpoint, tolerating a trailing slash or a full path. */
export function chatCompletionsUrl(apiUrl: string): string {
  const base = apiUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

export function buildEpisodeScriptRequest(config: CustomLLMConfig, options: GenerateEpisodeScriptOptions): ChatCompletionRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  return {
    url: chatCompletionsUrl(config.apiUrl),
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: buildEpisodeScriptMessages(options),
        response_format: { type: 'json_object' },
        temperature: 0.7,
        stream: false,
      }),
    },
  };
}

/** Pull one JSON object out of a model reply (tolerates ```json fences or a stray sentence). */
export function extractJsonObject(text: string): unknown {
  const raw = String(text ?? '').trim();
  if (!raw) throw new EpisodeScriptError('BAD_JSON', 'The model returned an empty reply instead of JSON.');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* fall through */ }
    }
  }
  throw new EpisodeScriptError('BAD_JSON', 'The model did not return valid JSON. Try Generate again, or pick a model that supports JSON output.');
}

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = str(v).toLowerCase().replace(/_/g, ' ');
  const hit = allowed.find(a => a.replace(/_/g, ' ') === s);
  return hit ?? fallback;
};

/**
 * Validate a parsed reply and normalize it into script-director's shapes.
 * Unknown enum values fall back to the director's defaults; a reply without
 * usable shots is rejected rather than padded with invented content.
 */
export function normalizeEpisodeScript(input: unknown, premise = ''): EpisodeScript {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EpisodeScriptError('INVALID_SCRIPT', 'The model reply was not a JSON object with a "shots" list.');
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.shots)) {
    throw new EpisodeScriptError('INVALID_SCRIPT', 'The model reply has no "shots" list.');
  }
  const usable = obj.shots.filter((s): s is Record<string, unknown> =>
    !!s && typeof s === 'object' && !Array.isArray(s)
    && !!(str((s as any).visual) || str((s as any).prompt) || str((s as any).narration)));
  if (usable.length < MIN_SHOTS) {
    throw new EpisodeScriptError('INVALID_SCRIPT', `The model returned ${usable.length} usable shot(s); at least ${MIN_SHOTS} are needed.`);
  }
  const title = str(obj.title).slice(0, 80) || 'Generated Episode';
  const logline = str(obj.logline).slice(0, 300) || premise.trim().slice(0, 300);
  const genre = detectGenre(`${premise} ${logline}`, str(obj.genre).toLowerCase());

  const shots: DirectedShot[] = usable.slice(0, MAX_SHOTS).map((s, idx) => {
    const framing = pick(s.framing, FRAMINGS, 'medium');
    const lens = pick(s.lens, LENSES, '35mm');
    const movement = pick(s.movement, MOVEMENTS, 'static');
    const beatType = pick(s.beatType, BEAT_TYPES, idx === 0 ? 'establishing' : 'action');
    // `visual` (from the model) gets the director's cinematography suffix; a
    // `prompt` (an already-normalized script handed back) is kept verbatim.
    const visual = str(s.visual);
    const prompt = visual
      ? buildDirectedPrompt(visual, genre, framing, lens, movement)
      : str(s.prompt) || buildDirectedPrompt(str(s.narration), genre, framing, lens, movement);
    const narration = str(s.narration).slice(0, 400);
    const d = Number(s.durationSec);
    const durationSec = Number.isFinite(d) ? Math.max(4, Math.min(10, Math.round(d))) : 5;
    const characters = Array.isArray(s.characters)
      ? Array.from(new Set(s.characters.map(str).filter(Boolean).map(c => c.slice(0, 40)))).slice(0, 8)
      : [];
    return {
      shotId: `shot_${String(idx + 1).padStart(3, '0')}`,
      order: idx + 1,
      title: str(s.title).slice(0, 80) || `${framing.toUpperCase()} — ${beatType.toUpperCase()}`,
      prompt: prompt.slice(0, 2000),
      framing,
      lens,
      movement,
      durationSec,
      narration,
      characters,
      beatType,
    };
  });

  return {
    schemaVersion: EPISODE_SCRIPT_SCHEMA_VERSION,
    title,
    logline,
    genre,
    shots,
    totalDurationSec: shots.reduce((acc, s) => acc + s.durationSec, 0),
  };
}

function isLoopbackUrl(apiUrl: string): boolean {
  try {
    const host = new URL(apiUrl).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** Ask the configured provider for a script and return it normalized. Writes nothing. */
export async function generateEpisodeScript(
  options: GenerateEpisodeScriptOptions,
  deps: GenerateEpisodeScriptDeps,
): Promise<EpisodeScript> {
  const premise = String(options?.premise ?? '').trim();
  if (!premise) throw new EpisodeScriptError('EMPTY_PREMISE', 'Enter a premise for the episode first.');
  if (premise.length > MAX_PREMISE_CHARS) {
    throw new EpisodeScriptError('EMPTY_PREMISE', `Keep the premise under ${MAX_PREMISE_CHARS} characters.`);
  }

  const config = deps.config;
  if (!config || !config.apiUrl?.trim() || !config.model?.trim()) {
    throw new EpisodeScriptError('NO_PROVIDER', 'No cloud model is set up. In Settings → Models, choose a provider, base URL, model and API key, then try again.');
  }
  if (NON_OPENAI_PROVIDERS.has(config.provider)) {
    throw new EpisodeScriptError('UNSUPPORTED_PROVIDER', `Episode scripts need an OpenAI-compatible provider; "${config.provider}" is not one. Pick e.g. DeepSeek, OpenAI, Groq, OpenRouter or a custom endpoint.`);
  }
  try {
    const parsed = new URL(config.apiUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new EpisodeScriptError('NO_PROVIDER', 'The saved API base URL is not a valid http(s) URL. Fix it in Settings → Models.');
  }
  if (!isLoopbackUrl(config.apiUrl) && deps.assertOnline) {
    try {
      deps.assertOnline(config.name || config.provider);
    } catch (err: any) {
      throw new EpisodeScriptError('ONLINE_ACCESS_DISABLED', err?.message || 'This provider needs Online access.');
    }
  }

  const request = buildEpisodeScriptRequest(config, { ...options, premise });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 120_000);
  let response: Response;
  try {
    response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
  } catch (err: any) {
    clearTimeout(timer);
    const reason = err?.name === 'AbortError' ? 'the request timed out' : (err?.message || 'network error');
    throw new EpisodeScriptError('NETWORK_ERROR', `Could not reach ${request.url}: ${reason}.`);
  }
  let bodyText = '';
  try {
    bodyText = await response.text();
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = '';
    try { detail = str((JSON.parse(bodyText) as any)?.error?.message); } catch { /* not JSON */ }
    const hint = response.status === 401 || response.status === 403
      ? ' Check the API key in Settings.'
      : response.status === 404 ? ' Check the base URL and model ID in Settings.' : '';
    throw new EpisodeScriptError('HTTP_ERROR', `The provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}.${hint}`);
  }
  let content: unknown;
  try {
    content = (JSON.parse(bodyText) as any)?.choices?.[0]?.message?.content;
  } catch {
    throw new EpisodeScriptError('BAD_JSON', 'The provider reply was not an OpenAI-compatible chat completion.');
  }
  if (typeof content !== 'string') {
    throw new EpisodeScriptError('BAD_JSON', 'The provider reply had no message content.');
  }
  return normalizeEpisodeScript(extractJsonObject(content), premise);
}

/** Re-validate a script the renderer hands back (it may have been edited or pasted as JSON). */
export function parseEpisodeScriptPayload(payload: unknown): EpisodeScript {
  const obj = typeof payload === 'string' ? extractJsonObject(payload) : payload;
  const logline = obj && typeof obj === 'object' ? str((obj as any).logline) : '';
  return normalizeEpisodeScript(obj, logline);
}
