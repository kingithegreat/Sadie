/**
 * Rig under-layer: a finished base plate under every limb socket and the mouth,
 * so extreme poses never reveal magenta, holes, or cut anatomy.
 *
 * Paired with the #368 guide-ring part path: generate this plate first (torso +
 * head with painted shoulder/hip wells and a closed mouth), then stack guide-ring
 * limbs and visemes on top. Extreme-pose QA rotates each part through its range
 * and asserts every newly revealed pixel is finished character art.
 */

import { blankImage, type Point, type RgbaImage } from './rig-part-joints';

export const UNDERLAYER_WIDTH = 1024;
export const UNDERLAYER_HEIGHT = 1536;
export const UNDERLAYER_ASPECT = '2:3';

/** Magenta must not survive in a revealed under-plate region. */
const MAGENTA_MAX = 40; // magentaness = min(r,b) - g
const MIN_ALPHA = 230;
/** Near-transparent speckles (alpha in this band) count as junk. */
const SPECKLE_ALPHA_LO = 1;
const SPECKLE_ALPHA_HI = 40;

export interface SocketWell {
  id: string;
  /** Centre of the socket on the base plate. */
  centre: Point;
  radius: number;
}

/** Shoulder / hip wells and a closed-mouth cavity the part layers cover. */
export function underlayerSockets(width = UNDERLAYER_WIDTH, height = UNDERLAYER_HEIGHT): SocketWell[] {
  return [
    { id: 'shoulder_l', centre: { x: width * 0.30, y: height * 0.32 }, radius: width * 0.07 },
    { id: 'shoulder_r', centre: { x: width * 0.70, y: height * 0.32 }, radius: width * 0.07 },
    { id: 'hip_l', centre: { x: width * 0.38, y: height * 0.58 }, radius: width * 0.06 },
    { id: 'hip_r', centre: { x: width * 0.62, y: height * 0.58 }, radius: width * 0.06 },
    { id: 'mouth', centre: { x: width * 0.50, y: height * 0.22 }, radius: width * 0.045 },
  ];
}

const MAGENTA: [number, number, number] = [255, 0, 255];
const FILL: [number, number, number] = [200, 170, 150];
const EDGE: [number, number, number] = [120, 90, 80];
const RING: [number, number, number] = [0, 150, 160];

/**
 * Magenta ground + torso/head silhouette with darker wells at each socket and a
 * ring marking the mouth landmark. The generator paints finished underpaint into
 * every well so a rotated limb never opens onto empty ground.
 */
export function renderUnderlayerGuide(width = UNDERLAYER_WIDTH, height = UNDERLAYER_HEIGHT): RgbaImage {
  const img = blankImage(width, height);
  const sockets = underlayerSockets(width, height);
  const torsoCx = width / 2;
  const torsoTop = height * 0.18;
  const torsoBot = height * 0.72;
  const torsoHalfW = width * 0.22;
  const headCy = height * 0.14;
  const headR = width * 0.11;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5, py = y + 0.5;
      let c = MAGENTA;
      const inHead = Math.hypot(px - torsoCx, py - headCy) <= headR;
      const inTorso = py >= torsoTop && py <= torsoBot && Math.abs(px - torsoCx) <= torsoHalfW * (1 - (py - torsoTop) / (torsoBot - torsoTop) * 0.15);
      if (inHead || inTorso) c = FILL;
      for (const s of sockets) {
        const d = Math.hypot(px - s.centre.x, py - s.centre.y);
        if (d <= s.radius) c = EDGE;
        if (Math.abs(d - s.radius * 0.55) <= 2.5) c = RING;
      }
      const p = (y * width + x) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
  }
  return img;
}

export function buildUnderlayerPrompt(characterDescription: string, attemptNote?: string): string {
  return [
    'Draw a FULL character BASE PLATE for a 2D cutout animation rig: torso + head only, no arms, no legs, no hands.',
    'The FIRST image is a placement guide on flat magenta #FF00FF. Paint the finished character on the torso/head silhouette.',
    'Every darker circular WELL (shoulders, hips, mouth) must be filled with finished underpainting — the same skin/cloth that should show when a limb or mouth flap rotates away. No holes, no magenta inside the figure, no cut anatomy.',
    'The mouth well is a closed, coherent mouth (lips together). Viseme overlays will sit on top later.',
    'Output: the base plate alone on flat solid magenta #FF00FF, matching the guide background. Do not draw the grey rings or guide marks. Do not use magenta or pink on the character.',
    'Flat even lighting. Match the character design in the reference images exactly.',
    characterDescription.trim(),
    attemptNote ? `Previous attempt was rejected: ${attemptNote}. Fix that.` : '',
  ].filter(Boolean).join('\n\n');
}

function magentaness(r: number, g: number, b: number): number {
  return Math.min(r, b) - g;
}

export interface RevealCheckResult {
  ok: boolean;
  detail: string;
  magentaPx: number;
  speckles: number;
  thinPx: number;
  sampledPx: number;
}

/**
 * Extreme-pose reveal: for a hinge, sample the under-plate in the annulus a
 * rotated limb would uncover (outside the resting footprint). Assert no magenta,
 * no near-transparent speckles, and solid alpha — finished character art only.
 */
export function extremePoseRevealCheck(
  underlayer: RgbaImage,
  /** Resting opaque footprint of the part on the under-plate (same size), or null to check socket wells only. */
  restingMask: RgbaImage | null,
  sockets: SocketWell[],
): RevealCheckResult {
  const { width, height, data } = underlayer;
  let magentaPx = 0, speckles = 0, thinPx = 0, sampledPx = 0;
  const inRest = (x: number, y: number): boolean => {
    if (!restingMask) return false;
    if (x < 0 || y < 0 || x >= restingMask.width || y >= restingMask.height) return false;
    return restingMask.data[(y * restingMask.width + x) * 4 + 3]! >= MIN_ALPHA;
  };
  for (const s of sockets) {
    const r0 = s.radius * 0.3;
    const r1 = s.radius * 1.6;
    const x0 = Math.max(0, Math.floor(s.centre.x - r1));
    const x1 = Math.min(width - 1, Math.ceil(s.centre.x + r1));
    const y0 = Math.max(0, Math.floor(s.centre.y - r1));
    const y1 = Math.min(height - 1, Math.ceil(s.centre.y + r1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - s.centre.x, y + 0.5 - s.centre.y);
        if (d < r0 || d > r1) continue;
        if (inRest(x, y)) continue; // still covered at rest — not a reveal
        sampledPx++;
        const p = (y * width + x) * 4;
        const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!, a = data[p + 3]!;
        if (magentaness(r, g, b) > MAGENTA_MAX) magentaPx++;
        if (a >= SPECKLE_ALPHA_LO && a <= SPECKLE_ALPHA_HI) speckles++;
        if (a < MIN_ALPHA) thinPx++;
      }
    }
  }
  const ok = sampledPx > 0 && magentaPx === 0 && speckles === 0 && thinPx === 0;
  const detail = ok
    ? `under-layer clean across ${sampledPx} revealed px`
    : `under-layer reveal failed: magenta=${magentaPx}, speckles=${speckles}, thin=${thinPx} of ${sampledPx} sampled px`;
  return { ok, detail, magentaPx, speckles, thinPx, sampledPx };
}

/** Committed mouth landmark on the base plate (guide ring centre). */
export function mouthLandmark(width = UNDERLAYER_WIDTH, height = UNDERLAYER_HEIGHT): Point {
  return underlayerSockets(width, height).find(s => s.id === 'mouth')!.centre;
}
