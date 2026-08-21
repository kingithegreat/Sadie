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
  | 'useCustomLLM'
  | 'customLLM'
  | 'anthropicApiKey'
  | 'openaiApiKey'
  | 'geminiApiKey'
  | 'moonshotApiKey'
  // Every provider's key, including the seven the four fields above never covered.
  | 'providerApiKeys'
  // Uncensored mode belongs to this decision, not beside it. It used to be read
  // only on the Ollama path, so with a cloud provider enabled the router went
  // to the cloud and never reached the line that honours it — the toggle was
  // silently ignored while the UI said "Turn off Uncensored Mode to switch
  // models". Same split-brain shape as the key-vault bug above.
  | 'uncensoredMode'
  // Read by describeActiveModel so the header can display the same local
  // model the router would actually pick.
  | 'chatModel'
  | 'uncensoredModel'
>;

/** Where each provider's key lives in the top-level settings "key vault".
 *  Mirrors the renderer's display-time hydration in SettingsPanel. */
const PROVIDER_KEY_FIELDS: Partial<Record<CustomLLMConfig['provider'], keyof CloudLLMSettingsSlice>> = {
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  'google-ai-studio': 'geminiApiKey',
  'google-gemini': 'geminiApiKey',
  moonshot: 'moonshotApiKey',
};

/** Providers that authenticate without an API key:
 *  claude-code and codex both run a local CLI signed in to the user's own
 *  subscription (Claude Max / ChatGPT), so there is no key to store; custom
 *  endpoints may be unauthenticated local servers. */
const KEYLESS_PROVIDERS: ReadonlySet<string> = new Set(['claude-code', 'codex', 'custom']);

/**
 * The saved key for one provider — the single read path.
 *
 * `providerApiKeys` is authoritative and covers every provider the picker
 * offers. The four legacy top-level fields are the fallback, so settings
 * written before that map existed still resolve. Callers must not reach into
 * either store directly: a second copy of this lookup is how the renderer and
 * the router previously disagreed about whether a provider was configured.
 */
export function apiKeyForProvider(
  settings: CloudLLMSettingsSlice | null | undefined,
  provider: string | null | undefined,
): string {
  if (!settings || !provider) return '';
  const fromMap = (settings as any).providerApiKeys?.[provider];
  if (typeof fromMap === 'string' && fromMap.trim()) return fromMap.trim();

  const legacyField = PROVIDER_KEY_FIELDS[provider as CustomLLMConfig['provider']];
  const fromLegacy = legacyField ? (settings as any)[legacyField] : undefined;
  return typeof fromLegacy === 'string' ? fromLegacy.trim() : '';
}

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
  /** Set when cloud was deliberately bypassed in favour of the local model —
   *  currently only uncensored mode. Distinct from `misconfiguration`: nothing
   *  is broken, the user asked for this. Callers should show it so the reason
   *  the cloud model went unused is visible rather than mysterious. */
  localOverride: string | null;
}

export function resolveCloudLLM(settings: CloudLLMSettingsSlice | null | undefined): ResolvedCloudLLM {
  const cfg = settings?.customLLM;
  // Intent rule: an EXPLICIT useCustomLLM boolean is the user's routing choice
  // and always wins; customLLM.enabled only decides for legacy settings where
  // useCustomLLM was never written. The old OR meant a leftover enabled:true
  // silently overrode useCustomLLM:false — observed live three times as
  // "I have Qwen selected" while every reply stayed badged opus, and no
  // amount of picking fixed it unless the pick happened to rewrite the flag.
  const intended = !!settings && (
    typeof settings.useCustomLLM === 'boolean' ? settings.useCustomLLM : !!cfg?.enabled
  );

  if (!cfg) {
    return {
      intended,
      active: false,
      config: null,
      misconfiguration: intended
        ? 'Cloud chat is turned on, but no cloud provider is configured yet.'
        : null,
      localOverride: null,
    };
  }

  // Hydrate the key from the provider vault — the fix for the split-brain bug.
  const ownKey = (cfg.apiKey || '').trim();
  let apiKey = ownKey;
  if (!apiKey) {
    const vaultKey = apiKeyForProvider(settings, cfg.provider);
    if (vaultKey) apiKey = vaultKey;
  }
  const config: CustomLLMConfig = apiKey === ownKey ? { ...cfg } : { ...cfg, apiKey };

  if (!intended) {
    return { intended, active: false, config, misconfiguration: null, localOverride: null };
  }

  // Uncensored mode wins over any cloud provider. The toggle's whole promise is
  // that the answer comes from the local uncensored model; routing it to a
  // hosted provider instead breaks that promise twice over — the content is
  // filtered by someone else's policy, and it leaves the machine. Checked
  // BEFORE model/key validation so an unconfigured cloud provider can't turn a
  // deliberate local choice into a misconfiguration warning.
  if (settings?.uncensoredMode) {
    return {
      intended,
      active: false,
      config,
      misconfiguration: null,
      localOverride:
        'Uncensored mode is on, so the local uncensored model answered instead of the cloud model.',
    };
  }

  const needsModel = cfg.provider !== 'custom';
  if (needsModel && !(cfg.model || '').trim()) {
    return {
      intended,
      active: false,
      config,
      misconfiguration: `Cloud chat is on (${cfg.provider}), but no model is selected.`,
      localOverride: null,
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
      localOverride: null,
    };
  }

  return { intended, active: true, config, misconfiguration: null, localOverride: null };
}

/** What the header should display: who would answer a message sent right now. */
export interface ActiveModelInfo {
  /** Where the next reply comes from. */
  source: 'cloud' | 'local';
  /** Model id the router would use — 'opus', 'qwen2.5:7b', ... */
  model: string;
  /** Provider when source is cloud. */
  provider: string | null;
  /**
   * Why the answer differs from what the user might expect — the uncensored
   * override or a cloud misconfiguration. Null when there is nothing to
   * explain. Callers should SHOW this next to the model name.
   */
  reason: string | null;
}

/**
 * The single answer to "which model answers right now?", for DISPLAY.
 *
 * The header used to derive this from the renderer's own settings copy, which
 * is a second implementation of the routing decision — and every disagreement
 * between the two shipped as a lying header ("Qwen selected", opus answering;
 * "opus selected", qwen answering). The renderer now asks this function via
 * IPC instead of guessing. Built ON resolveCloudLLM, not beside it, so the
 * display can only diverge from routing if the router itself does.
 */
export function describeActiveModel(settings: CloudLLMSettingsSlice | null | undefined): ActiveModelInfo {
  const cloud = resolveCloudLLM(settings);

  if (cloud.active && cloud.config) {
    return {
      source: 'cloud',
      model: cloud.config.model || '',
      provider: cloud.config.provider,
      reason: null,
    };
  }

  // Local: mirror the router's uncensored-beats-normal selection. (Vision and
  // code overrides are per-message and cannot be known here.)
  const local = settings?.uncensoredMode
    ? (settings?.uncensoredModel || 'dolphin-mistral:7b')
    : (settings?.chatModel || 'qwen2.5:7b');

  return {
    source: 'local',
    model: local,
    provider: null,
    reason: cloud.localOverride || cloud.misconfiguration,
  };
}
