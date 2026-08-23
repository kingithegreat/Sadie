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
