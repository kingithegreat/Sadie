/**
 * Rig part templates: what each generated limb must be, and the guide image the
 * generator draws over.
 *
 * Sizes come from Leila's existing parts in Ancient Pathways, measured with
 * rig-part-joints.ts (2026-09-17): both arm segments are ~73 px joint to joint
 * at 1x; the upper arm's half-width is 0.24 of that, the forearm's 0.18.
 *
 * The canvas is NOT copied from the old parts. Their canvases are too tight for
 * a rounded joint cap — `upper_arm_l.png` puts the shoulder 15 px from the top
 * of a limb 35 px wide, so the art was cut off at the edge (72 figure pixels on
 * the border) and its pivot (0.50, 0.15) sits on the sleeve edge rather than
 * the shoulder. New parts get a canvas with room for the cap plus overlap, and
 * the joint fractions are reported as PartDef values for skeleton.py.
 */

import { blankImage, type Point, type RgbaImage } from './rig-part-joints';

export interface RigPartTemplate {
  id: string;
  /** What to draw, for the prompt. */
  label: string;
  proximalJoint: string;
  distalJoint: string;
  /** Joint-to-joint length at 1x, px. */
  boneLengthPx: number;
  /** Limb half-width as a share of the bone length. */
  halfWidthRatio: number;
  /** The file name skeleton.py loads. */
  filename: string;
}

export const RIG_PART_TEMPLATES: Record<string, RigPartTemplate> = {
  upper_arm_l: { id: 'upper_arm_l', label: "the character's LEFT UPPER ARM (shoulder to elbow, including the sleeve)", proximalJoint: 'shoulder', distalJoint: 'elbow', boneLengthPx: 73, halfWidthRatio: 0.24, filename: 'upper_arm_l.png' },
  forearm_l: { id: 'forearm_l', label: "the character's LEFT FOREARM (elbow to wrist, no hand)", proximalJoint: 'elbow', distalJoint: 'wrist', boneLengthPx: 73, halfWidthRatio: 0.18, filename: 'forearm_l.png' },
  upper_arm_r: { id: 'upper_arm_r', label: "the character's RIGHT UPPER ARM (shoulder to elbow, including the sleeve)", proximalJoint: 'shoulder', distalJoint: 'elbow', boneLengthPx: 73, halfWidthRatio: 0.24, filename: 'upper_arm_r.png' },
  forearm_r: { id: 'forearm_r', label: "the character's RIGHT FOREARM (elbow to wrist, no hand)", proximalJoint: 'elbow', distalJoint: 'wrist', boneLengthPx: 73, halfWidthRatio: 0.18, filename: 'forearm_r.png' },
};

/** Cap radius is the half-width; this much again past it is overlap under the parent. */
const CAP_PAD = 1.35;

export interface PartCanvas {
  width: number;
  height: number;
  proximal: Point;
  distal: Point;
  halfWidth: number;
}

/** The output canvas at `scale`× and where the joints must land on it. */
export function partCanvas(t: RigPartTemplate, scale: number): PartCanvas {
  const bone = t.boneLengthPx * scale;
  const halfWidth = bone * t.halfWidthRatio;
  const pad = Math.ceil(halfWidth * CAP_PAD);
  const width = 2 * pad;
  const height = Math.ceil(bone) + 2 * pad;
  return { width, height, proximal: { x: width / 2, y: pad }, distal: { x: width / 2, y: pad + bone }, halfWidth };
}

/** PartDef numbers for skeleton.py: pivot on this part, and where its child attaches. */
export function partDefFractions(c: PartCanvas): { pivot: [number, number]; childAnchor: [number, number] } {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    pivot: [r(c.proximal.x / c.width), r(c.proximal.y / c.height)],
    childAnchor: [r(c.distal.x / c.width), r(c.distal.y / c.height)],
  };
}

/** The generation image: 2:3 portrait, the limb upright with its joints at fixed places. */
export const GUIDE_WIDTH = 832;
export const GUIDE_HEIGHT = 1248;
export const GUIDE_ASPECT = '2:3';

export interface GuideGeometry { proximal: Point; distal: Point; halfWidth: number }

/** Where the guide puts the joints, as fractions, so any returned image size maps back. */
export function guideGeometry(t: RigPartTemplate, width = GUIDE_WIDTH, height = GUIDE_HEIGHT): GuideGeometry {
  const bone = height * 0.5;
  return { proximal: { x: width / 2, y: height * 0.25 }, distal: { x: width / 2, y: height * 0.75 }, halfWidth: bone * t.halfWidthRatio };
}

const MAGENTA: [number, number, number] = [255, 0, 255];
const GUIDE_FILL: [number, number, number] = [215, 215, 215];
const GUIDE_EDGE: [number, number, number] = [120, 120, 120];
const RING: [number, number, number] = [0, 150, 160];

/**
 * Magenta ground, a pale grey capsule where the limb goes, and a ring on each
 * joint. The capsule's rounded ends are the joint caps, centred on the rings.
 */
export function renderGuide(t: RigPartTemplate, width = GUIDE_WIDTH, height = GUIDE_HEIGHT): RgbaImage {
  const g = guideGeometry(t, width, height);
  const img = blankImage(width, height);
  const r = g.halfWidth;
  const ringR = Math.max(10, r * 0.22);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Distance to the bone segment gives the capsule.
      const ty = Math.max(g.proximal.y, Math.min(g.distal.y, y + 0.5));
      const dBone = Math.hypot(x + 0.5 - g.proximal.x, y + 0.5 - ty);
      const dRing = Math.min(Math.hypot(x + 0.5 - g.proximal.x, y + 0.5 - g.proximal.y), Math.hypot(x + 0.5 - g.distal.x, y + 0.5 - g.distal.y));
      let c = MAGENTA;
      if (dBone <= r) c = dBone >= r - 4 ? GUIDE_EDGE : GUIDE_FILL;
      if (Math.abs(dRing - ringR) <= 3) c = RING;
      const p = (y * width + x) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
  }
  return img;
}

export function buildRigPartPrompt(t: RigPartTemplate, characterDescription: string, attemptNote?: string): string {
  return [
    `Draw ONE separate body part for a 2D cutout animation rig: ${t.label}, for the character in the reference images.`,
    `The FIRST image is a placement guide. The pale grey capsule is where the part goes. The upper ring marks the ${t.proximalJoint}; the lower ring marks the ${t.distalJoint}.`,
    `Draw the part straight along the capsule, hanging straight down, as wide as the capsule. End it at each joint in a smooth rounded cap centred exactly on that joint's ring, so the part can rotate there without showing a corner or a gap.`,
    `Draw only this part — no hand, no torso, no head, no other limb.`,
    `Output: the part alone on a completely flat solid magenta #FF00FF background, exactly like the guide's background. Do not draw the grey capsule, the rings, any text, shadow, glow or border. Do not use magenta or pink anywhere on the part.`,
    `Flat, even lighting along the part (it will rotate). Match the character's design, colours, outline weight and style in the other reference images exactly.`,
    characterDescription.trim(),
    attemptNote ? `Previous attempt was rejected: ${attemptNote}. Fix that.` : '',
  ].filter(Boolean).join('\n\n');
}
