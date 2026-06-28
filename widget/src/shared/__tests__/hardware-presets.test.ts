/**
 * hardware-presets.test.ts
 *
 * Unit tests for widget/src/shared/hardware-presets.ts
 *
 * Covers:
 *  - profileForVram threshold + boundary logic
 *  - fitsInVram headroom logic
 *  - recommendModelsForVram / recommendModelsForProfile per tier
 *  - unknown-hardware safe-default behaviour (no regression vs old hard-coded default)
 *  - internal consistency: recommended models actually fit their tier's VRAM
 */

import {
  profileForVram,
  fitsInVram,
  recommendModelsForVram,
  recommendModelsForProfile,
  recommendedModelIdsForVram,
  HARDWARE_PRESETS,
  PROFILE_8GB_MIN,
  PROFILE_16GB_MIN,
  HardwareProfile,
} from '../hardware-presets';

describe('profileForVram', () => {
  it('returns null when VRAM is unknown', () => {
    expect(profileForVram(null)).toBeNull();
    expect(profileForVram(undefined as any)).toBeNull();
    expect(profileForVram(NaN)).toBeNull();
  });

  it('classifies low VRAM as 4gb', () => {
    expect(profileForVram(2)).toBe('4gb');
    expect(profileForVram(4)).toBe('4gb');
    expect(profileForVram(PROFILE_8GB_MIN - 0.1)).toBe('4gb');
  });

  it('classifies mid VRAM as 8gb', () => {
    expect(profileForVram(PROFILE_8GB_MIN)).toBe('8gb');
    expect(profileForVram(8)).toBe('8gb');
    expect(profileForVram(PROFILE_16GB_MIN - 0.1)).toBe('8gb');
  });

  it('classifies high VRAM as 16gb+', () => {
    expect(profileForVram(PROFILE_16GB_MIN)).toBe('16gb+');
    expect(profileForVram(16)).toBe('16gb+');
    expect(profileForVram(24)).toBe('16gb+');
  });
});

describe('fitsInVram', () => {
  it('treats unknown VRAM as always fitting', () => {
    expect(fitsInVram(43, null)).toBe(true);
    expect(fitsInVram(43, NaN)).toBe(true);
  });

  it('applies the default 0.8 headroom', () => {
    // 8 GB * 0.8 = 6.4 GB usable
    expect(fitsInVram(4.4, 8)).toBe(true);
    expect(fitsInVram(6.4, 8)).toBe(true);
    expect(fitsInVram(7.0, 8)).toBe(false);
  });

  it('respects a custom headroom', () => {
    expect(fitsInVram(8, 8, 1.0)).toBe(true);
    expect(fitsInVram(8, 8, 0.9)).toBe(false);
  });
});

describe('recommendModelsForVram', () => {
  it('recommends lightweight 3B models for 4gb GPUs', () => {
    const rec = recommendModelsForVram(4);
    expect(rec.profile).toBe('4gb');
    expect(rec.vramGB).toBe(4);
    expect(rec.chat.id).toBe('qwen2.5:3b');
    expect(rec.fallback.id).toBe('llama3.2:3b');
  });

  it('recommends 7B models for 8gb GPUs', () => {
    const rec = recommendModelsForVram(8);
    expect(rec.profile).toBe('8gb');
    expect(rec.chat.id).toBe('qwen2.5:7b');
    expect(rec.coder.id).toBe('qwen2.5-coder:7b');
  });

  it('recommends 14B models for 16gb+ GPUs', () => {
    const rec = recommendModelsForVram(16);
    expect(rec.profile).toBe('16gb+');
    expect(rec.chat.id).toBe('qwen2.5:14b');
    expect(rec.coder.id).toBe('qwen2.5-coder:14b');
  });

  it('falls back to the safe balanced default when VRAM is unknown', () => {
    const rec = recommendModelsForVram(null);
    expect(rec.profile).toBe('unknown');
    expect(rec.vramGB).toBeNull();
    // Must match the previous hard-coded first-run default (no regression)
    expect(rec.chat.id).toBe('qwen2.5:7b');
  });

  it('preserves the raw VRAM reading on the recommendation', () => {
    expect(recommendModelsForVram(11.5).vramGB).toBe(11.5);
  });

  it('always returns a non-empty reason', () => {
    for (const v of [null, 2, 8, 24]) {
      expect(recommendModelsForVram(v as number | null).reason.length).toBeGreaterThan(0);
    }
  });
});

describe('recommendModelsForProfile', () => {
  it('returns the matching preset for each profile', () => {
    (['4gb', '8gb', '16gb+'] as HardwareProfile[]).forEach((p) => {
      expect(recommendModelsForProfile(p).profile).toBe(p);
    });
  });

  it('returns the safe default for a null profile', () => {
    expect(recommendModelsForProfile(null).profile).toBe('unknown');
    expect(recommendModelsForProfile(null).chat.id).toBe('qwen2.5:7b');
  });
});

describe('preset internal consistency', () => {
  const TIER_VRAM: Record<HardwareProfile, number> = { '4gb': 4, '8gb': 8, '16gb+': 16 };

  it('every recommended chat & coder model fits its tier VRAM with headroom', () => {
    (Object.keys(HARDWARE_PRESETS) as HardwareProfile[]).forEach((profile) => {
      const preset = HARDWARE_PRESETS[profile];
      const vram = TIER_VRAM[profile];
      expect(fitsInVram(preset.chat.sizeGB, vram)).toBe(true);
      expect(fitsInVram(preset.coder.sizeGB, vram)).toBe(true);
      expect(fitsInVram(preset.fallback.sizeGB, vram)).toBe(true);
    });
  });

  it('every preset model has a positive size and non-empty id/label', () => {
    (Object.keys(HARDWARE_PRESETS) as HardwareProfile[]).forEach((profile) => {
      const preset = HARDWARE_PRESETS[profile];
      [preset.chat, preset.coder, preset.fallback].forEach((m) => {
        expect(m.sizeGB).toBeGreaterThan(0);
        expect(m.id.length).toBeGreaterThan(0);
        expect(m.label.length).toBeGreaterThan(0);
      });
    });
  });
});


describe('recommendedModelIdsForVram', () => {
  it('returns the 8gb tier model ids for a 7-8GB GPU', () => {
    const ids = recommendedModelIdsForVram(8);
    expect(ids).toContain('qwen2.5:7b');
    expect(ids).toContain('qwen2.5-coder:7b');
    expect(ids).toContain('qwen2.5:3b');
  });

  it('returns lightweight ids for a 4gb GPU and de-duplicates', () => {
    const ids = recommendedModelIdsForVram(4);
    expect(ids).toContain('qwen2.5:3b');
    expect(ids).toContain('llama3.2:3b');
    expect(ids.length).toBe(new Set(ids).size); // no duplicates (chat===coder===qwen2.5:3b)
  });

  it('returns 14b tier ids for a 16gb+ GPU', () => {
    const ids = recommendedModelIdsForVram(16);
    expect(ids).toContain('qwen2.5:14b');
    expect(ids).toContain('qwen2.5-coder:14b');
  });

  it('returns the safe balanced default set when VRAM is unknown', () => {
    const ids = recommendedModelIdsForVram(null);
    expect(ids).toContain('qwen2.5:7b');
    expect(ids.length).toBeGreaterThan(0);
  });

  it('never returns duplicate ids for any VRAM value', () => {
    for (const v of [null, 2, 4, 6, 8, 12, 16, 24]) {
      const ids = recommendedModelIdsForVram(v as number | null);
      expect(ids.length).toBe(new Set(ids).size);
    }
  });
});
