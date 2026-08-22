/**
 * Which local model answers by default, and whether it is a small one.
 *
 * Split out of message-router.ts because both the router and the synthesis
 * prompt builders need it. Importing it back from message-router would make the
 * two modules circular, so it lives on its own.
 *
 * The 9B bound below is load-bearing and was wrong for a long time — see the
 * note in the function body.
 */

// Default model for chat (should support tools)
export const OLLAMA_CHAT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

/**
 * Returns true for models at or below ~9B parameters, based on their name.
 * Small models get the compact system prompt to preserve usable context.
 *
 * The bound was raised from 3B to 9B; the docstring said 3B for long enough
 * that a reader could reasonably conclude the 7B models in daily use took the
 * full-size path. They do not — see the note in the body.
 */
export function isSmallModel(modelName: string): boolean {
  const n = modelName.toLowerCase();
  // Explicit small-size tags. The bound is 9B, not 3B.
  //
  // It WAS 3B, which meant none of this applied to the models actually in use:
  // qwen2.5:7b, qwen2.5-coder:7b and dolphin-mistral:7b all took the full-size
  // path. Five optimisations were dead as a result — the compact system prompt
  // (~425 vs ~2,000 tokens), the 12-tool cap, the 12-turn history window, the
  // 1,500-char search budget, and long-reply trimming. The 12-tool cap in
  // particular exists precisely because a 7B model chooses badly from ~85 tool
  // schemas, which is the likeliest reason tool calls have been unreliable.
  //
  // 9B is the ceiling: gemma2:9b and llama3.1:8b are included, while a 13B+
  // model — which handles a full prompt comfortably — is not.
  if (/[:\-_]([0-9](\.[0-9]+)?b)\b/.test(n)) return true;
  // Known small model families:
  //   phi-mini / phi3.5-mini — phi3 alone is NOT small (ships at 3.8b and 14b; only mini qualifies)
  //   gemma:2b / gemma2:2b
  //   qwen sub-3b sizes
  //   moondream — 1.8b vision model, 4GB-friendly alternative to llava
  //   dolphin-phi — 2.7b uncensored, 4GB-friendly alternative to dolphin-llama3:8b
  //   smollm, tinyllama, tinydolphin
  if (/\b(phi[- ]?[0-9]?(\.[0-9]+)?[- ]?mini|gemma:2b|gemma2:2b|qwen[:\-_]?[0-9]*[:\-_]?[01]\.?[05]b|smollm|tinyllama|tinydolphin|moondream|dolphin-phi)\b/.test(n)) return true;
  // Cloud API small models (Haiku family, GPT-3.5, mini variants)
  if (/\b(haiku|gpt-3\.5|gpt-4o-mini|o1-mini)\b/.test(n)) return true;
  return false;
}
