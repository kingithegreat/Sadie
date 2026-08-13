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

/**
 * Return the de-duplicated list of Ollama model ids recommended for a given
 * VRAM reading (chat + coder + fallback). Pure helper intended for UI layers
 * (e.g. ModelSelector) that want to flag or prioritise the models that best
 * fit the user's detected GPU. Unknown VRAM yields the safe balanced default
 * set, so callers can decide whether to surface it.
 */
export function recommendedModelIdsForVram(vramGB: number | null): string[] {
  const rec = recommendModelsForVram(vramGB);
  return Array.from(new Set([rec.chat.id, rec.coder.id, rec.fallback.id]));
}

// ---------------------------------------------------------------------------
// Setup-path recommendation (first run)
// ---------------------------------------------------------------------------

/**
 * Minimum VRAM before local AI is worth suggesting to someone who does not
 * know what any of this means. Below this the 3B models still run, but slowly
 * enough that a first-time user concludes the app is broken rather than small.
 */
export const LOCAL_VIABLE_MIN_VRAM = 4;

export type SetupPathId = 'local' | 'cloud';

export interface SetupPathRecommendation {
  /** Which card to badge as recommended. */
  recommended: SetupPathId;
  /**
   * One sentence, in the words a non-technical person would use. Shown under
   * the two choices, so it must explain the trade-off without naming Ollama,
   * VRAM tiers, or model parameter counts.
   */
  reason: string;
  /** True when detection has not produced a reading yet or failed outright. */
  uncertain: boolean;
}

/**
 * Which setup path to recommend, from a raw VRAM reading.
 *
 * This exists because the first screen asks a brand-new user the single
 * hardest question in the app — "local or cloud?" — and until now answered it
 * with "runs on your GPU", which is a question, not an answer. The app can
 * detect the graphics card, so it should have an opinion.
 *
 * The bias is deliberately toward LOCAL wherever the machine can take it:
 * local needs no account, no card, no API key and no trust in a third party,
 * which for a non-technical user beats a stronger model behind a signup form.
 * Cloud is recommended only when local would genuinely disappoint.
 */
export function recommendSetupPath(vramGB: number | null | undefined): SetupPathRecommendation {
  if (vramGB === null || vramGB === undefined || Number.isNaN(vramGB)) {
    return {
      recommended: 'cloud',
      reason:
        "We couldn't find a graphics card we recognise, so the online option is the safer place to start. You can switch to running it on this PC later.",
      uncertain: true,
    };
  }

  if (vramGB < LOCAL_VIABLE_MIN_VRAM) {
    return {
      recommended: 'cloud',
      reason: `Your graphics card has about ${Math.round(vramGB)}GB of memory, which is a little small for running AI on this PC — it would be slow. The online option is free to start and works right away.`,
      uncertain: false,
    };
  }

  if (vramGB < PROFILE_8GB_MIN) {
    return {
      recommended: 'local',
      reason: `Your graphics card has about ${Math.round(vramGB)}GB of memory, so this PC can run AI on its own — no account and no card needed. It will be a bit slower and briefer than the online option.`,
      uncertain: false,
    };
  }

  return {
    recommended: 'local',
    reason: `Your graphics card has about ${Math.round(vramGB)}GB of memory, which is plenty. Running on this PC keeps everything private, costs nothing, and needs no account.`,
    uncertain: false,
  };
}
