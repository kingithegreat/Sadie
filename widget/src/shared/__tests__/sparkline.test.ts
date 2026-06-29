/**
 * sparkline.test.ts — pure geometry tests for src/shared/sparkline.ts
 * No DOM/Electron; runs in plain node.
 */
import { buildSparkline } from '../sparkline';

describe('buildSparkline — degenerate inputs', () => {
  test('empty array → no data, empty paths', () => {
    const g = buildSparkline([]);
    expect(g.hasData).toBe(false);
    expect(g.points).toEqual([]);
    expect(g.linePath).toBe('');
    expect(g.areaPath).toBe('');
    expect(g.last).toBeNull();
    expect(g.min).toBe(0);
    expect(g.max).toBe(0);
  });

  test('non-array / junk values are filtered out', () => {
    // @ts-expect-error intentionally passing junk
    const g = buildSparkline([NaN, Infinity, undefined, null, 'x']);
    expect(g.hasData).toBe(false);
    expect(g.points).toEqual([]);
  });

  test('mixed finite + junk keeps only finite samples', () => {
    // @ts-expect-error intentionally passing junk
    const g = buildSparkline([100, NaN, 200, null, 300]);
    expect(g.hasData).toBe(true);
    expect(g.points).toHaveLength(3);
    expect(g.min).toBe(100);
    expect(g.max).toBe(300);
    expect(g.last).toBe(300);
  });

  test('single sample → centred point + flat full-width line', () => {
    const g = buildSparkline([500], { width: 120, height: 28, padding: 2 });
    expect(g.hasData).toBe(true);
    expect(g.points).toHaveLength(1);
    expect(g.last).toBe(500);
    // line should span from left padding to right padding (flat)
    expect(g.linePath.startsWith('M 2 ')).toBe(true);
    expect(g.linePath).toContain('L 118 ');
    // both y-coords equal → flat
    const ys = g.linePath.match(/[ML] \d+(?:\.\d+)? (\d+(?:\.\d+)?)/g)!;
    expect(ys.length).toBe(2);
  });

  test('all-equal samples → flat centred line (no divide-by-zero)', () => {
    const g = buildSparkline([300, 300, 300], { width: 100, height: 20, padding: 0 });
    expect(g.hasData).toBe(true);
    const midY = 10; // height/2 with padding 0
    expect(g.points.every(p => p.y === midY)).toBe(true);
  });
});

describe('buildSparkline — scaling & orientation', () => {
  test('higher values sit nearer the top (smaller y)', () => {
    const g = buildSparkline([100, 200], { width: 100, height: 20, padding: 0 });
    // 200 (max) maps to y=0 (top); 100 (min) maps to y=20 (bottom)
    expect(g.points[0].y).toBeGreaterThan(g.points[1].y);
    expect(g.points[1].y).toBe(0);
    expect(g.points[0].y).toBe(20);
  });

  test('x positions are evenly spaced left→right', () => {
    const g = buildSparkline([1, 2, 3], { width: 100, height: 20, padding: 0 });
    expect(g.points.map(p => p.x)).toEqual([0, 50, 100]);
  });

  test('last value is the right-most/most-recent sample', () => {
    const g = buildSparkline([10, 50, 30, 90]);
    expect(g.last).toBe(90);
    expect(g.points[g.points.length - 1].x).toBeGreaterThan(g.points[0].x);
  });

  test('areaPath closes back to the baseline', () => {
    const g = buildSparkline([1, 2, 3], { width: 100, height: 20, padding: 0 });
    expect(g.areaPath.endsWith('Z')).toBe(true);
    // baseline = height - padding = 20
    expect(g.areaPath).toContain('L 100 20');
    expect(g.areaPath).toContain('L 0 20');
  });

  test('respects custom dimensions and defaults', () => {
    const def = buildSparkline([1, 2]);
    expect(def.width).toBe(120);
    expect(def.height).toBe(28);
    const custom = buildSparkline([1, 2], { width: 200, height: 40 });
    expect(custom.width).toBe(200);
    expect(custom.height).toBe(40);
  });

  test('invalid dimension options fall back to defaults', () => {
    const g = buildSparkline([1, 2], { width: -5, height: 0 });
    expect(g.width).toBe(120);
    expect(g.height).toBe(28);
  });
});
