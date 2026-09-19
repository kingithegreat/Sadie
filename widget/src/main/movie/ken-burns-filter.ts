/**
 * Shared camera-motion filter construction for Storyboard and job renders.
 *
 * zoompan rounds crop coordinates to whole input pixels.  Work at 2x input
 * resolution and derive positions from `on` so slow moves do not accumulate
 * alternating rounding errors.
 */

export const MOTION_SUPERSAMPLE = 2;

export interface KenBurnsFilterOptions {
  width: number;
  height: number;
  /** Existing aspect-ratio/crop filters, applied before supersampling. */
  baseFilters?: string;
}

/** Build the supersampled zoompan filter used by every still-image renderer. */
export function buildSupersampledKenBurnsFilter(
  movement: string,
  durationSec: number,
  fps: number,
  options: KenBurnsFilterOptions,
): string {
  const frames = Math.max(1, Math.round(durationSec * fps));
  const k = MOTION_SUPERSAMPLE;
  const base = options.baseFilters || '';
  const framed = (filter: string) => [
    base,
    `scale=iw*${k}:ih*${k}:flags=bicubic`,
    filter,
  ].filter(Boolean).join(',');
  const move = movement.toLowerCase().trim();
  /** Pan speeds are snapped to whole supersampled pixels. */
  const step = (outputPixelsPerFrame: number) => Math.max(1, Math.round(outputPixelsPerFrame * k));

  if (move === 'slow push in') {
    return framed(`zoompan=z='min(1+0.0015*on,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${options.width}x${options.height}:fps=${fps}`);
  }
  if (move === 'pan right') {
    return framed(`zoompan=z='1.15':x='min((iw-iw/zoom)/2+on*${step(1.5)},iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${options.width}x${options.height}:fps=${fps}`);
  }
  if (move === 'tilt up') {
    return framed(`zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='max((ih-ih/zoom)/2-on*${step(1.5)},0)':d=${frames}:s=${options.width}x${options.height}:fps=${fps}`);
  }
  if (move === 'tracking') {
    return framed(`zoompan=z='min(1+0.001*on,1.18)':x='min((iw-iw/zoom)/2+on*${step(1)},iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${options.width}x${options.height}:fps=${fps}`);
  }
  return base || `scale=${options.width}:${options.height}:force_original_aspect_ratio=increase,crop=${options.width}:${options.height}`;
}
