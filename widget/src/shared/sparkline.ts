/**
 * sparkline.ts — pure, dependency-free geometry for the tiny perf trend
 * sparklines shown in the Settings → Diagnostics & Performance section.
 *
 * This module contains ZERO React/DOM/Electron references so it can be unit
 * tested in plain node. The renderer turns the returned geometry into an inline
 * <svg>. Keeping the math here means the trickier parts (scaling, the flat-line
 * degenerate cases, point placement) are covered by fast logic tests instead of
 * relying on a jsdom render to catch regressions.
 */

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  /** Computed point coordinates in SVG user units (left->right, chronological). */
  points: SparklinePoint[];
  /** Polyline path string for the trend line ("M x y L x y ..."), or '' if empty. */
  linePath: string;
  /** Closed path filling the area under the line, or '' if empty. */
  areaPath: string;
  width: number;
  height: number;
  /** Min value across the series (0 when empty). */
  min: number;
  /** Max value across the series (0 when empty). */
  max: number;
  /** Most recent (right-most) value, or null when empty. */
  last: number | null;
  /** Whether there is at least one finite sample to draw. */
  hasData: boolean;
}

export interface SparklineOptions {
  width?: number;
  height?: number;
  /** Inner padding (px) kept clear on every edge so the stroke isn't clipped. */
  padding?: number;
}

function round(n: number): number {
  // Keep paths compact and deterministic for snapshot-style assertions.
  return Math.round(n * 100) / 100;
}

/**
 * Build sparkline geometry from a chronological list of numbers.
 *
 * Degenerate cases are handled explicitly:
 *   - empty / all-non-finite input  -> hasData=false, empty paths.
 *   - a single sample               -> one centred point + a short flat line.
 *   - all-equal samples             -> a flat line centred vertically.
 *
 * The series is drawn left->right with the most recent sample on the right,
 * and y is inverted (larger value = higher on screen = smaller y), which is
 * the conventional sparkline orientation.
 */
export function buildSparkline(
  values: number[],
  options: SparklineOptions = {},
): SparklineGeometry {
  const width = options.width && options.width > 0 ? options.width : 120;
  const height = options.height && options.height > 0 ? options.height : 28;
  const padding = typeof options.padding === 'number' && options.padding >= 0 ? options.padding : 2;

  const clean = (Array.isArray(values) ? values : []).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );

  if (clean.length === 0) {
    return {
      points: [],
      linePath: '',
      areaPath: '',
      width,
      height,
      min: 0,
      max: 0,
      last: null,
      hasData: false,
    };
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const last = clean[clean.length - 1]!;

  const innerW = Math.max(0, width - padding * 2);
  const innerH = Math.max(0, height - padding * 2);
  const midY = round(padding + innerH / 2);

  // x positions: evenly spaced; a single point sits centred.
  const xFor = (i: number): number => {
    if (clean.length === 1) return round(padding + innerW / 2);
    return round(padding + (innerW * i) / (clean.length - 1));
  };

  // y positions: invert so higher values sit nearer the top. When every value
  // is equal (range 0) we draw a flat centred line to avoid divide-by-zero.
  const range = max - min;
  const yFor = (v: number): number => {
    if (range === 0) return midY;
    const t = (v - min) / range; // 0..1
    return round(padding + innerH * (1 - t));
  };

  const points: SparklinePoint[] = clean.map((v, i) => ({ x: xFor(i), y: yFor(v) }));

  // A lone point would produce a zero-length line, so extend it horizontally
  // across the inner width to read as a flat trend.
  let linePoints = points;
  if (points.length === 1) {
    const p = points[0]!;
    linePoints = [
      { x: round(padding), y: p.y },
      { x: round(width - padding), y: p.y },
    ];
  }

  const linePath = linePoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const baseline = round(height - padding);
  const firstX = linePoints[0]!.x;
  const lastX = linePoints[linePoints.length - 1]!.x;
  const areaPath = `${linePath} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;

  return {
    points,
    linePath,
    areaPath,
    width,
    height,
    min,
    max,
    last,
    hasData: true,
  };
}

export default { buildSparkline };
