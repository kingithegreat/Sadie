/**
 * multi-plane-stage.ts — Shared Zero-VRAM 2.5D Multi-Plane Staging Logic.
 *
 * Implements pure mathematical parallax, contact shadow geometry, and CSS filter
 * generation for Remotion and HomeBot's review players. Runs 100% on CPU with zero GPU cost.
 */

import type React from 'react';

export type CameraMotion = 'pan_left' | 'pan_right' | 'zoom_in' | 'zoom_out' | 'static';
export type CharacterDepthStaging = 'midground_behind_fg' | 'foreground_in_front_of_fg';
export type CameraFraming = 'wide' | 'medium' | 'close' | 'two' | 'ots';

export interface SettingLighting {
  preset: 'torchlight' | 'daylight' | 'moonlight' | 'studio_warm' | 'scifi_cool' | 'custom';
  brightness: number;    // e.g. 1.08
  contrast: number;      // e.g. 1.05
  sepia: number;         // e.g. 0.15
  hueRotateDeg: number;  // e.g. -5
  saturate: number;      // e.g. 1.02
  shadowColor: string;   // e.g. "rgba(18, 14, 20, 0.45)"
  shadowBlurPx: number;  // e.g. 10
  shadowOpacity: number; // e.g. 0.35
  shadowScaleX: number;  // e.g. 0.85
  shadowScaleY: number;  // e.g. 0.25
  shadowOffsetYPercent?: number; // e.g. 2.0
}

export interface ParallaxOffsets {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface LayerTransforms {
  background: ParallaxOffsets;
  character: ParallaxOffsets;
  foreground: ParallaxOffsets;
}

/**
 * Base framing scale targets for standard camera shots.
 */
export const FRAMING_BASE_SCALES: Record<CameraFraming, number> = {
  wide: 1.05,
  medium: 1.25,
  two: 1.20,
  close: 1.50,
  ots: 1.35,
};

/**
 * Calculates zero-VRAM Ken Burns 2.5D optical parallax transforms for 3 depth tiers:
 *   - Background (far): 1.00x motion rate
 *   - Character (mid): 1.15x motion rate
 *   - Foreground (near): 1.35x motion rate
 */
export function calculateParallaxTransforms(
  progress: number, // 0.0 to 1.0 across the shot
  motion: CameraMotion,
  framing: CameraFraming = 'medium'
): LayerTransforms {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const baseScale = FRAMING_BASE_SCALES[framing] || 1.15;

  let bgX = 0;
  let bgY = 0;
  let bgScale = baseScale;

  let charX = 0;
  let charY = 0;
  let charScale = baseScale;

  let fgX = 0;
  let fgY = 0;
  let fgScale = baseScale;

  switch (motion) {
    case 'pan_left': {
      // Camera pans left => visual content drifts right-to-left
      // Foreground moves fastest, background moves slowest
      bgX = 25 - clampedProgress * 50;           // 25 -> -25
      charX = 25 * 1.15 - clampedProgress * 50 * 1.15; // 28.75 -> -28.75
      fgX = 25 * 1.35 - clampedProgress * 50 * 1.35;   // 33.75 -> -33.75
      break;
    }
    case 'pan_right': {
      // Camera pans right => visual content drifts left-to-right
      bgX = -25 + clampedProgress * 50;          // -25 -> 25
      charX = -25 * 1.15 + clampedProgress * 50 * 1.15;
      fgX = -25 * 1.35 + clampedProgress * 50 * 1.35;
      break;
    }
    case 'zoom_in': {
      // Camera pushes in => foreground scales fastest
      bgScale = baseScale + clampedProgress * 0.06;
      charScale = baseScale + clampedProgress * 0.08;
      fgScale = baseScale + clampedProgress * 0.12;
      break;
    }
    case 'zoom_out': {
      // Camera pulls out
      bgScale = (baseScale + 0.06) - clampedProgress * 0.06;
      charScale = (baseScale + 0.08) - clampedProgress * 0.08;
      fgScale = (baseScale + 0.12) - clampedProgress * 0.12;
      break;
    }
    case 'static':
    default:
      // No movement
      break;
  }

  return {
    background: { scale: bgScale, translateX: bgX, translateY: bgY },
    character: { scale: charScale, translateX: charX, translateY: charY },
    foreground: { scale: fgScale, translateX: fgX, translateY: fgY },
  };
}

/**
 * Builds CSS filter string for character sprite environmental lighting matching.
 */
export function buildCssFilter(lighting: SettingLighting): string {
  const b = lighting.brightness ?? 1.0;
  const c = lighting.contrast ?? 1.0;
  const sep = lighting.sepia ?? 0.0;
  const hue = lighting.hueRotateDeg ?? 0;
  const sat = lighting.saturate ?? 1.0;

  return `brightness(${b}) contrast(${c}) sepia(${sep}) hue-rotate(${hue}deg) saturate(${sat})`;
}

/**
 * Builds contact shadow CSS style for anchoring character base coordinates.
 */
export function buildContactShadowStyle(
  lighting: SettingLighting,
  xPercent: number,
  yPercent: number,
  charScale: number = 1.0,
  baseWidthPx: number = 220
): React.CSSProperties {
  const scaleX = (lighting.shadowScaleX ?? 0.85) * charScale;
  const scaleY = (lighting.shadowScaleY ?? 0.25) * charScale;
  const offsetY = lighting.shadowOffsetYPercent ?? 2.0;
  const widthPx = Math.round(baseWidthPx * scaleX);
  const heightPx = Math.round(baseWidthPx * scaleY);

  return {
    position: 'absolute',
    left: `${xPercent}%`,
    top: `${yPercent + offsetY}%`,
    width: `${widthPx}px`,
    height: `${heightPx}px`,
    borderRadius: '50%',
    backgroundColor: lighting.shadowColor || 'rgba(0, 0, 0, 0.35)',
    filter: `blur(${lighting.shadowBlurPx ?? 10}px)`,
    opacity: lighting.shadowOpacity ?? 0.35,
    transform: 'translate(-50%, -50%)',
    zIndex: 10,
    pointerEvents: 'none',
  };
}
