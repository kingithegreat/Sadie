import {
  assessModelDownloadFit,
  canDownloadModel,
  bytesToGb,
  roundGb,
  formatGb,
  DEFAULT_HEADROOM_GB,
} from '../model-download-fit';

describe('model-download-fit helpers', () => {
  test('bytesToGb converts decimal GB and guards bad input', () => {
    expect(bytesToGb(1e9)).toBeCloseTo(1);
    expect(bytesToGb(4_400_000_000)).toBeCloseTo(4.4);
    expect(bytesToGb(0)).toBe(0);
    expect(bytesToGb(-5)).toBeNull();
    expect(bytesToGb(NaN)).toBeNull();
    expect(bytesToGb(undefined)).toBeNull();
    expect(bytesToGb(null)).toBeNull();
  });

  test('roundGb rounds to one decimal', () => {
    expect(roundGb(4.44)).toBe(4.4);
    expect(roundGb(4.45)).toBe(4.5);
    expect(roundGb(10)).toBe(10);
  });

  test('formatGb renders one-decimal GB and a placeholder for bad input', () => {
    expect(formatGb(4.4)).toBe('4.4 GB');
    expect(formatGb(8)).toBe('8.0 GB');
    expect(formatGb(null)).toBe('— GB');
    expect(formatGb(NaN)).toBe('— GB');
  });
});

describe('assessModelDownloadFit severity ladder', () => {
  test('ok when free space comfortably exceeds size + headroom', () => {
    const r = assessModelDownloadFit({ sizeGB: 4.4, freeGB: 100 });
    expect(r.severity).toBe('ok');
    expect(r.fits).toBe(true);
    expect(r.message).toBeNull();
    expect(r.requiredGB).toBe(6.4); // 4.4 + 2 default headroom
    expect(r.headroomGB).toBe(DEFAULT_HEADROOM_GB);
  });

  test('tight when model fits but eats into headroom', () => {
    // size 4.4, free 5 → fits (5 >= 4.4) but < 4.4 + 2
    const r = assessModelDownloadFit({ sizeGB: 4.4, freeGB: 5 });
    expect(r.severity).toBe('tight');
    expect(r.fits).toBe(true);
    expect(r.message).toMatch(/Low disk space/i);
  });

  test('insufficient when free space is below the raw model size', () => {
    const r = assessModelDownloadFit({ sizeGB: 14, freeGB: 3 });
    expect(r.severity).toBe('insufficient');
    expect(r.fits).toBe(false);
    expect(r.message).toMatch(/Not enough disk space/i);
    expect(r.freeGB).toBe(3);
  });

  test('unknown (fails open) when freeGB is null/undefined/NaN', () => {
    for (const freeGB of [null, undefined, NaN]) {
      const r = assessModelDownloadFit({ sizeGB: 4.4, freeGB: freeGB as any });
      expect(r.severity).toBe('unknown');
      expect(r.fits).toBe(true);
      expect(r.requiredGB).toBeNull();
      expect(r.freeGB).toBeNull();
      expect(r.message).toBeNull();
    }
  });

  test('unknown when sizeGB is missing or non-positive', () => {
    expect(assessModelDownloadFit({ sizeGB: undefined, freeGB: 100 }).severity).toBe('unknown');
    expect(assessModelDownloadFit({ sizeGB: 0, freeGB: 100 }).severity).toBe('unknown');
    expect(assessModelDownloadFit({ sizeGB: -3, freeGB: 100 }).severity).toBe('unknown');
  });

  test('custom headroom widens/narrows the tight band', () => {
    // size 8, free 9: with default 2GB headroom → tight; with 0 headroom → ok
    expect(assessModelDownloadFit({ sizeGB: 8, freeGB: 9 }).severity).toBe('tight');
    expect(assessModelDownloadFit({ sizeGB: 8, freeGB: 9, headroomGB: 0 }).severity).toBe('ok');
    // big headroom pushes an otherwise-ok pull into tight
    expect(assessModelDownloadFit({ sizeGB: 8, freeGB: 12, headroomGB: 5 }).severity).toBe('tight');
  });

  test('negative/invalid headroom falls back to the default', () => {
    const r = assessModelDownloadFit({ sizeGB: 4.4, freeGB: 5, headroomGB: -1 });
    expect(r.headroomGB).toBe(DEFAULT_HEADROOM_GB);
  });

  test('boundary: free exactly equals size is the lowest fitting case (tight, not insufficient)', () => {
    const r = assessModelDownloadFit({ sizeGB: 10, freeGB: 10 });
    expect(r.severity).toBe('tight');
    expect(r.fits).toBe(true);
  });

  test('boundary: free exactly equals size + headroom is ok', () => {
    const r = assessModelDownloadFit({ sizeGB: 10, freeGB: 12 });
    expect(r.severity).toBe('ok');
  });

  test('negative freeGB is clamped and treated as insufficient', () => {
    const r = assessModelDownloadFit({ sizeGB: 4, freeGB: -100 });
    expect(r.severity).toBe('insufficient');
    expect(r.freeGB).toBe(0);
  });

  test('canDownloadModel mirrors fits across the ladder', () => {
    expect(canDownloadModel({ sizeGB: 4.4, freeGB: 100 })).toBe(true); // ok
    expect(canDownloadModel({ sizeGB: 4.4, freeGB: 5 })).toBe(true); // tight
    expect(canDownloadModel({ sizeGB: 14, freeGB: 3 })).toBe(false); // insufficient
    expect(canDownloadModel({ sizeGB: 4.4, freeGB: null })).toBe(true); // unknown
  });

  test('end-to-end from bytes via bytesToGb', () => {
    const freeGB = bytesToGb(3_000_000_000); // 3 GB
    const r = assessModelDownloadFit({ sizeGB: 4.4, freeGB });
    expect(r.severity).toBe('insufficient');
  });
});

// Simulates the FirstRunModal auto-pull guard: given free disk space and the
// recommended model set, which models get pulled vs. skipped. Mirrors the
// `if (!fit.fits) continue;` logic wired into checkModelsAndPull.
describe('FirstRunModal auto-pull disk guard (decision simulation)', () => {
  type M = { name: string; sizeGB: number };
  const decide = (models: M[], freeGB: number | null) =>
    models.filter(m => assessModelDownloadFit({ sizeGB: m.sizeGB, freeGB }).fits).map(m => m.name);

  const set14b: M[] = [
    { name: 'qwen2.5:14b', sizeGB: 8.2 },
    { name: 'nomic-embed-text', sizeGB: 0.3 },
  ];

  test('plenty of space → pulls every model', () => {
    expect(decide(set14b, 200)).toEqual(['qwen2.5:14b', 'nomic-embed-text']);
  });

  test('only room for the embedding model → big chat model is skipped', () => {
    // 5 GB free: 8.2 GB chat model is insufficient (skipped), 0.3 GB embed fits.
    expect(decide(set14b, 5)).toEqual(['nomic-embed-text']);
  });

  test('tight space still pulls (fails toward attempting)', () => {
    // 9 GB free vs 8.2 GB model → tight, but tight.fits === true.
    const fit = assessModelDownloadFit({ sizeGB: 8.2, freeGB: 9 });
    expect(fit.severity).toBe('tight');
    expect(decide(set14b, 9)).toEqual(['qwen2.5:14b', 'nomic-embed-text']);
  });

  test('unknown free disk fails open → nothing skipped', () => {
    expect(decide(set14b, null)).toEqual(['qwen2.5:14b', 'nomic-embed-text']);
  });

  test('insufficient chat fit carries a user-facing message', () => {
    const chatFit = assessModelDownloadFit({ sizeGB: 8.2, freeGB: 5 });
    expect(chatFit.severity).toBe('insufficient');
    expect(chatFit.message).toMatch(/Not enough disk space/);
  });
});
