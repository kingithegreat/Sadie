/**
 * model-pull-guard.ts
 *
 * Action-site disk guard for Ollama model pulls, usable from ANY pull path —
 * not just the ModelSelector dropdown. Complements model-download-fit.ts
 * (the pure severity ladder) with:
 *
 *   - a curated size catalog keyed by normalized model id, so callers that
 *     only have a model id string (e.g. the chat "📦 Pull <model>" retry
 *     button in MessageBubble) can still assess disk fit;
 *   - `assessPullById` — one call that resolves the size and runs the fit
 *     assessment.
 *
 * Scope note (recorded follow-up from PRs #35/#38): cloud/custom API models
 * (OpenAI, OpenRouter, …) consume no local disk — a pull guard does not apply
 * to them, so the ☁️ list intentionally has no disk badges. Every LOCAL pull
 * entry point should route through this module (or assessModelDownloadFit
 * with a live probe) before starting a multi-GB download.
 *
 * Like model-download-fit, this module is pure (no fs / Electron / I/O):
 * callers probe free disk via the diagnostics IPC and pass the reading in.
 * Unknown readings and unknown model sizes fail open — they never block.
 */

import {
  assessModelDownloadFit,
  type ModelDownloadFit,
} from './model-download-fit';

/**
 * Canonicalize a model id for catalog lookup: lowercase, drop a trailing
 * `:latest`, strip all non-alphanumerics. Mirrors ModelSelector's matcher so
 * `mistral`, `mistral:latest` and `Mistral` all resolve to the same entry.
 */
export function normalizeModelId(id: string): string {
  return (id || '').toLowerCase().replace(/:latest$/, '').replace(/[^a-z0-9]/g, '');
}

/**
 * Advertised on-disk sizes (GB) of the curated model catalog, keyed by
 * RAW model id. Must stay in sync with RECOMMENDED_MODELS in
 * ModelSelector.tsx — enforced by a consistency test in
 * __tests__/model-pull-guard.test.ts, so drift fails CI rather than
 * silently mis-guarding.
 */
export const CURATED_MODEL_SIZES_GB: Readonly<Record<string, number>> = {
  'qwen2.5:7b': 4.4,
  'qwen2.5:14b': 8.2,
  'gemma4:e4b': 5.5,
  'gemma4:e2b': 3.0,
  'gemma3:4b': 3.3,
  'mistral:latest': 4.4,
  'mistral-small:latest': 14,
  'mistral-nemo:latest': 7.1,
  'deepseek-r1:8b': 4.9,
  'phi4-mini': 2.5,
  'qwen2.5:3b': 2,
  'qwen2.5-coder:7b': 4.4,
  'qwen2.5-coder:14b': 8.2,
  'llama3.1:8b': 4.7,
  'llama3.1:70b': 43,
  'llama3.2:3b': 2,
  'dolphin:7b': 3.8,
};

/** Normalized-id → sizeGB lookup table derived from the catalog above. */
const SIZE_BY_NORMALIZED_ID: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CURATED_MODEL_SIZES_GB).map(([id, gb]) => [normalizeModelId(id), gb])
  )
);

/**
 * Look up the advertised size (GB) of a model by id. Returns null for models
 * outside the curated catalog (custom tags, user-typed ids) — the guard then
 * fails open with severity 'unknown'.
 */
export function sizeForModelId(modelId: string): number | null {
  const gb = SIZE_BY_NORMALIZED_ID[normalizeModelId(modelId)];
  return typeof gb === 'number' ? gb : null;
}

/**
 * Assess whether pulling `modelId` fits on disk given `freeGB` free space.
 * `sizeGB` (when the caller already knows it, e.g. from the catalog row)
 * takes precedence over the catalog lookup. Never throws; never blocks on
 * unknown size or unknown free-space readings.
 */
export function assessPullById(
  modelId: string,
  freeGB: number | null | undefined,
  sizeGB?: number | null
): ModelDownloadFit {
  const resolvedSize =
    typeof sizeGB === 'number' && Number.isFinite(sizeGB) && sizeGB > 0
      ? sizeGB
      : sizeForModelId(modelId);
  return assessModelDownloadFit({ sizeGB: resolvedSize, freeGB });
}
