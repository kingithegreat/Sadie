/**
 * SADIE / HomeBot — Resolve a Tier from cached license state.
 * ---------------------------------------------------------------------------
 * Bridges licensing → entitlements. Crucially:
 *   - NO license  → 'free'  (the Free tier always works, zero license calls).
 *   - Valid Pro license (or within offline grace) → 'pro'.
 *
 * Pure and clock-injectable so it is deterministic in tests. The actual signed
 * cache file + periodic re-validation (spec P0/P3 hardening) write into this
 * shape; this resolver is the decision logic over it.
 */
import { Tier } from '../entitlements';

/** Persisted, locally-cached entitlement snapshot (later: signed on disk). */
export interface CachedEntitlement {
  /** Last validation said this key is a valid, active Pro license. */
  pro: boolean;
  /** Epoch ms of the last successful online validation. */
  lastValidatedAt: number;
  /** Optional plan expiry epoch ms (lifetime → undefined). */
  expiresAt?: number;
}

/** Default offline grace window: 14 days (spec: 7–14 day offline grace). */
export const DEFAULT_OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export interface ResolveTierOptions {
  offlineGraceMs?: number;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Decide the active tier from the cached entitlement.
 * Returns 'free' when cache is absent, not Pro, expired, or past offline grace.
 */
export function resolveTier(
  cache: CachedEntitlement | null | undefined,
  opts: ResolveTierOptions = {}
): Tier {
  // No license / no cache → Free always works.
  if (!cache || !cache.pro) return 'free';

  const now = opts.now ?? Date.now();
  const graceMs = opts.offlineGraceMs ?? DEFAULT_OFFLINE_GRACE_MS;

  // Hard expiry (e.g. annual plan lapsed) → downgrade to Free.
  if (typeof cache.expiresAt === 'number' && now > cache.expiresAt) {
    return 'free';
  }

  // Offline grace: if we haven't re-validated within the window, downgrade so a
  // cancelled/refunded license can't grant Pro forever offline.
  if (now - cache.lastValidatedAt > graceMs) {
    return 'free';
  }

  return 'pro';
}

/** Are we currently inside the offline grace window (no re-validation needed)? */
export function isWithinOfflineGrace(
  cache: CachedEntitlement | null | undefined,
  opts: ResolveTierOptions = {}
): boolean {
  if (!cache || !cache.pro) return false;
  const now = opts.now ?? Date.now();
  const graceMs = opts.offlineGraceMs ?? DEFAULT_OFFLINE_GRACE_MS;
  return now - cache.lastValidatedAt <= graceMs;
}
