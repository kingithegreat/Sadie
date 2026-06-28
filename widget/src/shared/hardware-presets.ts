/**
 * hardware-presets.ts
 *
 * Maps detected GPU hardware (VRAM) to a recommended set of local Ollama
 * model presets, so first-run setup pulls a model that actually fits the
 * user's machine instead of a single hard-coded default.
 *
 * This is a pure module with no Electron / Node dependencies so it can be
 * imported from both the main and renderer processes and unit-tested in
 * isolation.
 *
 * Consumed by:
 *  - FirstRunModal (renderer) — to pick which chat model to pull
 *  - diagnostics.ts (main) — hardware profile already classified there;
 *    these presets turn that profile into concrete model choices.
 */

export type HardwareProfile = '4gb' | '8gb' | '16gb+';

export interface ModelPreset {
  /** Ollama model id to pull / select. */
  id: string;
  /** Approximate download + VRAM footprint in GB. */
  sizeGB: number;
  /** Short human-readable label. */
  label: string;
}

export interface HardwareRecommendation {
  /** Classified profile, or 'unknown' when VRAM could not be detected. */
  profile: HardwareProfile | 'unknown';
  /** The raw VRAM reading the recommendation was based on, if any. */
  vramGB: number | null;
  /** Recommended general chat / tool-use model. */
  chat: ModelPreset;
  /** Recommended coding model. */
  coder: ModelPreset;
  /** Lightweight model guaranteed to fit even constrained GPUs. */
  fallback: ModelPreset;
  /** Human-readable explanation of why these models were chosen. */
  reason: string;
}

// VRAM thresholds (GB). Kept consistent with diagnostics.vramToProfile and
// the inline logic in FirstRunModal so all three agree.
export const PROFILE_8GB_MIN = 6;
export const PROFILE_16GB_MIN = 12;

/**
 * Classify a VRAM reading into a hardware profile.
 * Returns null when VRAM is unknown (detection failed).
 */
export function profileForVram(vramGB: number | null): HardwareProfile | null {
  if (vramGB === null || vramGB === undefined || Number.isNaN(vramGB)) return null;
  if (vramGB >= PROFILE_16GB_MIN) return '16gb+';
  if (vramGB >= PROFILE_8GB_MIN) return '8gb';
  return '4gb';
}

/**
 * True if a model of `sizeGB` comfortably fits in `vramGB`, leaving headroom
 * for the KV cache / context. headroom defaults to 0.8 (use at most 80% of VRAM).
 */
export function fitsInVram(sizeGB: number, vramGB: number | null, headroom = 0.8): boolean {
  if (vramGB === null || vramGB === undefined || Number.isNaN(vramGB)) return true;
  return sizeGB <= vramGB * headroom;
}

// Concrete presets per profile. Models and sizes are drawn from the curated
// RECOMMENDED_MODELS catalog used by ModelSelector.
export const HARDWARE_PRESETS: Record<HardwareProfile, Omit<HardwareRecommendation, 'vramGB'>> = {
  '4gb': {
    profile: '4gb',
    chat: { id: 'qwen2.5:3b', sizeGB: 2.0, label: 'Qwen 2.5 (3B)' },
    coder: { id: 'qwen2.5:3b', sizeGB: 2.0, label: 'Qwen 2.5 (3B)' },
    fallback: { id: 'llama3.2:3b', sizeGB: 2.0, label: 'Llama 3.2 (3B)' },
    reason: 'Your GPU has limited VRAM, so lightweight 3B models give the best balance of speed and quality without spilling to CPU.',
  },
  '8gb': {
    profile: '8gb',
    chat: { id: 'qwen2.5:7b', sizeGB: 4.4, label: 'Qwen 2.5 (7B)' },
    coder: { id: 'qwen2.5-coder:7b', sizeGB: 4.4, label: 'Qwen 2.5 Coder (7B)' },
    fallback: { id: 'qwen2.5:3b', sizeGB: 2.0, label: 'Qwen 2.5 (3B)' },
    reason: 'Your GPU comfortably fits 7B models — the best all-round local quality for chat, tool use, and coding at this VRAM tier.',
  },
  '16gb+': {
    profile: '16gb+',
    chat: { id: 'qwen2.5:14b', sizeGB: 8.2, label: 'Qwen 2.5 (14B)' },
    coder: { id: 'qwen2.5-coder:14b', sizeGB: 8.2, label: 'Qwen 2.5 Coder (14B)' },
    fallback: { id: 'qwen2.5:7b', sizeGB: 4.4, label: 'Qwen 2.5 (7B)' },
    reason: 'Your GPU has plenty of VRAM, so larger 14B models run well and noticeably improve reasoning and coding quality.',
  },
};

// Safe default used when VRAM cannot be detected — mirrors the previous
// hard-coded first-run choice so behaviour never regresses on unknown hardware.
const UNKNOWN_RECOMMENDATION: Omit<HardwareRecommendation, 'vramGB'> = {
  profile: 'unknown',
  chat: { id: 'qwen2.5:7b', sizeGB: 4.4, label: 'Qwen 2.5 (7B)' },
  coder: { id: 'qwen2.5-coder:7b', sizeGB: 4.4, label: 'Qwen 2.5 Coder (7B)' },
  fallback: { id: 'qwen2.5:3b', sizeGB: 2.0, label: 'Qwen 2.5 (3B)' },
  reason: "We couldn't detect your GPU, so we picked balanced 7B models that run on most machines. You can change the model any time in settings.",
};

/**
 * Recommend local models for a given hardware profile.
 * Passing null (unknown profile) returns the safe balanced default.
 */
export function recommendModelsForProfile(
  profile: HardwareProfile | null
): HardwareRecommendation {
  if (profile === null) {
    return { ...UNKNOWN_RECOMMENDATION, vramGB: null };
  }
  return { ...HARDWARE_PRESETS[profile], vramGB: null };
}

/**
 * Recommend local models for a raw VRAM reading. This is the primary entry
 * point for callers that have a VRAM number (e.g. FirstRunModal after GPU
 * detection). Null/unknown VRAM yields the safe balanced default.
 */
export function recommendModelsForVram(vramGB: number | null): HardwareRecommendation {
  const profile = profileForVram(vramGB);
  if (profile === null) {
    return { ...UNKNOWN_RECOMMENDATION, vramGB: vramGB ?? null };
  }
  return { ...HARDWARE_PRESETS[profile], vramGB: vramGB ?? null };
}
