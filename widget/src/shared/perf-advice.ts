/**
 * perf-advice.ts — pure, dependency-free logic that turns the baseline
 * performance aggregates (startup + first-token/TTFT) into a plain-language
 * health rating and actionable hints for the Settings → Diagnostics section.
 *
 * Like sparkline.ts this module has ZERO React/DOM/Electron references, so the
 * thresholds and the (slightly fiddly) "overall = worst known metric" logic are
 * covered by fast node logic tests instead of relying on a jsdom render. The
 * renderer just maps the returned rating to a badge colour + shows the hints.
 */

import type { PerfStatSummary } from './types';

export type PerfRating = 'good' | 'fair' | 'slow' | 'unknown';

export interface MetricVerdict {
  rating: PerfRating;
  /** Short human label, e.g. "Good", "A bit slow", "Slow", "No data yet". */
  label: string;
  /** The p95 value the verdict was based on (0 when no samples). */
  p95_ms: number;
}

export interface PerfAdvice {
  /** Worst of the two known metrics; 'unknown' only when BOTH lack samples. */
  overall: PerfRating;
  startup: MetricVerdict;
  firstToken: MetricVerdict;
  /** Actionable, de-duplicated hints. Empty when everything is good/unknown. */
  hints: string[];
}

/** p95 thresholds (ms). At/below `good` = good; at/below `fair` = fair; above = slow. */
export const STARTUP_THRESHOLDS = { good: 3000, fair: 8000 } as const;
export const FIRST_TOKEN_THRESHOLDS = { good: 1500, fair: 5000 } as const;

const LABELS: Record<PerfRating, string> = {
  good: 'Good',
  fair: 'A bit slow',
  slow: 'Slow',
  unknown: 'No data yet',
};

/** Rank used to pick the "worst" known rating for the overall verdict. */
const SEVERITY: Record<PerfRating, number> = { unknown: -1, good: 0, fair: 1, slow: 2 };

function rate(p95: number, count: number, t: { good: number; fair: number }): PerfRating {
  if (!count || count <= 0 || !Number.isFinite(p95)) return 'unknown';
  if (p95 <= t.good) return 'good';
  if (p95 <= t.fair) return 'fair';
  return 'slow';
}

function verdict(stat: PerfStatSummary | undefined, t: { good: number; fair: number }): MetricVerdict {
  const p95 = stat && Number.isFinite(stat.p95_ms) ? stat.p95_ms : 0;
  const count = stat?.count ?? 0;
  const rating = rate(p95, count, t);
  return { rating, label: LABELS[rating], p95_ms: rating === 'unknown' ? 0 : p95 };
}

/**
 * Build the performance health advice from the perf aggregates returned by
 * `readPerfAggregates()` / `getPerfAggregates()`. Never throws.
 */
export function buildPerfAdvice(
  stats: { startup?: PerfStatSummary; firstToken?: PerfStatSummary } | null | undefined,
): PerfAdvice {
  const startup = verdict(stats?.startup, STARTUP_THRESHOLDS);
  const firstToken = verdict(stats?.firstToken, FIRST_TOKEN_THRESHOLDS);

  // Overall = the worst KNOWN rating. If both are unknown, overall is unknown.
  const known = [startup.rating, firstToken.rating].filter((r) => r !== 'unknown');
  const overall: PerfRating = known.length
    ? known.reduce((worst, r) => (SEVERITY[r] > SEVERITY[worst] ? r : worst), 'good' as PerfRating)
    : 'unknown';

  const hints: string[] = [];
  if (startup.rating === 'fair' || startup.rating === 'slow') {
    hints.push(
      `Startup is ${startup.label.toLowerCase()} (p95 ${startup.p95_ms} ms). Closing other heavy apps, or keeping HomeBot's data folder on an SSD, can speed up launch.`,
    );
  }
  if (firstToken.rating === 'fair' || firstToken.rating === 'slow') {
    hints.push(
      `First response is ${firstToken.label.toLowerCase()} (p95 ${firstToken.p95_ms} ms). Try a smaller local model that fits your GPU's VRAM, shorten the context, or close other GPU-heavy apps.`,
    );
  }

  return { overall, startup, firstToken, hints };
}
