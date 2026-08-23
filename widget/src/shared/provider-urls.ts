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
