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

export const OPENAI_MODELS: CustomModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Flagship multimodal intelligence — fast and capable', provider: 'openai', costHint: 'OpenAI API' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast, affordable everyday chat and reasoning', provider: 'openai', costHint: 'OpenAI API' },
  { id: 'o3-mini', name: 'o3-mini', description: 'Advanced reasoning and STEM problem-solving', provider: 'openai', costHint: 'OpenAI API' },
  { id: 'o1', name: 'o1', description: 'Frontier deep reasoning and complex coding', provider: 'openai', costHint: 'OpenAI API' },
];

export const ANTHROPIC_MODELS: CustomModelInfo[] = [
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Industry-leading reasoning and coding', provider: 'anthropic', costHint: 'Anthropic API' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast, responsive intelligence for quick answers', provider: 'anthropic', costHint: 'Anthropic API' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Deepest analysis and complex writing', provider: 'anthropic', costHint: 'Anthropic API' },
];

export const GEMINI_MODELS: CustomModelInfo[] = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Next-gen multimodal speed with free tier', provider: 'google-ai-studio', costHint: 'Free tier available' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '2M token context window for massive documents', provider: 'google-ai-studio', costHint: 'Google AI Studio' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast multimodal everyday intelligence', provider: 'google-ai-studio', costHint: 'Free tier available' },
];

export const GROQ_MODELS: CustomModelInfo[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 (70B)', description: 'Ultra-fast open weights inference on LPUs', provider: 'groq', costHint: 'Free tier' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'High-speed MoE model with 32k context', provider: 'groq', costHint: 'Free tier' },
];

export const DEEPSEEK_MODELS: CustomModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek-V3', description: 'GPT-4 quality general chat at ~20x lower cost', provider: 'deepseek', costHint: 'DeepSeek API' },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1', description: 'Chain-of-thought deep reasoning model', provider: 'deepseek', costHint: 'DeepSeek API' },
];

export const OPENROUTER_MODELS: CustomModelInfo[] = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (OpenRouter)', description: 'OpenRouter routing to GPT-4o-mini', provider: 'openrouter', costHint: 'OpenRouter' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (OpenRouter)', description: 'OpenRouter routing to Claude 3.5 Sonnet', provider: 'openrouter', costHint: 'OpenRouter' },
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
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  'google-ai-studio': GEMINI_MODELS,
  'google-gemini': GEMINI_MODELS.map(m => ({ ...m, provider: 'google-gemini' })),
  groq: GROQ_MODELS,
  deepseek: DEEPSEEK_MODELS,
  openrouter: OPENROUTER_MODELS,
};

/** True when this provider's models are known without asking the network. */
export function hasKnownModels(provider: string | undefined): boolean {
  return !!provider && provider in SUBSCRIPTION_CLI_MODELS;
}

/** The known models for a provider, or an empty list when it has none. */
export function knownModelsFor(provider: string | undefined): CustomModelInfo[] {
  return (provider && SUBSCRIPTION_CLI_MODELS[provider]) || [];
}
