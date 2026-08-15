/**
 * Context windows for the cloud models, in a place the renderer may read.
 *
 * The main process already knew these — MODEL_METADATA in custom-llm-client.ts
 * carries contextWindow for every Claude and GPT model. The renderer cannot
 * import from main, so TokenCounter kept its own table, and that table was
 * Ollama-only. Its fuzzy match compares against `key.split(':')[0]`, which no
 * Claude id can ever match, so every cloud model fell through to an 8192
 * default: on Opus 5 the counter reads ~100% full within a couple of turns
 * while 992k of the window sits unused.
 *
 * Kept honest by model-context-drift.test.ts, which fails if this disagrees
 * with the metadata main actually uses.
 */

export const CLOUD_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-sonnet': 200_000,
  'claude-3-haiku': 200_000,

  // OpenAI
  'gpt-4': 8_192,
  'gpt-4-turbo': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-3.5-turbo': 16_385,
};

/**
 * Longest-prefix match, mirroring how the main process resolves a model id, so
 * "claude-opus-5-20260101" lands on claude-opus-5 rather than claude-opus-4.
 * Returns null when nothing matches, leaving the caller's own table in charge.
 */
export function getCloudContextLimit(model: string): number | null {
  if (!model) return null;
  const id = model.toLowerCase();
  if (CLOUD_CONTEXT_WINDOWS[id]) return CLOUD_CONTEXT_WINDOWS[id];

  const keys = Object.keys(CLOUD_CONTEXT_WINDOWS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (id.startsWith(key)) return CLOUD_CONTEXT_WINDOWS[key];
  }
  return null;
}
