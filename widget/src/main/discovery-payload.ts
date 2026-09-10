/**
 * discovery-payload.ts — the credential boundary for model discovery.
 *
 * A saved provider key may only be sent to that provider's trusted canonical
 * endpoint. A caller-supplied URL for a known provider is ignored (the canonical
 * one is used); a custom/local endpoint never receives another provider's saved
 * key — only the caller's own endpoint-bound key.
 */
import { apiKeyForProvider, type CloudLLMSettingsSlice } from '../shared/cloud-llm';
import { PROVIDER_API_URLS } from '../shared/provider-urls';

export interface DiscoveryPayloadInput {
  apiUrl?: string;
  apiKey?: string;
  provider?: string;
  refresh?: boolean;
}

export interface ResolvedDiscoveryPayload {
  apiUrl: string;
  apiKey: string;
  provider: string;
  /** True when the endpoint is a trusted canonical provider origin. */
  canonical: boolean;
}

export function resolveDiscoveryPayload(
  payload: DiscoveryPayloadInput | null | undefined,
  settings: CloudLLMSettingsSlice | null | undefined,
): ResolvedDiscoveryPayload {
  const provider = payload?.provider || '';
  const isCliProvider = provider === 'claude-code' || provider === 'codex';
  const canonicalUrl = provider in PROVIDER_API_URLS ? PROVIDER_API_URLS[provider] : '';

  let apiUrl = payload?.apiUrl || '';
  let apiKey = (payload?.apiKey || '').trim();

  if (canonicalUrl) {
    // Trusted provider origin: pin the endpoint and attach the saved key ONLY
    // here, so a saved credential can never reach a caller-chosen host.
    apiUrl = canonicalUrl;
    if (!apiKey) apiKey = apiKeyForProvider(settings, provider) || '';
  } else if (!isCliProvider) {
    // Custom/local endpoint: keep the caller's own key, never a saved one.
    apiKey = apiKey;
  }

  return { apiUrl, apiKey, provider, canonical: !!canonicalUrl };
}
