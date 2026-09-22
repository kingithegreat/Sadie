import {
  blankImage, gateRigPart, keyMagentaGround, measureLimbJoints, snapToJoints,
  type Point, type RgbaImage,
} from '../movie/rig-part-joints';
import {
  buildRigPartPrompt, guideGeometry, partCanvas, partDefFractions, renderGuide, RIG_PART_TEMPLATES,
} from '../movie/rig-part-templates';

// Real pixel loops over 1K generation images: CPU work well past Jest's 5s default under CI load (AGENTS.md).
jest.setTimeout(30_000);

const MAGENTA = [255, 0, 255];
const SKIN = [236, 176, 140];
const OUTLINE = [70, 35, 20];

/** A generator stand-in: a limb with round caps on the given joints, outlined, on magenta. */
function drawLimb(width: number, height: number, a: Point, b: Point, halfWidth: number, opts: { ground?: number[] } = {}): RgbaImage {
  const img = blankImage(width, height);
  const ground = opts.ground ?? MAGENTA;
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2));
      const d = Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
      const c = d <= halfWidth - 3 ? SKIN : d <= halfWidth ? OUTLINE : ground;
      const p = (y * width + x) * 4;
      img.data[p] = c[0]!; img.data[p + 1] = c[1]!; img.data[p + 2] = c[2]!; img.data[p + 3] = 255;
    }
  }
  return img;
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

describe('rig part joints', () => {
  it('measures the joint centres of a tilted, off-centre limb within 1.5px', () => {
    const shoulder = { x: 380, y: 300 }, elbow = { x: 470, y: 880 };
    const { image, residualGroundPx } = keyMagentaGround(drawLimb(832, 1248, shoulder, elbow, 110));
    expect(residualGroundPx).toBe(0);
    const m = measureLimbJoints(image, { x: 416, y: 0 })!;
    expect(dist(m.proximal, shoulder)).toBeLessThan(1.5);
    expect(dist(m.distal, elbow)).toBeLessThan(1.5);
    expect(m.halfWidth).toBeGreaterThan(105);
    expect(m.halfWidth).toBeLessThan(115);
    expect(m.borderPx).toBe(0);
  });

  it('the proximal hint decides which end is which', () => {
    const top = { x: 416, y: 300 }, bottom = { x: 416, y: 900 };
    const { image } = keyMagentaGround(drawLimb(832, 1248, top, bottom, 100));
    const flipped = measureLimbJoints(image, { x: 416, y: 1248 })!;
    expect(dist(flipped.proximal, bottom)).toBeLessThan(1.5);
    expect(dist(flipped.distal, top)).toBeLessThan(1.5);
  });

  it('drops magenta and specks, keeps the figure and its own colours', () => {
    const img = drawLimb(200, 300, { x: 100, y: 80 }, { x: 100, y: 220 }, 40);
    // A stray speck and a grey pixel inside the ground.
    for (const [x, y] of [[10, 10], [11, 10], [10, 11]]) img.data.set([30, 30, 30, 255], (y! * 200 + x!) * 4);
    const { image, residualGroundPx } = keyMagentaGround(img);
    expect(residualGroundPx).toBe(0);
    expect(image.data[(10 * 200 + 10) * 4 + 3]).toBe(0);
    const centre = (150 * 200 + 100) * 4;
    expect(Array.from(image.data.slice(centre, centre + 4))).toEqual([...SKIN, 255]);
    expect(image.data[3]).toBe(0);
  });

  it('snaps a generated limb so its joints land on the part canvas joints', () => {
    const t = RIG_PART_TEMPLATES.upper_arm_l!;
    const canvas = partCanvas(t, 4);
    const guide = guideGeometry(t);
    // The "generator" drew it 8° off, shifted, and 12% too long.
    const shoulder = { x: guide.proximal.x + 40, y: guide.proximal.y - 20 };
    const angle = 8 * Math.PI / 180, len = (guide.distal.y - guide.proximal.y) * 1.12;
    const elbow = { x: shoulder.x - Math.sin(angle) * len, y: shoulder.y + Math.cos(angle) * len };
    const { image, residualGroundPx } = keyMagentaGround(drawLimb(832, 1248, shoulder, elbow, guide.halfWidth * 1.1));

    const measured = measureLimbJoints(image, guide.proximal)!;
    const snap = snapToJoints(image, measured, canvas, canvas.width, canvas.height);
    expect(snap.rotationDeg).toBeCloseTo(-8, 0);
    const remeasured = measureLimbJoints(snap.image, canvas.proximal);
    const gate = gateRigPart({ measured, guide, residualGroundPx, snap, remeasured, spec: canvas });
    expect(gate.checks.filter(c => !c.ok)).toEqual([]);
    expect(gate.ok).toBe(true);
    expect(gate.jointErrorPx).toBeLessThan(2);
    expect(partDefFractions(canvas).pivot[0]).toBe(0.5);
  });

  describe('rejects parts whose joints cannot be trusted', () => {
    const t = RIG_PART_TEMPLATES.forearm_l!;
    const canvas = partCanvas(t, 4);
    const guide = guideGeometry(t);
    const failed = (img: RgbaImage) => {
      const { image, residualGroundPx } = keyMagentaGround(img);
      const measured = measureLimbJoints(image, guide.proximal)!;
      const snap = snapToJoints(image, measured, canvas, canvas.width, canvas.height);
      const gate = gateRigPart({ measured, guide, residualGroundPx, snap, remeasured: measureLimbJoints(snap.image, canvas.proximal), spec: canvas });
      expect(gate.ok).toBe(false);
      return gate.checks.filter(c => !c.ok).map(c => c.name);
    };

    it('a blob is not a limb', () => {
      expect(failed(drawLimb(832, 1248, { x: 416, y: 600 }, { x: 416, y: 640 }, 250))).toContain('one limb');
    });
    it('a limb the generator cut off at the edge', () => {
      expect(failed(drawLimb(832, 1248, { x: 416, y: 20 }, { x: 416, y: 900 }, 60))).toContain('not cut off');
    });
    it('a limb drawn at the wrong angle, or far longer than the guide', () => {
      expect(failed(drawLimb(832, 1248, { x: 200, y: 400 }, { x: 700, y: 700 }, 60))).toEqual(['drawn along the guide']);
      expect(failed(drawLimb(832, 1248, { x: 416, y: 150 }, { x: 416, y: 1100 }, 60))).toContain('follows the guide length');
    });
    it('magenta or pink left on the part', () => {
      const pinkish = drawLimb(832, 1248, guide.proximal, guide.distal, guide.halfWidth);
      for (let y = 600; y < 640; y++) for (let x = 400; x < 430; x++) pinkish.data.set([230, 120, 225, 255], (y * 832 + x) * 4);
      expect(failed(pinkish)).toEqual(['clean ground']);
    });
  });
});

describe('rig part templates', () => {
  it('the guide puts the rings and capsule exactly where the geometry says', () => {
    const t = RIG_PART_TEMPLATES.upper_arm_l!;
    const g = guideGeometry(t);
    const img = renderGuide(t);
    const px = (x: number, y: number) => Array.from(img.data.slice((Math.round(y) * img.width + Math.round(x)) * 4, (Math.round(y) * img.width + Math.round(x)) * 4 + 3));
    expect(px(5, 5)).toEqual([255, 0, 255]);
    expect(px(g.proximal.x, (g.proximal.y + g.distal.y) / 2)).toEqual([215, 215, 215]);
    // The capsule, keyed like a generated image, measures back to the guide joints.
    const m = measureLimbJoints(keyMagentaGround(img).image, g.proximal)!;
    expect(dist(m.proximal, g.proximal)).toBeLessThan(2);
    expect(dist(m.distal, g.distal)).toBeLessThan(2);
  });

  it('every part canvas has room for its caps', () => {
    for (const t of Object.values(RIG_PART_TEMPLATES)) {
      const c = partCanvas(t, 4);
      expect(c.proximal.y).toBeGreaterThan(c.halfWidth);
      expect(c.height - c.distal.y).toBeGreaterThan(c.halfWidth);
      expect(c.width / 2).toBeGreaterThan(c.halfWidth);
    }
  });

  it('the prompt names the joints and forbids the guide marks and magenta on the part', () => {
    const p = buildRigPartPrompt(RIG_PART_TEMPLATES.forearm_l!, 'Leila, an 8-year-old explorer.', 'turned 31° to fit');
    expect(p).toMatch(/upper ring marks the elbow; the lower ring marks the wrist/);
    expect(p).toMatch(/Do not draw the grey capsule, the rings/);
    expect(p).toMatch(/Previous attempt was rejected: turned 31° to fit/);
  });
});
