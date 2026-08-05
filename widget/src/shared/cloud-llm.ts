/**
 * cloud-llm.ts — the single source of truth for "should chat go to the cloud?"
 *
 * Why this exists: the answer used to be computed by ELEVEN hand-rolled
 * boolean expressions across message-router.ts and ipc-handlers.ts, with
 * subtly different logic — and none of them hydrated `customLLM.apiKey` from
 * the per-provider key vault (`geminiApiKey` / `anthropicApiKey` /
 * `openaiApiKey`). Only the renderer did that, for display.
 *
 * The observed failure: Settings showed Gemini fully configured (renderer
 * hydration), while the router saw an empty `customLLM.apiKey` and silently
 * answered every message with the local Ollama model instead. Cloud on
 * screen, qwen in chat, no error anywhere.
 *
 * Rules:
 *  - Pure. No Electron, no fs — usable and testable from both processes.
 *  - Never mutates the settings object; returns a hydrated copy.
 *  - When the user has cloud turned ON but it cannot run, that is a
 *    `misconfiguration` the caller must surface — not a silent fallback.
 */

import type { Settings, CustomLLMConfig } from './types';

/**
 * Only the fields this decision actually reads. Declared structurally because
 * the main process has its own Settings interface in config-manager.ts that
 * is not identical to shared/types' Settings — a pure function shouldn't care
 * which one the caller holds.
 */
export type CloudLLMSettingsSlice = Pick<
  Settings,
  'useCustomLLM' | 'customLLM' | 'anthropicApiKey' | 'openaiApiKey' | 'geminiApiKey'
>;

/** Where each provider's key lives in the top-level settings "key vault".
 *  Mirrors the renderer's display-time hydration in SettingsPanel. */
const PROVIDER_KEY_FIELDS: Partial<Record<CustomLLMConfig['provider'], keyof CloudLLMSettingsSlice>> = {
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  'google-ai-studio': 'geminiApiKey',
  'google-gemini': 'geminiApiKey',
};

/** Providers that authenticate without an API key:
 *  claude-code runs a local CLI on the user's subscription; custom endpoints
 *  may be unauthenticated local servers. */
const KEYLESS_PROVIDERS: ReadonlySet<string> = new Set(['claude-code', 'custom']);

export interface ResolvedCloudLLM {
  /** The user turned cloud chat on (useCustomLLM or customLLM.enabled). */
  intended: boolean;
  /** Cloud chat can actually run: intended + model + usable credential. */
  active: boolean;
  /** customLLM with apiKey hydrated from the provider vault when empty.
   *  ALWAYS pass this onward instead of settings.customLLM — the raw config
   *  may have an empty key that only this copy fills in. */
  config: CustomLLMConfig | null;
  /** Human-readable reason cloud is intended but cannot run. Null when
   *  inactive-by-choice or active. Callers must SURFACE this, not log it. */
  misconfiguration: string | null;
}

export function resolveCloudLLM(settings: CloudLLMSettingsSlice | null | undefined): ResolvedCloudLLM {
  const cfg = settings?.customLLM;
  const intended = !!(settings && (settings.useCustomLLM || cfg?.enabled));

  if (!cfg) {
    return {
      intended,
      active: false,
      config: null,
      misconfiguration: intended
        ? 'Cloud chat is turned on, but no cloud provider is configured yet.'
        : null,
    };
  }

  // Hydrate the key from the provider vault — the fix for the split-brain bug.
  const ownKey = (cfg.apiKey || '').trim();
  let apiKey = ownKey;
  if (!apiKey) {
    const field = PROVIDER_KEY_FIELDS[cfg.provider];
    const vaultKey = field ? String((settings as any)[field] ?? '').trim() : '';
    if (vaultKey) apiKey = vaultKey;
  }
  const config: CustomLLMConfig = apiKey === ownKey ? { ...cfg } : { ...cfg, apiKey };

  if (!intended) {
    return { intended, active: false, config, misconfiguration: null };
  }

  const needsModel = cfg.provider !== 'custom';
  if (needsModel && !(cfg.model || '').trim()) {
    return {
      intended,
      active: false,
      config,
      misconfiguration: `Cloud chat is on (${cfg.provider}), but no model is selected.`,
    };
  }

  const needsKey = !KEYLESS_PROVIDERS.has(cfg.provider);
  if (needsKey && !apiKey) {
    return {
      intended,
      active: false,
      config,
      misconfiguration:
        `Cloud chat is on (${cfg.provider}${cfg.model ? ` / ${cfg.model}` : ''}), ` +
        `but no API key is saved for ${cfg.provider}. Add it in Settings to use the cloud model.`,
    };
  }

  return { intended, active: true, config, misconfiguration: null };
}
