/**
 * Where each cloud provider's OpenAI-compatible API lives.
 *
 * In `shared/` because BOTH sides need it and they had drifted. The renderer
 * kept a private `getDefaultApiUrl` switch statement listing eleven providers,
 * the main process kept this map listing twelve, and Moonshot was in one and
 * not the other — so picking Kimi in Settings left the URL blank while the
 * router knew perfectly well what it should have been.
 *
 * That is the "same decision computed in two places" defect, and the fix is one
 * definition rather than two that agree today.
 *
 * DELIBERATELY ABSENT: `claude-code` and `codex`. Both are local CLIs with no
 * HTTP endpoint at all, and a URL here would be worse than none — callers do
 * `cfg.apiUrl || PROVIDER_API_URLS[cfg.provider]`, so an entry would send a
 * subscription CLI's traffic to a web address. Tests assert they stay out.
 */
export const PROVIDER_API_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  'google-ai-studio': 'https://generativelanguage.googleapis.com/v1beta/openai',
  'google-gemini': 'https://generativelanguage.googleapis.com/v1beta',
  huggingface: 'https://api-inference.huggingface.co/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  together: 'https://api.together.xyz/v1',
  // Kimi (Moonshot) speaks the OpenAI Chat Completions shape, so it needs no
  // bespoke client — only a base URL and a key from platform.moonshot.ai.
  moonshot: 'https://api.moonshot.ai/v1',
  // TokenRouter fronts many vendors behind one OpenAI-compatible endpoint.
  // Verified against the live API: the base is .com — api.tokenrouter.io
  // answers 401 and is an unrelated service with a different key namespace.
  tokenrouter: 'https://api.tokenrouter.com/v1',
};

/** The canonical base URL for a provider, or '' when it has none. */
export function defaultApiUrlFor(provider: string | undefined): string {
  return (provider && PROVIDER_API_URLS[provider]) || '';
}

/**
 * Providers that are a local CLI signed in to a subscription, not an HTTP
 * endpoint. `claude-code` and `codex` have no URL — and in `streamCodex` /
 * `streamClaudeCode` the `apiUrl` field is repurposed as an optional override
 * for the CLI binary's *path*, so a leftover HTTP URL from the previous
 * provider is not merely ignored, it is spawned. Observed: switching from
 * DeepSeek to Codex kept `https://api.deepseek.com/v1`, and the CLI launch
 * failed with "Codex CLI not found (https://api.deepseek.com/v1)".
 */
const CLI_PROVIDERS: ReadonlySet<string> = new Set(['claude-code', 'codex']);

/** True when this provider is a local CLI rather than an HTTP endpoint. */
export function isCliProvider(provider: string | undefined | null): boolean {
  return !!provider && CLI_PROVIDERS.has(provider);
}

/**
 * The `customLLM` fields that must NOT survive a switch between two providers.
 *
 * `apiUrl` is the dangerous one: for a CLI provider it means the binary's
 * location, so an HTTP URL carried over from the previous provider is spawned
 * as a program. `apiKey` is dropped too — a CLI provider needs none, and a
 * metered key left in the config is a credential the new provider never asked
 * for. Both are cleared on every switch TO a CLI provider.
 */
export function resetCliOnlyFields<T extends { apiUrl?: string; apiKey?: string }>(
  config: T,
  provider: string | undefined | null,
): T {
  if (!isCliProvider(provider)) return config;
  const { apiUrl: _dropUrl, apiKey: _dropKey, ...rest } = config;
  return { ...rest, apiUrl: '', apiKey: '' } as T;
}
