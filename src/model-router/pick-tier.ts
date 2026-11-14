/**
 * Tier picking for the OpenRouter model router.
 *
 * Rules come from the coding-agent research note (10 Nov 2026, "Routing
 * rules"): start at mid when unclear, force cheap only for small mechanical
 * work, force top for hard or risky work, and escalate exactly one tier when
 * the previous attempt failed.
 */

export type RouterTier = 'cheap' | 'mid' | 'top';

export const TIER_ORDER: readonly RouterTier[] = ['cheap', 'mid', 'top'];

/** Words that mark a task as small and mechanical. */
const CHEAP_KEYWORDS: readonly RegExp[] = [
  /\btypos?\b/,
  /\brenam(?:e|es|ed|ing)\b/,
  /\bcomments?\b/,
  /\bformat(?:s|ted|ting)?\b/,
  /\blint(?:s|ed|ing)?\b/,
  /\b(?:tests?\s+only|only\s+tests?)\b/,
  /\bchangelog\b/,
  /\badd(?:ing)?\s+(?:an?\s+)?imports?\b/,
  /\bboilerplate\b/,
  /\bcss\s+tweaks?\b/,
  /\bcopy\s+changes?\b/,
];

/** Words that rule out the cheap tier even when a cheap keyword appears. */
const CHEAP_BLOCKERS: readonly RegExp[] = [
  /\bregressions?\b/,
  /\bproduction\s+outage\b/,
];

/** Any one of these forces the top tier. */
const TOP_KEYWORDS: readonly RegExp[] = [
  /\barchitect\w*/,
  /\bredesign\w*/,
  /\bmigrat\w*/,
  /\bauth(?:n|z|entication|enticate|enticated|orization|orisation|orize|orise)?\b/,
  /\bsecurity\b/,
  /\bssr\b/,
  /\bhydrat\w*/,
  /\bfirebase\s+rules\b/,
  /\brace\s+conditions?\b/,
  /\braces?\b/,
  /\bflak(?:y|iness|e)\b/,
  /\bdeadlocks?\b/,
  /\bdata\s+loss\b/,
  /\broot\s+cause\b/,
  /\bperformance\s+cliff\b/,
  /\bproduction\s+(?:incident|outage)\b/,
  /\bprod\s+incident\b/,
  /\bpayments?\b/,
  /\bpii\b/,
  // Cross-cutting changes.
  /\bshared\s+module\b/,
  /\binterceptors?\b/,
  /\bguards?\b/,
  /\bcloud\s+run\b/,
  /\bcross[-\s]cutting\b/,
];

export interface TierSignals {
  cheapKeyword: boolean;
  cheapBlocked: boolean;
  hard: boolean;
  reasons: string[];
}

function knownCount(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function tierSignals(task: string, files: number, diffLines: number): TierSignals {
  const t = (task || '').toLowerCase();
  const reasons: string[] = [];
  const topHit = TOP_KEYWORDS.find(re => re.test(t));
  const fileCount = knownCount(files);
  const diffCount = knownCount(diffLines);
  if (topHit) reasons.push(`hard keyword ${topHit.source}`);
  if (fileCount !== undefined && fileCount >= 8) reasons.push(`${fileCount} files (>= 8)`);
  if (diffCount !== undefined && diffCount >= 400) reasons.push(`${diffCount} diff lines (>= 400)`);
  const hard = reasons.length > 0;
  const cheapKeyword = CHEAP_KEYWORDS.some(re => re.test(t));
  const cheapBlocked = CHEAP_BLOCKERS.some(re => re.test(t));
  return { cheapKeyword, cheapBlocked, hard, reasons };
}

export function escalateTier(tier: RouterTier): RouterTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

export function clampTier(tier: RouterTier, min: RouterTier, max: RouterTier): RouterTier {
  const i = TIER_ORDER.indexOf(tier);
  const lo = TIER_ORDER.indexOf(min);
  const hi = TIER_ORDER.indexOf(max);
  return TIER_ORDER[Math.max(lo, Math.min(hi, i))];
}

/**
 * Pick a tier for a coding task.
 *
 * - top: any hard keyword, >= 8 files, or >= 400 expected diff lines.
 * - cheap: a cheap keyword AND <= 2 files AND <= 80 diff lines AND no hard or
 *   blocking words. Unknown counts (negative / NaN) never qualify as cheap.
 * - mid: everything else, including an unclear or empty task.
 * - failed: the base tier is escalated by exactly one (cheap -> mid -> top).
 */
export function pickTier(task: string, files: number, diffLines: number, failed = false): RouterTier {
  const s = tierSignals(task, files, diffLines);
  const fileCount = knownCount(files);
  const diffCount = knownCount(diffLines);
  let base: RouterTier;
  if (s.hard) base = 'top';
  else if (
    s.cheapKeyword && !s.cheapBlocked
    && fileCount !== undefined && fileCount <= 2
    && diffCount !== undefined && diffCount <= 80
  ) base = 'cheap';
  else base = 'mid';
  return failed ? escalateTier(base) : base;
}

export interface ChatTierPolicy {
  defaultTier: RouterTier;
  maxTier: RouterTier;
}

/**
 * Chat turns default to the cheap tier (or the configured default). Hard
 * topics use the same keyword rules as the coder but are capped at the
 * configured chat maximum (mid by default). Failure escalation happens in the
 * router, one tier at a time, exactly like coder calls.
 */
export function pickChatTier(message: string, policy: ChatTierPolicy, failed = false): RouterTier {
  const s = tierSignals(message, 0, 0);
  let base: RouterTier = policy.defaultTier;
  if (s.hard) base = 'top';
  else if (s.cheapKeyword && !s.cheapBlocked) base = 'cheap';
  base = clampTier(base, 'cheap', policy.maxTier);
  return failed ? escalateTier(base) : base;
}
