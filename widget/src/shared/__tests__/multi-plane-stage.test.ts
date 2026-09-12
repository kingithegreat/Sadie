import {
  calculateParallaxTransforms,
  buildCssFilter,
  buildContactShadowStyle,
  FRAMING_BASE_SCALES,
} from '../multi-plane-stage';
import { LIGHTING_PRESETS } from '../../main/series-settings';

describe('Shared Multi-Plane Parallax & Zero-VRAM Compositing', () => {
  describe('calculateParallaxTransforms', () => {
    it('creates optical depth parallax on pan_left with foreground moving fastest', () => {
      const atStart = calculateParallaxTransforms(0.0, 'pan_left', 'medium');
      const atEnd = calculateParallaxTransforms(1.0, 'pan_left', 'medium');

      const bgDelta = Math.abs(atEnd.background.translateX - atStart.background.translateX);
      const charDelta = Math.abs(atEnd.character.translateX - atStart.character.translateX);
      const fgDelta = Math.abs(atEnd.foreground.translateX - atStart.foreground.translateX);

      // Verify strict 3-tier optical depth hierarchy:
      // Foreground moves more than Character, which moves more than Background
      expect(fgDelta).toBeGreaterThan(charDelta);
      expect(charDelta).toBeGreaterThan(bgDelta);

      expect(bgDelta).toBeCloseTo(50, 1);
      expect(charDelta).toBeCloseTo(50 * 1.15, 1);
      expect(fgDelta).toBeCloseTo(50 * 1.35, 1);
    });

    it('creates optical depth parallax on zoom_in with foreground expanding fastest', () => {
      const atStart = calculateParallaxTransforms(0.0, 'zoom_in', 'wide');
      const atEnd = calculateParallaxTransforms(1.0, 'zoom_in', 'wide');

      const bgScaleDelta = atEnd.background.scale - atStart.background.scale;
      const charScaleDelta = atEnd.character.scale - atStart.character.scale;
      const fgScaleDelta = atEnd.foreground.scale - atStart.foreground.scale;

      expect(fgScaleDelta).toBeGreaterThan(charScaleDelta);
      expect(charScaleDelta).toBeGreaterThan(bgScaleDelta);

      expect(bgScaleDelta).toBeCloseTo(0.06, 2);
      expect(charScaleDelta).toBeCloseTo(0.08, 2);
      expect(fgScaleDelta).toBeCloseTo(0.12, 2);
    });

    it('maintains static framing with zero translation on static camera motion', () => {
      const transforms = calculateParallaxTransforms(0.5, 'static', 'close');
      expect(transforms.background.translateX).toBe(0);
      expect(transforms.background.translateY).toBe(0);
      expect(transforms.character.translateX).toBe(0);
      expect(transforms.foreground.translateX).toBe(0);
      expect(transforms.background.scale).toBe(FRAMING_BASE_SCALES.close);
    });
  });

  describe('buildContactShadowStyle', () => {
    it('returns grounded CSS properties anchored to character position', () => {
      const style = buildContactShadowStyle(LIGHTING_PRESETS.torchlight, 50, 65, 1.0, 200);

      expect(style.position).toBe('absolute');
      expect(style.left).toBe('50%');
      expect(style.top).toBe('67%'); // 65 + 2.0 offset
      expect(style.borderRadius).toBe('50%');
      expect(style.filter).toBe('blur(12px)');
      expect(style.opacity).toBe(0.4);
      expect(style.zIndex).toBe(10);
      expect(style.pointerEvents).toBe('none');
    });
  });

  describe('buildCssFilter', () => {
    it('generates standard CSS filter for torchlight lighting preset', () => {
      const filter = buildCssFilter(LIGHTING_PRESETS.torchlight);
      expect(filter).toContain('brightness(1.08)');
      expect(filter).toContain('contrast(1.1)');
      expect(filter).toContain('sepia(0.22)');
      expect(filter).toContain('hue-rotate(-8deg)');
      expect(filter).toContain('saturate(1.15)');
    });
  });
});
