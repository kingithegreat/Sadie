import {
  normalizeModelId,
  CURATED_MODEL_SIZES_GB,
  sizeForModelId,
  assessPullById,
} from '../model-pull-guard';
import { DEFAULT_HEADROOM_GB } from '../model-download-fit';
import { RECOMMENDED_MODELS } from '../../renderer/components/ModelSelector';

describe('normalizeModelId', () => {
  test('lowercases, drops :latest, strips punctuation', () => {
    expect(normalizeModelId('Mistral:latest')).toBe('mistral');
    expect(normalizeModelId('qwen2.5-coder:7b')).toBe('qwen25coder7b');
    expect(normalizeModelId('phi4-mini')).toBe('phi4mini');
    expect(normalizeModelId('')).toBe('');
  });

  test('id variants resolve to the same catalog entry', () => {
    expect(sizeForModelId('mistral')).toBe(sizeForModelId('mistral:latest'));
    expect(sizeForModelId('MISTRAL')).toBe(4.4);
  });
});

describe('sizeForModelId', () => {
  test('returns catalog size for known models', () => {
    expect(sizeForModelId('qwen2.5:7b')).toBe(4.4);
    expect(sizeForModelId('llama3.1:70b')).toBe(43);
  });

  test('returns null for unknown / custom models', () => {
    expect(sizeForModelId('my-custom-finetune:q4')).toBeNull();
    expect(sizeForModelId('')).toBeNull();
  });
});

describe('assessPullById', () => {
  test('blocks a known model that cannot fit', () => {
    const fit = assessPullById('llama3.1:70b', 10);
    expect(fit.severity).toBe('insufficient');
    expect(fit.fits).toBe(false);
    expect(fit.message).toMatch(/Not enough disk space/);
  });

  test('warns (but allows) a tight fit', () => {
    // 4.4 GB model, 5 GB free → fits but inside the headroom
    const fit = assessPullById('mistral', 5);
    expect(fit.severity).toBe('tight');
    expect(fit.fits).toBe(true);
  });

  test('ok when there is comfortable room', () => {
    const fit = assessPullById('phi4-mini', 100);
    expect(fit.severity).toBe('ok');
    expect(fit.fits).toBe(true);
    expect(fit.headroomGB).toBe(DEFAULT_HEADROOM_GB);
  });

  test('fails open on unknown model id (never blocks)', () => {
    const fit = assessPullById('my-custom-finetune:q4', 1);
    expect(fit.severity).toBe('unknown');
    expect(fit.fits).toBe(true);
  });

  test('fails open on unknown free-space reading (never blocks)', () => {
    const fit = assessPullById('llama3.1:70b', null);
    expect(fit.severity).toBe('unknown');
    expect(fit.fits).toBe(true);
  });

  test('explicit sizeGB overrides the catalog lookup', () => {
    // Catalog says 4.4 GB (would block at 3 GB free); explicit 0.5 GB fits.
    const fit = assessPullById('mistral', 3, 0.5);
    expect(fit.severity).toBe('ok');
    // And an explicit bigger size blocks even for an unknown id.
    const blocked = assessPullById('some-unknown-model', 3, 40);
    expect(blocked.severity).toBe('insufficient');
  });
});

describe('catalog consistency with ModelSelector', () => {
  test('every RECOMMENDED_MODELS entry with a size matches the shared catalog', () => {
    for (const m of RECOMMENDED_MODELS) {
      if (typeof m.sizeGB === 'number') {
        expect({ id: m.id, sizeGB: sizeForModelId(m.id) }).toEqual({ id: m.id, sizeGB: m.sizeGB });
      }
    }
  });

  test('catalog has no orphan entries missing from RECOMMENDED_MODELS', () => {
    const recIds = new Set(RECOMMENDED_MODELS.map(m => normalizeModelId(m.id)));
    for (const id of Object.keys(CURATED_MODEL_SIZES_GB)) {
      expect({ id, known: recIds.has(normalizeModelId(id)) }).toEqual({ id, known: true });
    }
  });
});
