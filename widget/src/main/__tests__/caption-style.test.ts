jest.mock('../config-manager', () => ({ getSettings: () => ({}) }));

import { DEFAULT_CAPTION_STYLE, isCustomCaptionStyle, resolveCaptionStyle } from '../../shared/caption-style';
import { defaultSubtitleStyle, subtitleStyleFor, toAssUnits } from '../media-render';
import { storyboardSourceRevision } from '../movie/storyboard-export-state';

describe('caption style settings', () => {
  test('missing or partial settings fill in the default look', () => {
    expect(resolveCaptionStyle(undefined)).toEqual(DEFAULT_CAPTION_STYLE);
    expect(resolveCaptionStyle({ position: 'top' })).toEqual({ ...DEFAULT_CAPTION_STYLE, position: 'top' });
    expect(resolveCaptionStyle({ color: '#FFD400' }).color).toBe('#ffd400');
  });

  test.each([
    [{ font: 'Comic Sans MS' }, /caption font/],
    [{ size: 'huge' }, /caption size/],
    [{ position: 'left' }, /caption position/],
    [{ color: 'yellow' }, /colour like #ffffff/],
    [{ background: 'glow' }, /caption background/],
    ['bold', /valid caption style/],
  ])('refuses %p instead of rendering something else', (value, message) => {
    expect(() => resolveCaptionStyle(value)).toThrow(message);
  });

  test('only a style that looks different counts as custom', () => {
    expect(isCustomCaptionStyle(undefined)).toBe(false);
    expect(isCustomCaptionStyle({ ...DEFAULT_CAPTION_STYLE })).toBe(false);
    expect(isCustomCaptionStyle({ size: 'large' })).toBe(true);
  });
});

describe('caption style reaches the FFmpeg caption filter', () => {
  test('the default is exactly the style every export used before styles existed', () => {
    for (const [shape, h, font, outline, margin] of [['9:16', 1920, 110, 8, 280], ['16:9', 1080, 56, 5, 70]] as const) {
      expect(defaultSubtitleStyle(shape)).toBe([
        'FontName=Arial', `FontSize=${toAssUnits(font, h)}`, 'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000',
        'BorderStyle=1', `Outline=${toAssUnits(outline, h)}`, 'Shadow=0', 'Alignment=2', `MarginV=${toAssUnits(margin, h)}`, 'Bold=1',
      ].join(','));
    }
  });

  test('position uses the legacy SSA numbers ffmpeg reads (measured on rendered frames)', () => {
    expect(subtitleStyleFor('9:16', { position: 'bottom' })).toContain('Alignment=2');
    expect(subtitleStyleFor('9:16', { position: 'top' })).toContain('Alignment=6');
    expect(subtitleStyleFor('9:16', { position: 'middle' })).toContain('Alignment=10');
  });

  test('font, colour, size and box all change the style string', () => {
    const style = subtitleStyleFor('16:9', { font: 'Impact', color: '#ffd400', size: 'large', background: 'box' });
    expect(style).toContain('FontName=Impact');
    expect(style).toContain('PrimaryColour=&H0000D4FF');
    expect(style).toContain('BorderStyle=3');
    expect(style).toContain('OutlineColour=&H40000000');
    const size = (s: string) => Number(/FontSize=(\d+)/.exec(s)![1]);
    expect(size(style)).toBeGreaterThan(size(subtitleStyleFor('16:9')));
    expect(size(subtitleStyleFor('16:9', { size: 'small' }))).toBeLessThan(size(subtitleStyleFor('16:9')));
  });
});

describe('storyboard export freshness', () => {
  const scenes = [{ sceneId: 'scene_01', shots: [] }] as any;
  const meta = { outputSpec: undefined, burnSubtitles: true };

  test('saving the default style does not make earlier exports look stale', async () => {
    const before = await storyboardSourceRevision(scenes, meta);
    expect(await storyboardSourceRevision(scenes, { ...meta, captionStyle: { ...DEFAULT_CAPTION_STYLE } })).toBe(before);
  });

  test('a different caption style marks the export out of date', async () => {
    const before = await storyboardSourceRevision(scenes, meta);
    expect(await storyboardSourceRevision(scenes, { ...meta, captionStyle: { position: 'top' } })).not.toBe(before);
  });
});
