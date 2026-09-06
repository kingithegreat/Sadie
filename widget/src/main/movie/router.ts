/**
 * router.ts — picks the best FREE way to make one shot, and says why.
 *
 * Two rules shape this file.
 *
 * **Every rejection carries a reason.** A router that returns null with no
 * explanation is indistinguishable from a router with no providers registered,
 * and this codebase has repeatedly shipped defects of exactly that shape — a
 * zero that reads as a clean pass. `RoutingDecision.rejected` always lists every
 * provider that was considered and the sentence that disqualified it.
 *
 * **Gates before scores.** Anything that would make the output *wrong* — a cost
 * under FREE ONLY, a missing character reference, a resolution the provider
 * cannot reach — is a hard filter, not a penalty. A high enough score must never
 * be able to buy its way past $0 or past character consistency.
 */

import type {
  GenerationCapability,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ProviderScore,
  MovieRoutingDecision,
} from './types';

/** Availability → base score. Ordered by how soon a frame actually exists. */
const AVAILABILITY_SCORE: Record<GenerationCapability['availability'], number> = {
  ready: 100,
  rate_limited: 60,
  queued: 40,
  needs_human: 20,
  offline: 0,
};

export interface RouteOptions {
  /** Overrides req.freeOnly. Used by tests and by an explicit paid override. */
  freeOnly?: boolean;
}

export class GenerationRouter {
  private readonly providers = new Map<string, GenerationProvider>();

  register(provider: GenerationProvider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`duplicate provider id: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  list(): GenerationProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Probe every provider and rank them. Never throws for a bad provider — a
   * throwing probe is recorded as a rejection so one broken adapter cannot
   * take down routing for the rest.
   */
  async route(req: GenerationRequest, opts: RouteOptions = {}): Promise<MovieRoutingDecision> {
    const freeOnly = opts.freeOnly ?? req.freeOnly;

    if (this.providers.size === 0) {
      return {
        chosen: null,
        fallbacks: [],
        rejected: [],
        freeOnly,
        summary: 'no providers registered',
      };
    }

    const scored = await Promise.all(
      [...this.providers.values()].map(async (p): Promise<ProviderScore> => {
        let cap: GenerationCapability;
        try {
          cap = await p.probe(req);
        } catch (err) {
          return {
            providerId: p.id,
            eligible: false,
            reason: `probe threw: ${(err as Error).message}`,
            score: 0,
            capability: unavailable(`probe threw: ${(err as Error).message}`),
          };
        }
        return evaluate(p, cap, req, freeOnly);
      }),
    );

    const eligible = scored.filter((s) => s.eligible).sort((a, b) => b.score - a.score);
    const rejected = scored.filter((s) => !s.eligible);
    const chosen = eligible[0] ?? null;

    return {
      chosen,
      fallbacks: eligible.slice(1),
      rejected,
      freeOnly,
      summary: chosen
        ? `${chosen.providerId} (${chosen.capability.availability}, ` +
          `$${(chosen.capability.costMicroUsd / 1_000_000).toFixed(2)}` +
          `${chosen.capability.deferred ? ', deferred' : ''}) — ` +
          `${eligible.length - 1} fallback(s), ${rejected.length} rejected`
        : `NO ELIGIBLE PROVIDER${freeOnly ? ' under FREE ONLY' : ''} — ` +
          `${rejected.length} rejected: ` +
          rejected.map((r) => `${r.providerId}: ${r.reason}`).join('; '),
    };
  }

  /**
   * Route, then run — walking the fallback list when a provider fails at
   * generate() time rather than at probe() time, which is the common case for
   * free services (a quota that was fine a second ago).
   */
  async generate(req: GenerationRequest, opts: RouteOptions = {}): Promise<{
    decision: MovieRoutingDecision;
    result: GenerationResult;
  }> {
    const decision = await this.route(req, opts);
    if (!decision.chosen) {
      return {
        decision,
        result: { status: 'failed', provider: 'none', error: decision.summary },
      };
    }

    const order = [decision.chosen, ...decision.fallbacks];
    const errors: string[] = [];
    for (const candidate of order) {
      const provider = this.providers.get(candidate.providerId);
      if (!provider) continue;
      try {
        const result = await provider.generate(req);
        if (result.status !== 'failed') return { decision, result };
        errors.push(`${candidate.providerId}: ${result.error}`);
      } catch (err) {
        errors.push(`${candidate.providerId} threw: ${(err as Error).message}`);
      }
    }
    return {
      decision,
      result: {
        status: 'failed',
        provider: 'none',
        error: `all ${order.length} eligible provider(s) failed — ${errors.join('; ')}`,
      },
    };
  }
}

function unavailable(reason: string): GenerationCapability {
  return {
    canGenerate: false,
    reason,
    costMicroUsd: 0,
    maxDurationSec: 0,
    maxWidth: 0,
    maxHeight: 0,
    imageToVideo: false,
    referenceImages: 'none',
    watermark: 'unknown',
    availability: 'offline',
    deferred: false,
  };
}

/**
 * The gates, in order, then the score. Exported so the policy can be tested
 * without standing up a router or any adapters.
 */
export function evaluate(
  provider: Pick<GenerationProvider, 'id' | 'kind'>,
  cap: GenerationCapability,
  req: GenerationRequest,
  freeOnly: boolean,
): ProviderScore {
  const reject = (reason: string): ProviderScore => ({
    providerId: provider.id,
    eligible: false,
    reason,
    score: 0,
    capability: cap,
  });

  if (provider.kind !== 'both' && provider.kind !== req.kind) {
    return reject(`does not produce ${req.kind}`);
  }
  if (!cap.canGenerate) {
    return reject(cap.reason ?? 'reported canGenerate=false with no reason');
  }
  if (cap.availability === 'offline') {
    return reject('offline');
  }

  // FREE ONLY is a gate, never a penalty. Integer compare, so no float slack.
  if (freeOnly && cap.costMicroUsd > 0) {
    return reject(
      `costs $${(cap.costMicroUsd / 1_000_000).toFixed(4)} and FREE ONLY is on`,
    );
  }

  if (cap.maxWidth < req.width || cap.maxHeight < req.height) {
    return reject(
      `max ${cap.maxWidth}x${cap.maxHeight} < requested ${req.width}x${req.height}`,
    );
  }

  if (req.kind === 'video') {
    const want = req.durationSec ?? 0;
    if (want <= 0) return reject('video request has no durationSec');
    if (cap.maxDurationSec < want) {
      return reject(`max ${cap.maxDurationSec}s < requested ${want}s`);
    }
  }

  if (req.initImage && !cap.imageToVideo) {
    return reject('image-to-video requested, provider cannot start from a still');
  }

  // Character consistency is not negotiable. If the shot supplies references
  // and the provider cannot take one, its output will be a different person.
  const refCount = req.characterRefs?.length ?? 0;
  if (refCount > 0 && cap.referenceImages === 'none') {
    return reject(`${refCount} character reference(s) supplied, provider accepts none`);
  }

  if (!req.allowWatermark && cap.watermark !== 'none') {
    return reject(`watermark policy '${cap.watermark}' and watermarks are not allowed`);
  }
  if (!req.allowDeferred && cap.deferred) {
    return reject('returns deferred results and this request needs one now');
  }

  let score = AVAILABILITY_SCORE[cap.availability];
  const notes: string[] = [cap.availability];

  if (cap.watermark === 'none') { score += 25; notes.push('clean'); }
  if (refCount > 1 && cap.referenceImages === 'multi') { score += 20; notes.push('multi-ref'); }
  else if (refCount > 0 && cap.referenceImages !== 'none') { score += 10; notes.push('ref'); }
  if (req.initImage && cap.imageToVideo) { score += 10; notes.push('i2v'); }

  // Throughput breaks ties between things that are all free and all ready.
  if (cap.throughputPerMin) {
    score += Math.min(15, cap.throughputPerMin);
    notes.push(`${cap.throughputPerMin}/min`);
  }
  // Only meaningful when FREE ONLY is off; free providers all score 0 here.
  if (!freeOnly && cap.costMicroUsd > 0) {
    score -= Math.min(40, cap.costMicroUsd / 25_000);
    notes.push(`$${(cap.costMicroUsd / 1_000_000).toFixed(2)}`);
  }

  return {
    providerId: provider.id,
    eligible: true,
    reason: notes.join(', '),
    score,
    capability: cap,
  };
}
