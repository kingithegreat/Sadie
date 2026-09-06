/**
 * The router's job is to be un-buyable: no score, however high, may get past
 * FREE ONLY or past character consistency. These tests assert the gates hold
 * against a provider that is otherwise the obvious winner, because a gate only
 * tested with a losing input has never actually been tested.
 */
import { GenerationRouter, evaluate } from '../movie/router';
import type {
  GenerationCapability,
  GenerationProvider,
  GenerationRequest,
} from '../movie/types';

const baseCap = (over: Partial<GenerationCapability> = {}): GenerationCapability => ({
  canGenerate: true,
  costMicroUsd: 0,
  maxDurationSec: 10,
  maxWidth: 1920,
  maxHeight: 1080,
  imageToVideo: true,
  referenceImages: 'multi',
  watermark: 'none',
  availability: 'ready',
  deferred: false,
  throughputPerMin: 5,
  ...over,
});

const req = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  kind: 'image',
  prompt: 'Imhotep approaches the temple at golden hour',
  width: 1920,
  height: 1080,
  shotId: 'shot_001',
  shotDir: '/tmp/shot_001',
  freeOnly: true,
  allowWatermark: false,
  allowDeferred: false,
  ...over,
});

const stub = (
  id: string,
  cap: GenerationCapability,
  kind: GenerationProvider['kind'] = 'both',
  gen?: GenerationProvider['generate'],
): GenerationProvider => ({
  id,
  kind,
  probe: async () => cap,
  generate: gen ?? (async () => ({ status: 'done', provider: id, files: [`${id}.png`], costMicroUsd: cap.costMicroUsd })),
});

describe('FREE ONLY is a gate, not a preference', () => {
  it('refuses a paid provider even when it is otherwise perfect', async () => {
    const r = new GenerationRouter()
      // Paid, ready, clean, multi-ref: it would win on every other axis.
      .register(stub('paid-premium', baseCap({ costMicroUsd: 250_000 })))
      // Free but merely rate-limited.
      .register(stub('free-slow', baseCap({ availability: 'rate_limited' })));

    const d = await r.route(req());
    expect(d.chosen?.providerId).toBe('free-slow');
    const paid = d.rejected.find((x) => x.providerId === 'paid-premium');
    expect(paid?.reason).toContain('FREE ONLY');
  });

  it('rejects a single micro-dollar — the gate is an integer compare', async () => {
    const r = new GenerationRouter().register(stub('nearly-free', baseCap({ costMicroUsd: 1 })));
    const d = await r.route(req());
    expect(d.chosen).toBeNull();
    expect(d.summary).toContain('NO ELIGIBLE PROVIDER under FREE ONLY');
  });

  it('admits the same provider once FREE ONLY is off', async () => {
    const r = new GenerationRouter().register(stub('paid', baseCap({ costMicroUsd: 250_000 })));
    expect((await r.route(req(), { freeOnly: false })).chosen?.providerId).toBe('paid');
  });
});

describe('character consistency cannot be scored past', () => {
  it('rejects a provider that cannot take the references the shot supplies', async () => {
    const r = new GenerationRouter()
      .register(stub('no-refs', baseCap({ referenceImages: 'none', throughputPerMin: 60 })))
      .register(stub('refs', baseCap({ referenceImages: 'multi', availability: 'queued' })));

    const d = await r.route(req({ characterRefs: ['/refs/imhotep_a.png', '/refs/imhotep_b.png'] }));
    expect(d.chosen?.providerId).toBe('refs');
    expect(d.rejected.find((x) => x.providerId === 'no-refs')?.reason)
      .toContain('provider accepts none');
  });
});

describe('deferred providers (Colab)', () => {
  const colab = stub('colab', baseCap({ deferred: true, availability: 'needs_human', etaSec: 600 }));

  it('is excluded when the caller needs a result now', async () => {
    const d = await new GenerationRouter().register(colab).route(req({ allowDeferred: false }));
    expect(d.chosen).toBeNull();
    expect(d.rejected[0].reason).toContain('deferred');
  });

  it('is eligible when deferral is allowed, but loses to anything ready', async () => {
    const r = new GenerationRouter()
      .register(colab)
      .register(stub('local', baseCap({ maxWidth: 512, maxHeight: 512 })));
    const d = await r.route(req({ allowDeferred: true, width: 512, height: 512 }));
    expect(d.chosen?.providerId).toBe('local');
    expect(d.fallbacks.map((f) => f.providerId)).toContain('colab');
  });
});

describe('resolution and duration are checked against the request', () => {
  it('rejects a 512px provider for a 1920px shot', async () => {
    const d = await new GenerationRouter()
      .register(stub('sd15-local', baseCap({ maxWidth: 512, maxHeight: 512 })))
      .route(req());
    expect(d.chosen).toBeNull();
    expect(d.rejected[0].reason).toContain('512x512 < requested 1920x1080');
  });

  it('rejects a video provider that cannot reach the shot length', async () => {
    const d = await new GenerationRouter()
      .register(stub('short-clips', baseCap({ maxDurationSec: 4 }), 'video'))
      .route(req({ kind: 'video', durationSec: 8 }));
    expect(d.rejected[0].reason).toContain('max 4s < requested 8s');
  });
});

describe('failure modes stay legible', () => {
  it('says so when nothing is registered, rather than returning a bare null', async () => {
    const d = await new GenerationRouter().route(req());
    expect(d.chosen).toBeNull();
    expect(d.summary).toBe('no providers registered');
  });

  it('survives one adapter whose probe throws', async () => {
    const bad: GenerationProvider = {
      id: 'broken', kind: 'both',
      probe: async () => { throw new Error('ECONNREFUSED'); },
      generate: async () => ({ status: 'failed', provider: 'broken', error: 'x' }),
    };
    const d = await new GenerationRouter().register(bad).register(stub('good', baseCap())).route(req());
    expect(d.chosen?.providerId).toBe('good');
    expect(d.rejected.find((x) => x.providerId === 'broken')?.reason).toContain('ECONNREFUSED');
  });

  it('walks the fallback list when the winner fails at generate time', async () => {
    // The common free-tier failure: probe was fine, the quota died a second later.
    const flaky = stub('flaky', baseCap({ throughputPerMin: 60 }), 'both',
      async () => ({ status: 'failed', provider: 'flaky', error: '429 quota' }));
    const r = new GenerationRouter().register(flaky).register(stub('steady', baseCap({ throughputPerMin: 1 })));
    const { result, decision } = await r.generate(req());
    expect(decision.chosen?.providerId).toBe('flaky');
    expect(result).toMatchObject({ status: 'done', provider: 'steady' });
  });

  it('reports every rejection reason when nothing is eligible', async () => {
    const r = new GenerationRouter()
      .register(stub('paid', baseCap({ costMicroUsd: 500_000 })))
      .register(stub('tiny', baseCap({ maxWidth: 256, maxHeight: 256 })));
    const d = await r.route(req());
    expect(d.summary).toContain('paid:');
    expect(d.summary).toContain('tiny:');
  });
});

describe('evaluate() is testable without a router', () => {
  it('demands a reason from a provider that says no', () => {
    const s = evaluate({ id: 'x', kind: 'both' }, baseCap({ canGenerate: false }), req(), true);
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe('reported canGenerate=false with no reason');
  });
});
