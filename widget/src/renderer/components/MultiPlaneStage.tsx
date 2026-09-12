/**
 * MultiPlaneStage.tsx — Zero-VRAM 2.5D Optical Multi-Plane Compositing Stage.
 *
 * Implements the 4-tier layer sandwich:
 *   [Tier 30] Foreground Layer (fg.png)       ── Fastest parallax (1.35x), occludes character
 *   [Tier 20] Character Sprite (CSS Filtered) ── Midground parallax (1.15x), room lighting grade
 *   [Tier 10] Contact Shadow (SVG/CSS Blur)   ── Anchored to feet (x, y), grounds character
 *   [Tier 00] Background Layer (bg.png)       ── Base parallax (1.00x), walls & environment
 *
 * Runs 100% on CPU/CSS transforms and filters. $0.00 spend, 0 MB GPU VRAM consumed.
 */

import React from 'react';
import {
  calculateParallaxTransforms,
  buildContactShadowStyle,
  buildCssFilter,
  type CameraMotion,
  type CharacterDepthStaging,
  type SettingLighting,
  type StageFraming,
  LIGHTING_PRESETS,
} from '../../shared/multi-plane-stage';


export interface MultiPlaneStageProps {
  bgSrc: string;
  fgSrc?: string;
  characterSlot?: React.ReactNode;
  characterPosition?: {
    xPercent: number;
    yPercent: number;
    scale?: number;
  };
  depthStaging?: CharacterDepthStaging;
  lighting?: SettingLighting;
  cameraMotion?: CameraMotion;
  framing?: StageFraming;
  progress?: number; // 0.0 to 1.0
  aspectRatio?: string; // default '16/9'
  showVignette?: boolean;
}

export const MultiPlaneStage: React.FC<MultiPlaneStageProps> = ({
  bgSrc,
  fgSrc,
  characterSlot,
  characterPosition = { xPercent: 50, yPercent: 65, scale: 1.0 },
  depthStaging = 'midground_behind_fg',
  lighting = LIGHTING_PRESETS.studio_warm,
  cameraMotion = 'static',
  framing = 'medium',
  progress = 0.5,
  aspectRatio = '16/9',
  showVignette = true,
}) => {
  const transforms = calculateParallaxTransforms(progress, cameraMotion, framing);
  const charFilter = buildCssFilter(lighting);
  const shadowStyle = buildContactShadowStyle(
    lighting,
    characterPosition.xPercent,
    characterPosition.yPercent,
    characterPosition.scale ?? 1.0
  );

  const isBehindFg = Boolean(fgSrc && depthStaging === 'midground_behind_fg');

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio,
        overflow: 'hidden',
        backgroundColor: '#0a0d14',
        userSelect: 'none',
      }}
      data-testid="multi-plane-stage"
    >
      {/* 1. BACKGROUND LAYER (Base Parallax 1.00x) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${transforms.background.scale}) translate(${transforms.background.translateX}px, ${transforms.background.translateY}px)`,
          transformOrigin: 'center center',
          transition: 'transform 0.05s linear',
          zIndex: 0,
        }}
        data-testid="stage-background-layer"
      >
        <img
          src={bgSrc}
          alt="Setting Background"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>

      {/* 2. CONTACT SHADOW LAYER (Anchored to character base coordinates) */}
      {characterSlot && (
        <div
          style={{
            ...shadowStyle,
            transform: `translate(-50%, -50%) translate(${transforms.character.translateX}px, ${transforms.character.translateY}px)`,
            zIndex: 10,
          }}
          data-testid="stage-contact-shadow"
        />
      )}

      {/* 3. CHARACTER SPRITE / PUPPET LAYER (Midground Parallax 1.15x + CSS Room Lighting) */}
      {characterSlot && (
        <div
          style={{
            position: 'absolute',
            left: `${characterPosition.xPercent}%`,
            top: `${characterPosition.yPercent}%`,
            transform: `translate(-50%, -50%) translate(${transforms.character.translateX}px, ${transforms.character.translateY}px) scale(${characterPosition.scale ?? 1.0})`,
            transformOrigin: 'center bottom',
            filter: charFilter,
            zIndex: isBehindFg ? 20 : 40,
            pointerEvents: 'none',
          }}
          data-testid="stage-character-layer"
        >
          {characterSlot}
        </div>
      )}

      {/* 4. FOREGROUND OCCLUSION LAYER (Fastest Parallax 1.35x, Occludes Character) */}
      {fgSrc && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${transforms.foreground.scale}) translate(${transforms.foreground.translateX}px, ${transforms.foreground.translateY}px)`,
            transformOrigin: 'center center',
            transition: 'transform 0.05s linear',
            zIndex: 30,
            pointerEvents: 'none',
          }}
          data-testid="stage-foreground-layer"
        >
          <img
            src={fgSrc}
            alt="Setting Foreground Occlusion"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      )}

      {/* 5. CINEMATIC ATMOSPHERIC VIGNETTE */}
      {showVignette && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 60%, rgba(5,8,15,0.45) 100%)',
            pointerEvents: 'none',
            zIndex: 50,
          }}
          data-testid="stage-vignette"
        />
      )}
    </div>
  );
};
