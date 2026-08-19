/**
 * Turning a failure into something the reader can act on.
 *
 * Split out of message-router.ts, which had grown past 5,800 lines. This is one
 * cohesive job — take whatever a stream threw, work out which service actually
 * broke, and return a hint the renderer can draw buttons from — and it is the
 * part with the most tests, so it benefits most from standing on its own.
 *
 * Moved verbatim; the classification order is load-bearing and unchanged. See
 * classifyError for why the cloud branch must be tested before the Ollama one.
 */

import type { HomeBotResponse, CustomLLMConfig } from '../../shared/types';
import { getSettings } from '../config-manager';
import { resolveCloudLLM } from '../../shared/cloud-llm';
import type { CloudLLMSettingsSlice } from '../../shared/cloud-llm';

export function mapErrorToHomeBotResponse(error: any): HomeBotResponse {
  if (error.code === 'ECONNREFUSED') {
    return {
      success: false,
      error: true,
      // Was "Connection refused by backend." — a reader who does not know
      // what a backend is learns nothing and is told to do nothing.
      message: "HomeBot couldn't reach the AI. It may still be starting up — try again in a moment.",
      details: error.message,
      response: 'NETWORK_ERROR'
    };
  }
  if (error.code === 'ECONNABORTED') {
    return {
      success: false,
      error: true,
      message: 'That took too long to answer. The model may still be loading — try again in a moment.',
      details: error.message,
      response: 'TIMEOUT'
    };
  }
  return {
    success: false,
    error: true,
    message: 'Something went wrong. Trying again usually fixes it.',
    details: error.message,
    response: 'UNKNOWN_ERROR'
  };
}

// ── Error recovery hints ────────────────────────────────────────────────────

export interface RecoveryHint {
  service: 'ollama' | 'n8n' | 'model' | 'unknown';
  userMessage: string;
  action?: 'start-ollama' | 'pull-model' | 'retry' | 'check-settings';
  actionLabel?: string;
  model?: string;
  /**
   * Set only when the local model failed AND a cloud provider is already
   * configured with a usable credential — i.e. the user could switch right now
   * without typing anything. The renderer draws a second button from this.
   *
   * Absent means "do not offer it". The decision is made here, in the process
   * that owns routing, because the renderer deriving it a second time from its
   * own settings copy is the exact split-brain that shipped a lying model
   * header twice (see shared/cloud-llm.ts).
   *
   * This never switches anything by itself. `useCustomLLM` is the privacy
   * kill-switch: turning it on is the user pressing a labelled button, never a
   * fallback HomeBot takes on their behalf.
   */
  cloudFallback?: { provider: string; model: string };
}

/**
 * Would switching to the cloud actually work right now?
 *
 * Asks the same resolver the router uses, with `useCustomLLM` flipped on, so
 * the offer appears only when the switch would genuinely produce an answer.
 * A configured-but-keyless provider returns null — offering a button that
 * cannot work is worse than not offering one.
 *
 * uncensoredMode is deliberately left as the user set it: with it on,
 * resolveCloudLLM reports inactive, so no cloud offer is made. Routing an
 * uncensored request to a hosted provider breaks that toggle's whole promise.
 */
function cloudFallbackOffer(settings: CloudLLMSettingsSlice | null | undefined): { provider: string; model: string } | undefined {
  if (!settings) return undefined;

  // Already on cloud? Then cloud is not the escape hatch from this failure.
  const current = resolveCloudLLM(settings);
  if (current.intended) return undefined;

  const asIfEnabled = resolveCloudLLM({ ...settings, useCustomLLM: true });
  if (!asIfEnabled.active || !asIfEnabled.config) return undefined;

  return {
    provider: asIfEnabled.config.provider,
    model: asIfEnabled.config.model || '',
  };
}

function settingsForRecovery(): CloudLLMSettingsSlice | null {
  try {
    return getSettings() as unknown as CloudLLMSettingsSlice;
  } catch {
    return null;
  }
}

/**
 * Classify a stream error and produce an actionable hint for the renderer.
 * Attach the result as `recoveryHint` on the `homebot:stream-error` payload.
 *
 * `settingsOverride` exists for tests. Callers in production omit it so every
 * existing call site gains the cloud offer without being edited — a recovery
 * path only the newest call site reaches is a recovery path most failures
 * never see.
 */
export function classifyError(
  message: string,
  details?: string,
  settingsOverride?: CloudLLMSettingsSlice | null,
): RecoveryHint {
  const combined = `${message} ${details ?? ''}`.toLowerCase();
  const settings = settingsOverride !== undefined ? settingsOverride : settingsForRecovery();
  const cloudFallback = cloudFallbackOffer(settings);

  // Both services down (most specific — check first)
  if (combined.includes('both') && combined.includes('unavailable')) {
    return {
      service: 'ollama',
      userMessage: cloudFallback
        ? "HomeBot can't reach the AI on this PC. Start it below, or switch to the online AI you already set up."
        : "HomeBot can't reach the AI on this PC. Start it below, then send your message again.",
      action: 'start-ollama',
      actionLabel: 'Retry',
      cloudFallback,
    };
  }

  // Model not found (404 or "not found" text) — check before generic Ollama
  if (combined.includes('not found') || (combined.includes('model') && combined.includes('404'))) {
    const modelMatch = combined.match(/model\s*"?([a-z0-9._:\/-]+)"?/i);
    const model = modelMatch?.[1];
    return {
      service: 'model',
      userMessage: model
        ? `The ${model} model hasn't been downloaded yet. Download it below — it only needs doing once.`
        : "That AI model hasn't been downloaded yet. You can pick a different one in Settings.",
      action: model ? 'pull-model' : 'check-settings',
      actionLabel: model ? `Pull ${model}` : 'Settings',
      model: model || undefined,
    };
  }

  // A cloud provider refusing the request — checked BEFORE the Ollama branch
  // below, and this order is load-bearing.
  //
  // Both callers hard-code the label: finishFailedStream is invoked with
  // `errorLabel: 'Ollama error'` and `'Ollama streaming error'`, and there are
  // only those two call sites. `combined` is `${message} ${details}`, so the
  // words "ollama" and "error" are present for EVERY failure that reaches here,
  // whichever service actually failed. With the Ollama branch first it matched
  // unconditionally and returned before this one was ever reached.
  //
  // So a rejected key, an exhausted quota or a 429 all rendered "The AI on this
  // PC isn't running. Start it below", with a Start Ollama button. The user
  // pressed it, was told Ollama was running, retried, and failed identically —
  // and the actual fix (Settings → key or billing) was never mentioned.
  //
  // The existing unit test passed throughout because it called
  // classifyError('Cloud API error …') with the cloud text as the FIRST
  // argument, which no production path does.
  if (combined.includes('cloud api error') || combined.includes('status code 429') ||
      combined.includes('rate limit') || combined.includes('quota') ||
      combined.includes('insufficient_quota') || combined.includes('unauthorized') ||
      combined.includes('forbidden') || combined.includes('authentication')) {
    return {
      service: 'unknown',
      userMessage: 'The online AI service refused the request. That is usually the key, the billing, or a usage limit — check Settings.',
      action: 'check-settings',
      actionLabel: 'Settings',
    };
  }

  // Ollama connection refused / reset
  if (combined.includes('econnrefused') || combined.includes('econnreset') ||
      (combined.includes('ollama') && (combined.includes('unavailable') || combined.includes('error')))) {
    return {
      service: 'ollama',
      // The renderer draws a StartOllamaButton directly beneath this. Telling
      // someone to open a terminal, next to a button that does it for them, is
      // the worst of both.
      userMessage: cloudFallback
        ? "The AI on this PC isn't running. Start it below, or switch to the online AI you already set up."
        : "The AI on this PC isn't running. Start it below, then send your message again.",
      action: 'start-ollama',
      actionLabel: 'Retry',
      cloudFallback,
    };
  }

  // n8n unavailable
  if (combined.includes('n8n') || combined.includes('upstream')) {
    return {
      service: 'n8n',
      userMessage: 'Automations are unavailable right now — HomeBot will answer using the AI on this PC instead.',
      action: 'retry',
      actionLabel: 'Retry with Ollama',
    };
  }

  // Timeout
  if (combined.includes('timeout') || combined.includes('etimedout') || combined.includes('timed out')) {
    return {
      service: 'unknown',
      // A timeout is not a stopped service, so Start Ollama is the wrong offer —
      // but a model too slow to answer is exactly when the already-configured
      // online AI is worth reaching for.
      userMessage: cloudFallback
        ? 'That took too long to answer. The model on this PC may still be starting up — try again, or switch to the online AI you already set up.'
        : 'That took too long to answer. The model may still be starting up — try again in a moment.',
      action: 'retry',
      actionLabel: 'Retry',
      cloudFallback,
    };
  }

  // (The cloud-provider branch used to sit here, after the Ollama check that
  // always matched first. It now runs above, where it can actually be reached.)

  return {
    service: 'unknown',
    userMessage: message || 'Something went wrong.',
    action: 'retry',
    actionLabel: 'Retry',
  };
}

export function shouldSurfaceCloudErrorWithoutFallback(errMsg: string): boolean {
  const normalized = errMsg.toLowerCase();
  return /status code 4\d\d/.test(normalized)
    || normalized.includes('rate limit')
    || normalized.includes('quota')
    || normalized.includes('insufficient_quota')
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('authentication')
    || (normalized.includes('invalid') && (normalized.includes('api') || normalized.includes('model')));
}

export function describeCloudTarget(config: CustomLLMConfig): string {
  const provider = config.provider?.toUpperCase?.() || 'CLOUD';
  return config.model ? `${provider} ${config.model}` : provider;
}
