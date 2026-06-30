/**
 * SADIE / HomeBot — Entitlements (Pro tier dimension)
 * ---------------------------------------------------------------------------
 * Keystone of the Free-vs-Pro monetization split.
 * See: Notion → SADIE → "💰 Free vs Pro Spec — DECISION (2026-06-29)".
 *
 * This module is the SINGLE SOURCE OF TRUTH for "what is a tier allowed to do".
 * It is a NEW DIMENSION layered onto the existing permission model
 * (src/toolRegistry.ts allowlist + per-tool confirmation), NOT a parallel
 * system. The flow is:
 *
 *     license  ──(tierResolver)──▶  Tier  ──(entitlements)──▶  Capability[]
 *                                                │
 *                          ToolRegistry / IPC handlers consult hasFeature()
 *
 * Design rules (from the spec):
 *   - "Chat is free. Agency is paid."
 *   - single-prompt output  → lean Free
 *   - runs over time / acts on the system / remembers → lean Pro
 *
 * This file is PURE and side-effect free: no I/O, no electron, no network.
 * Given a tier it deterministically returns which capabilities are allowed,
 * which makes it trivially unit-testable.
 */

/** The two tiers. Kept as a string union so it can extend later (e.g. 'team'). */
export type Tier = 'free' | 'pro';

/**
 * Capabilities are the gateable units of functionality. They are intentionally
 * coarse-grained (feature areas), matching the spec's `hasFeature(...)` calls,
 * not individual tool names. Tool→capability mapping lives at the handler layer.
 */
export type Capability =
  // ── Free capabilities (drive adoption) ────────────────────────────────
  | 'localChat'          // Unlimited local LLM chat via Ollama
  | 'cloudByok'          // Cloud LLM routing, bring-your-own-key
  | 'modelSelector'      // Model selector + hardware-aware recommendations
  | 'diagnostics'        // First-run diagnostics (Ollama/ports/disk/GPU)
  | 'themes'             // Dark mode / themes / basic chat UI + local history
  | 'tasterTools'        // Safe, read-only taster handlers (web search, read file, calc, clipboard, time)
  | 'basicPermissions'   // Basic allow/deny permission prompts (trust baseline)
  // ── Pro capabilities ("it works for you" — the paid moat) ─────────────
  | 'automation'         // Automation Center: scheduled + triggered workflows (n8n) — FLAGSHIP
  | 'fullTools'          // Full 85+ tool library, esp. write/execute/system-control
  | 'rag'                // RAG engine / Knowledge Stacks (Qdrant)
  | 'voice'              // Voice STT/TTS, hands-free
  | 'morningBriefing'    // Morning briefing / proactive agents
  | 'imageGen'           // Local image generation (sd.cpp)
  | 'advancedPolicy';    // Granular per-tool rules, allowlists, audit log

/** Sentinel: free tier is allowed unlimited (used for MCP connection cap). */
export const UNLIMITED = Infinity;

/**
 * The capability matrix — the one place tier→capability is defined.
 * Pro is a strict superset of Free (Pro users keep every Free capability).
 */
const FREE_CAPABILITIES: ReadonlyArray<Capability> = [
  'localChat',
  'cloudByok',
  'modelSelector',
  'diagnostics',
  'themes',
  'tasterTools',
  'basicPermissions',
];

const PRO_ONLY_CAPABILITIES: ReadonlyArray<Capability> = [
  'automation',
  'fullTools',
  'rag',
  'voice',
  'morningBriefing',
  'imageGen',
  'advancedPolicy',
];

const CAPABILITY_MATRIX: Readonly<Record<Tier, ReadonlySet<Capability>>> = {
  free: new Set<Capability>(FREE_CAPABILITIES),
  pro: new Set<Capability>([...FREE_CAPABILITIES, ...PRO_ONLY_CAPABILITIES]),
};

/** MCP connection caps per tier (spec: Free = 1 connection, Pro = unlimited). */
const MCP_CONNECTION_LIMIT: Readonly<Record<Tier, number>> = {
  free: 1,
  pro: UNLIMITED,
};

/** Type guard for untrusted/legacy inputs; anything unknown is treated as free. */
export function normalizeTier(value: unknown): Tier {
  return value === 'pro' ? 'pro' : 'free';
}

/** Is this an active Pro tier? */
export function isPro(tier: Tier | undefined): boolean {
  return normalizeTier(tier) === 'pro';
}

/** Does the given tier include the given capability? The core gate check. */
export function hasFeature(tier: Tier | undefined, capability: Capability): boolean {
  return CAPABILITY_MATRIX[normalizeTier(tier)].has(capability);
}

/** All capabilities granted to a tier (returns a fresh array, safe to mutate). */
export function capabilitiesFor(tier: Tier | undefined): Capability[] {
  return Array.from(CAPABILITY_MATRIX[normalizeTier(tier)]);
}

/** The minimum tier required for a capability (used to label upgrade prompts). */
export function requiredTierFor(capability: Capability): Tier {
  return CAPABILITY_MATRIX.free.has(capability) ? 'free' : 'pro';
}

/** Whether a capability is Pro-only (i.e. a paywalled feature). */
export function isProCapability(capability: Capability): boolean {
  return requiredTierFor(capability) === 'pro';
}

/** Max number of concurrent MCP connections allowed for the tier. */
export function mcpConnectionLimit(tier: Tier | undefined): number {
  return MCP_CONNECTION_LIMIT[normalizeTier(tier)];
}

/** Can the tier open one more MCP connection given how many are already open? */
export function canAddMcpConnection(tier: Tier | undefined, currentCount: number): boolean {
  return currentCount < mcpConnectionLimit(tier);
}

/**
 * A structured, user-facing upgrade prompt returned whenever a free user hits a
 * Pro fence. UI renders this; the deep link points at the LS checkout. Kept
 * data-only (no copy hardcoded into handlers) so messaging stays consistent.
 */
export interface UpgradePrompt {
  reason: 'upgrade_required';
  capability: Capability;
  requiredTier: Tier;
  /** Short, reusable headline for the upgrade modal / Pro badge. */
  title: string;
  message: string;
  /** Deep-link target the renderer turns into a checkout button. */
  upgradeUrl: string;
}

/** Default checkout deep link; overridable so the LS store URL is config-driven. */
export const DEFAULT_UPGRADE_URL = 'sadie://upgrade';

/** Human-readable labels for capabilities (single place for UI copy). */
const CAPABILITY_LABELS: Partial<Record<Capability, string>> = {
  automation: 'Automation Center',
  fullTools: 'the full tool library',
  rag: 'Knowledge Stacks (RAG)',
  voice: 'Voice mode',
  morningBriefing: 'Morning briefings & proactive agents',
  imageGen: 'Local image generation',
  advancedPolicy: 'Advanced permission controls',
};

/** Build the upgrade prompt for a gated capability. */
export function buildUpgradePrompt(
  capability: Capability,
  upgradeUrl: string = DEFAULT_UPGRADE_URL
): UpgradePrompt {
  const label = CAPABILITY_LABELS[capability] ?? capability;
  return {
    reason: 'upgrade_required',
    capability,
    requiredTier: requiredTierFor(capability),
    title: 'SADIE Pro',
    message: `${label} is a SADIE Pro feature. Upgrade to unlock it.`,
    upgradeUrl,
  };
}

/**
 * The single decision function for gating. Returns either {allowed:true} or a
 * structured upgrade prompt. Both the ToolRegistry and the IPC handlers call
 * this so there is exactly one fence implementation.
 */
export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; upgrade: UpgradePrompt };

export function checkEntitlement(
  tier: Tier | undefined,
  capability: Capability,
  upgradeUrl?: string
): EntitlementDecision {
  if (hasFeature(tier, capability)) return { allowed: true };
  return { allowed: false, upgrade: buildUpgradePrompt(capability, upgradeUrl) };
}
