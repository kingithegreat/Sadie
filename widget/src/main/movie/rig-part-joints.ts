/**
 * Rig part joints: find where a generated limb's joints really are, then move
 * the art so those joints land exactly where the rig expects them.
 *
 * Ancient Pathways' cutout rig (pipeline/anim/skeleton.py PartDef) fixes every
 * joint as a fraction of the part image — Leila's shoulder sits 15% down
 * `upper_arm_l.png`, her elbow 88% down. A text-to-image model cannot be made
 * to draw a shoulder at 15%, so we do not ask it to be exact. We ask it to draw
 * over a guide (rig-part-templates.ts), measure the joints from the cut-out
 * shape, and snap the art with the one similarity transform that maps the two
 * measured joints onto the two spec joints. The generator only has to be close.
 *
 * Joints are measured from geometry, not from markers painted into the art:
 * a generator places coloured dots unreliably, they collide with costume
 * colours, and removing them leaves holes. A limb drawn for a cutout rig ends in
 * a rounded cap centred on its pivot (docs/RIG_PLAN.md "Rounded joint caps"),
 * so each joint is the centre of the cap at that end of the limb's long axis.
 *
 * Pure functions over RGBA buffers, so every step is unit-testable.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

export interface Point { x: number; y: number }

/** Alpha at or above this counts as figure when measuring. */
const SOLID_ALPHA = 128;

export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

// ---------------------------------------------------------------------------
// 1. Chroma cut
// ---------------------------------------------------------------------------

/** How magenta a pixel is: both red and blue far above green. */
function magentaness(r: number, g: number, b: number): number {
  return Math.min(r, b) - g;
}

/** Fully figure at or below this magentaness, fully ground at or above the next. */
const KEY_FIGURE = 70;
const KEY_GROUND = 150;

/**
 * Key the magenta ground to transparency, remove magenta spill from the soft
 * edge, and drop specks: only connected pieces at least 5% the size of the
 * largest survive.
 */
export function keyMagentaGround(src: RgbaImage): { image: RgbaImage; residualGroundPx: number } {
  const { width, height } = src;
  const out = blankImage(width, height);
  const d = src.data;
  const o = out.data;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = d[p]!, g = d[p + 1]!, b = d[p + 2]!;
    const m = magentaness(r, g, b);
    let alpha = m <= KEY_FIGURE ? 255 : m >= KEY_GROUND ? 0 : Math.round(255 * (KEY_GROUND - m) / (KEY_GROUND - KEY_FIGURE));
    alpha = Math.round(alpha * (d[p + 3]! / 255));
    let rr = r, bb = b;
    if (alpha < 255 && m > 0) {
      // Spill: pull red and blue back toward green by the magenta excess.
      rr = Math.max(0, r - m);
      bb = Math.max(0, b - m);
    }
    o[p] = rr; o[p + 1] = g; o[p + 2] = bb; o[p + 3] = alpha;
  }
  dropSpecks(out, 0.05);
  // Judge by the ORIGINAL colour: despill turns a magenta-tinted pixel grey, so
  // checking the output would never find one.
  let residualGroundPx = 0;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    if (o[p + 3]! >= SOLID_ALPHA && magentaness(d[p]!, d[p + 1]!, d[p + 2]!) > KEY_FIGURE) residualGroundPx++;
  }
  return { image: out, residualGroundPx };
}

/** Zero every connected piece smaller than `minShare` of the largest one. */
function dropSpecks(img: RgbaImage, minShare: number): void {
  const { width, height, data } = img;
  const label = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || data[start * 4 + 3]! < SOLID_ALPHA) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width, y = (i - x) / width;
      const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of neighbours) {
        if (n >= 0 && label[n] === -1 && data[n * 4 + 3]! >= SOLID_ALPHA) { label[n] = id; stack.push(n); }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return;
  const keepFrom = Math.max(...sizes) * minShare;
  for (let i = 0; i < width * height; i++) {
    const id = label[i]!;
    // Soft edge pixels (alpha < SOLID) belong to whatever solid piece they touch;
    // leave them unless every solid neighbour was dropped.
    if (id >= 0 ? sizes[id]! < keepFrom : !touchesKeptPiece(i, width, height, label, sizes, keepFrom)) data[i * 4 + 3] = 0;
  }
}

function touchesKeptPiece(i: number, width: number, height: number, label: Int32Array, sizes: number[], keepFrom: number): boolean {
  const x = i % width, y = (i - x) / width;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const id = label[ny * width + nx]!;
      if (id >= 0 && sizes[id]! >= keepFrom) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 2. Measure joints
// ---------------------------------------------------------------------------

export interface LimbMeasurement {
  proximal: Point;
  distal: Point;
  /** Long-axis length over short-axis spread; a limb is well above 2. */
  elongation: number;
  /** Median half-width across the middle of the limb, in pixels. */
  halfWidth: number;
  /** Opaque pixels measured. */
  area: number;
  /** Opaque pixels on the image border: the generator cut the limb off. */
  borderPx: number;
}

/**
 * Joint centres of a single limb. `proximalHint` picks which end is the
 * proximal joint (the guide puts it at the top).
 */
export function measureLimbJoints(img: RgbaImage, proximalHint: Point): LimbMeasurement | null {
  const { width, height, data } = img;
  let n = 0, sx = 0, sy = 0, borderPx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < SOLID_ALPHA) continue;
      n++; sx += x; sy += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) borderPx++;
    }
  }
  if (n < 50) return null;
  const cx = sx / n, cy = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < SOLID_ALPHA) continue;
      const dx = x - cx, dy = y - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
  }
  sxx /= n; syy /= n; sxy /= n;
  // Principal axis of the 2x2 covariance.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const l1 = trace / 2 + disc;
  const l2 = Math.max(1e-6, trace / 2 - disc);
  let ux: number, uy: number;
  if (Math.abs(sxy) > 1e-9) { ux = l1 - syy; uy = sxy; } else if (sxx >= syy) { ux = 1; uy = 0; } else { ux = 0; uy = 1; }
  const ul = Math.hypot(ux, uy);
  ux /= ul; uy /= ul;
  const vx = -uy, vy = ux;

  // Cross-section extents along the axis, in 1px bins.
  let tmin = Infinity, tmax = -Infinity;
  const samples: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < SOLID_ALPHA) continue;
      const dx = x - cx, dy = y - cy;
      const t = dx * ux + dy * uy;
      samples.push([t, dx * vx + dy * vy]);
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
    }
  }
  const bins = Math.floor(tmax - tmin) + 1;
  const lo = new Float64Array(bins).fill(Infinity);
  const hi = new Float64Array(bins).fill(-Infinity);
  for (const [t, s] of samples) {
    const b = Math.min(bins - 1, Math.floor(t - tmin));
    if (s < lo[b]!) lo[b] = s;
    if (s > hi[b]!) hi[b] = s;
  }
  const halfAt = (b: number) => (hi[b]! >= lo[b]! ? (hi[b]! - lo[b]! + 1) / 2 : 0);
  const midAt = (b: number) => (hi[b]! >= lo[b]! ? (hi[b]! + lo[b]!) / 2 : 0);
  const middle: number[] = [];
  for (let b = Math.floor(bins * 0.2); b <= Math.ceil(bins * 0.8) && b < bins; b++) if (hi[b]! >= lo[b]!) middle.push(halfAt(b));
  middle.sort((a, b) => a - b);
  const halfWidth = middle.length ? middle[Math.floor(middle.length / 2)]! : 1;

  // A rounded cap of radius r has its centre r in from the tip, where r is the
  // limb's half-width just inside the cap.
  const capCentre = (fromStart: boolean): Point => {
    const probe = Math.min(bins - 1, Math.max(0, Math.round(halfWidth)));
    const b0 = fromStart ? probe : bins - 1 - probe;
    const r = Math.max(1, Math.min(halfAt(b0) || halfWidth, (tmax - tmin) / 2));
    const t = fromStart ? tmin + r : tmax - r;
    const b = Math.min(bins - 1, Math.max(0, Math.round(t - tmin)));
    const s = midAt(b);
    return { x: cx + t * ux + s * vx, y: cy + t * uy + s * vy };
  };
  const a = capCentre(true);
  const z = capCentre(false);
  const aFirst = Math.hypot(a.x - proximalHint.x, a.y - proximalHint.y) <= Math.hypot(z.x - proximalHint.x, z.y - proximalHint.y);
  return {
    proximal: aFirst ? a : z,
    distal: aFirst ? z : a,
    elongation: Math.sqrt(l1 / l2),
    halfWidth,
    area: n,
    borderPx,
  };
}

// ---------------------------------------------------------------------------
// 3. Snap
// ---------------------------------------------------------------------------

export interface SnapResult {
  image: RgbaImage;
  scale: number;
  /** Rotation applied, degrees. */
  rotationDeg: number;
  /** Share of the art's opaque pixels that fell outside the output canvas. */
  clippedShare: number;
}

/**
 * Move the art with the one rotation + uniform scale + shift that sends the
 * measured joints `from` onto the spec joints `to`, into a `width`×`height`
 * canvas. Premultiplied bilinear sampling, so edges do not darken.
 */
export function snapToJoints(
  src: RgbaImage,
  from: { proximal: Point; distal: Point },
  to: { proximal: Point; distal: Point },
  width: number,
  height: number,
): SnapResult {
  const ax = from.distal.x - from.proximal.x, ay = from.distal.y - from.proximal.y;
  const bx = to.distal.x - to.proximal.x, by = to.distal.y - to.proximal.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) throw new Error('Joints are on top of each other.');
  const scale = lb / la;
  const theta = Math.atan2(by, bx) - Math.atan2(ay, ax);
  const cos = Math.cos(theta), sin = Math.sin(theta);

  // Inverse map: output q -> source p = from.proximal + R(-θ)(q - to.proximal)/scale
  const out = blankImage(width, height);
  const s = src.data, o = out.data;
  const sample = (x: number, y: number, c: number): number => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
    return s[(y * src.width + x) * 4 + c]!;
  };
  for (let qy = 0; qy < height; qy++) {
    for (let qx = 0; qx < width; qx++) {
      const dx = (qx + 0.5 - to.proximal.x) / scale, dy = (qy + 0.5 - to.proximal.y) / scale;
      const px = from.proximal.x + cos * dx + sin * dy - 0.5;
      const py = from.proximal.y - sin * dx + cos * dy - 0.5;
      const x0 = Math.floor(px), y0 = Math.floor(py);
      const fx = px - x0, fy = py - y0;
      let a = 0, r = 0, g = 0, b = 0;
      for (const [xx, yy, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]] as const) {
        if (w === 0) continue;
        const al = sample(xx, yy, 3) * w;
        a += al;
        r += sample(xx, yy, 0) * al; g += sample(xx, yy, 1) * al; b += sample(xx, yy, 2) * al;
      }
      if (a <= 0) continue;
      const p = (qy * width + qx) * 4;
      o[p] = Math.round(r / a); o[p + 1] = Math.round(g / a); o[p + 2] = Math.round(b / a); o[p + 3] = Math.round(a);
    }
  }

  // Forward-map the source's opaque pixels to count what the canvas cut off.
  let opaque = 0, clipped = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (s[(y * src.width + x) * 4 + 3]! < SOLID_ALPHA) continue;
      opaque++;
      const dx = x + 0.5 - from.proximal.x, dy = y + 0.5 - from.proximal.y;
      const qx = to.proximal.x + scale * (cos * dx - sin * dy);
      const qy = to.proximal.y + scale * (sin * dx + cos * dy);
      if (qx < 0 || qy < 0 || qx >= width || qy >= height) clipped++;
    }
  }
  return { image: out, scale, rotationDeg: theta * 180 / Math.PI, clippedShare: opaque ? clipped / opaque : 1 };
}

// ---------------------------------------------------------------------------
// 4. Gate
// ---------------------------------------------------------------------------

export interface PartCheck { name: string; ok: boolean; detail: string }

export interface GateInput {
  measured: LimbMeasurement;
  /** Where the guide put the joints, in the generated image's pixels. */
  guide: { proximal: Point; distal: Point; halfWidth: number };
  residualGroundPx: number;
  snap: SnapResult;
  /** Joints re-measured on the snapped part, against the spec joints. */
  remeasured: LimbMeasurement | null;
  spec: { proximal: Point; distal: Point };
}

/** Pass only a part whose joints can be trusted; every check says why. */
export function gateRigPart(input: GateInput): { ok: boolean; checks: PartCheck[]; jointErrorPx: number } {
  const { measured, guide, snap, remeasured, spec } = input;
  const checks: PartCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add('one limb', measured.elongation >= 2.2, `long/short axis ${measured.elongation.toFixed(2)} (a limb is 2.2 or more)`);
  add('not cut off', measured.borderPx === 0, `${measured.borderPx} figure pixels touch the image edge`);
  add('clean ground', input.residualGroundPx === 0, `${input.residualGroundPx} magenta pixels left in the figure`);

  const guideLen = Math.hypot(guide.distal.x - guide.proximal.x, guide.distal.y - guide.proximal.y);
  const len = Math.hypot(measured.distal.x - measured.proximal.x, measured.distal.y - measured.proximal.y);
  const lenRatio = len / guideLen;
  add('follows the guide length', lenRatio >= 0.7 && lenRatio <= 1.4, `joint distance ${(lenRatio * 100).toFixed(0)}% of the guide`);

  const tilt = Math.abs(snap.rotationDeg) % 360;
  const tiltDeg = Math.min(tilt, 360 - tilt);
  add('drawn along the guide', tiltDeg <= 20, `turned ${tiltDeg.toFixed(1)}° to fit`);

  const widthRatio = measured.halfWidth / guide.halfWidth;
  add('limb thickness', widthRatio >= 0.5 && widthRatio <= 1.8, `${(widthRatio * 100).toFixed(0)}% of the guide width`);

  add('fits the part canvas', snap.clippedShare <= 0.01, `${(snap.clippedShare * 100).toFixed(1)}% of the art falls outside`);

  let jointErrorPx = Infinity;
  if (remeasured) {
    jointErrorPx = Math.max(
      Math.hypot(remeasured.proximal.x - spec.proximal.x, remeasured.proximal.y - spec.proximal.y),
      Math.hypot(remeasured.distal.x - spec.distal.x, remeasured.distal.y - spec.distal.y),
    );
  }
  const specLen = Math.hypot(spec.distal.x - spec.proximal.x, spec.distal.y - spec.proximal.y);
  add('joints land on the rig', jointErrorPx <= Math.max(2, specLen * 0.03),
    remeasured ? `re-measured joints within ${jointErrorPx.toFixed(1)}px of the rig's (limit ${Math.max(2, specLen * 0.03).toFixed(1)}px)` : 'could not re-measure the snapped part');

  return { ok: checks.every(c => c.ok), checks, jointErrorPx };
}
