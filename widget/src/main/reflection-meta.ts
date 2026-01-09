// Reflection meta type and builder (testable, CJS-compatible)
export interface ReflectionMeta {
  confidence: number | null;
  accepted: boolean;
  threshold?: number | null;
}

export function buildReflectionMeta(outcome: any, confidenceRaw?: unknown): ReflectionMeta {
  if (!outcome) {
    return { confidence: null, accepted: false, threshold: undefined };
  }
  const raw = confidenceRaw !== undefined ? confidenceRaw : outcome.confidence;
  const confidence =
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1
      ? raw
      : null;
  return {
    confidence,
    accepted: Boolean(outcome.accepted && confidence !== null),
    threshold:
      typeof outcome.threshold === 'number'
        ? outcome.threshold
        : undefined,
  };
}

// Keep CommonJS export for backwards compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildReflectionMeta };
}