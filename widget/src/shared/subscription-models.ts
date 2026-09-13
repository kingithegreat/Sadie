/**
 * Models offered by the two providers that are a local CLI signed in to the
 * user's own subscription — Claude Code (Claude Max) and Codex (ChatGPT).
 *
 * These live in `shared/` rather than in the main process because the renderer
 * needs them *without asking anyone*. Every other provider learns its models by
 * calling `/models` over the network, and the Settings panel only does that
 * when the user presses a button.
 *
 * That button press was a dead end. Choosing "Claude subscription" cleared the
 * model list, nothing selected a model, and `resolveCloudLLM` reports a cloud
 * provider with no model as INACTIVE — so the privacy switch disabled itself
 * and the provider could never be turned on. Reported as "I saved Claude sub
 * without api and it's still not letting me use claude", and the switch was
 * telling the truth: nothing would have answered.
 *
 * A CLI has no `/models` endpoint to call. These lists are constants, so the
 * renderer can fill them in the moment the provider is chosen and the whole
 * fetch step disappears for these two.
 *
 * Same family as the original privacy-switch bug: a control gated behind a
 * same-session network fetch that had no reason to be required.
 */

import type { CustomModelInfo } from './types';

export const CLAUDE_CODE_MODELS: CustomModelInfo[] = [
  { id: 'haiku', name: 'Claude Haiku (subscription)', description: 'Fastest and lightest — quick questions', provider: 'claude-code', costHint: 'Included in your Claude plan' },
  { id: 'sonnet', name: 'Claude Sonnet (subscription)', description: 'Balanced speed and intelligence', provider: 'claude-code', costHint: 'Included in your Claude plan' },
  { id: 'opus', name: 'Claude Opus (subscription)', description: 'Most capable for complex coding and reasoning', provider: 'claude-code', costHint: 'Included in your Claude plan' },
  { id: 'fable', name: 'Claude Fable (subscription)', description: 'Highest capability — hardest problems', provider: 'claude-code', costHint: 'Included in your Claude plan' },
];

/**
 * `default` lets the CLI pick whatever the account is entitled to, which is the
 * safest option when OpenAI rotates model names.
 */
export const CODEX_MODELS: CustomModelInfo[] = [
  { id: 'default', name: 'Codex default (subscription)', description: 'Whatever your ChatGPT plan provides', provider: 'codex', costHint: 'Included in your ChatGPT plan' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex (subscription)', description: 'Coding-tuned', provider: 'codex', costHint: 'Included in your ChatGPT plan' },
  { id: 'gpt-5.1', name: 'GPT-5.1 (subscription)', description: 'General purpose', provider: 'codex', costHint: 'Included in your ChatGPT plan' },
];

/**
 * Providers whose models are known up front and need no network call.
 *
 * Keyed by provider id so a caller can ask "do I already know this one's
 * models?" without special-casing each provider by name.
 */
export const SUBSCRIPTION_CLI_MODELS: Record<string, CustomModelInfo[]> = {
  'claude-code': CLAUDE_CODE_MODELS,
  codex: CODEX_MODELS,
};

/** True when this provider's models are known without asking the network. */
export function hasKnownModels(provider: string | undefined): boolean {
  return !!provider && provider in SUBSCRIPTION_CLI_MODELS;
}

/** The known models for a provider, or an empty list when it has none. */
export function knownModelsFor(provider: string | undefined): CustomModelInfo[] {
  return (provider && SUBSCRIPTION_CLI_MODELS[provider]) || [];
}

/**
 * Curated fallback models for metered cloud providers when an API key is present.
 * These are NOT CLI subscription models, so knownModelsFor() remains empty for them.
 *
 * Every ID here must also be in the main-process list for its provider
 * (custom-llm-client.ts), which is where retired models get pruned; this list
 * once kept offering Claude 3.5, DeepSeek Chat/Reasoner and Gemini 2.0 Flash
 * after their providers had shut them down. model-lifecycle.test.ts enforces it.
 */
export const CURATED_METERED_MODELS: Record<string, CustomModelInfo[]> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Flagship omni model', provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: 'Fast and affordable', provider: 'openai' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', description: 'Best balance of speed and intelligence', provider: 'anthropic' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest and most affordable', provider: 'anthropic' },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'Fast chat model', provider: 'deepseek' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'Stronger reasoning', provider: 'deepseek' },
  ],
  'google-ai-studio': [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Thinking + tools, free tier', provider: 'google-ai-studio' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Fast inference on Groq LPU', provider: 'groq' },
  ],
  openrouter: [
    { id: 'auto', name: 'OpenRouter Auto', description: 'Best model for prompt', provider: 'openrouter' },
  ],
};

