import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LIGHTING_PRESETS,
  buildContactShadowStyle,
  buildCssFilter,
  deleteSetting,
  getSetting,
  listSeriesSettings,
  resolveSettingDir,
  saveSetting,
  type SettingLighting,
} from '../series-settings';

describe('Series Settings Catalog & Zero-VRAM Compositing Profiles', () => {
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-series-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  describe('CSS Filter & Lighting Presets', () => {
    it('produces valid CSS filter for torchlight preset with warm amber tint', () => {
      const filter = buildCssFilter(LIGHTING_PRESETS.torchlight);
      expect(filter).toContain('brightness(1.08)');
      expect(filter).toContain('sepia(0.22)');
      expect(filter).toContain('hue-rotate(-8deg)');
    });

    it('produces valid CSS filter for moonlight preset with cool blue tone', () => {
      const filter = buildCssFilter(LIGHTING_PRESETS.moonlight);
      expect(filter).toContain('brightness(0.88)');
      expect(filter).toContain('hue-rotate(190deg)');
    });

    it('handles custom lighting overrides', () => {
      const custom: SettingLighting = {
        preset: 'custom',
        brightness: 1.2,
        contrast: 1.1,
        sepia: 0.1,
        hueRotateDeg: 15,
        saturate: 1.05,
        shadowColor: 'rgba(0, 0, 0, 0.4)',
        shadowBlurPx: 8,
        shadowOpacity: 0.3,
        shadowScaleX: 0.8,
        shadowScaleY: 0.2,
      };
      const filter = buildCssFilter(custom);
      expect(filter).toBe('brightness(1.2) contrast(1.1) sepia(0.1) hue-rotate(15deg) saturate(1.05)');
    });
  });

  describe('Contact Shadow Style Construction', () => {
    it('generates grounded absolute positioning and blur for Remotion character base', () => {
      const shadowStyle = buildContactShadowStyle(LIGHTING_PRESETS.torchlight, 50, 70, 1.0, 200);

      expect(shadowStyle.position).toBe('absolute');
      expect(shadowStyle.left).toBe('50%');
      expect(shadowStyle.top).toBe('72%'); // 70 + offsetYPercent(2.0)
      expect(shadowStyle.borderRadius).toBe('50%');
      expect(shadowStyle.filter).toBe('blur(12px)');
      expect(shadowStyle.opacity).toBe(0.4);
      expect(shadowStyle.zIndex).toBe(10);
      expect(shadowStyle.transform).toBe('translate(-50%, -50%)');
    });

    it('scales shadow dimensions proportionally to character scale', () => {
      const normal = buildContactShadowStyle(LIGHTING_PRESETS.daylight, 30, 40, 1.0, 200);
      const scaled = buildContactShadowStyle(LIGHTING_PRESETS.daylight, 30, 40, 0.5, 200);

      const normalW = parseInt(normal.width, 10);
      const scaledW = parseInt(scaled.width, 10);
      expect(scaledW).toBeCloseTo(normalW / 2, 0);
    });
  });

  describe('Settings Storage CRUD', () => {
    it('normalizes series and setting IDs into clean directory paths', () => {
      const dir = resolveSettingDir('Ancient Egypt', 'Pharaoh Court #1', tempBaseDir);
      expect(dir).toBe(path.join(tempBaseDir, 'ancient_egypt', 'settings', 'pharaoh_court__1'));
    });

    it('saves a complete setting bundle with bg, fg, and lighting metadata', async () => {
      const bgBuffer = Buffer.from('FAKE_BG_PNG_DATA');
      const fgBuffer = Buffer.from('FAKE_FG_PNG_DATA');

      const bundle = await saveSetting(
        'egypt',
        {
          id: 'imhotep_workshop',
          name: "Imhotep's Workshop",
          description: 'Stone drafting room with architectural papyrus rolls',
          lighting: LIGHTING_PRESETS.torchlight,
          cameraSetups: ['wide', 'medium', 'close'],
        },
        bgBuffer,
        fgBuffer,
        undefined,
        tempBaseDir
      );

      expect(bundle.manifest.id).toBe('imhotep_workshop');
      expect(bundle.manifest.hasForeground).toBe(true);
      expect(bundle.manifest.lighting.preset).toBe('torchlight');
      expect(fs.existsSync(bundle.bgPath)).toBe(true);
      expect(fs.existsSync(bundle.fgPath!)).toBe(true);

      const loaded = await getSetting('egypt', 'imhotep_workshop', tempBaseDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.manifest.name).toBe("Imhotep's Workshop");
      expect(loaded!.manifest.cameraSetups).toEqual(['wide', 'medium', 'close']);
      expect(loaded!.fgPath).toBeDefined();
    });

    it('lists all registered settings for a series', async () => {
      const bg = Buffer.from('FAKE_BG');
      await saveSetting('rome', { id: 'colosseum_floor', name: 'Colosseum Arena' }, bg, undefined, undefined, tempBaseDir);
      await saveSetting('rome', { id: 'senate_hall', name: 'Roman Senate' }, bg, undefined, undefined, tempBaseDir);

      const list = await listSeriesSettings('rome', tempBaseDir);
      expect(list.length).toBe(2);
      const ids = list.map((s) => s.id).sort();
      expect(ids).toEqual(['colosseum_floor', 'senate_hall']);
    });

    it('deletes a setting and all associated image assets', async () => {
      const bg = Buffer.from('BG');
      await saveSetting('greece', { id: 'agora', name: 'Athens Agora' }, bg, undefined, undefined, tempBaseDir);

      const existsBefore = await getSetting('greece', 'agora', tempBaseDir);
      expect(existsBefore).not.toBeNull();

      const deleted = await deleteSetting('greece', 'agora', tempBaseDir);
      expect(deleted).toBe(true);

      const existsAfter = await getSetting('greece', 'agora', tempBaseDir);
      expect(existsAfter).toBeNull();
    });
  });
});
