jest.mock('electron', () => ({ app: { getPath: () => require('os').tmpdir() } }));
jest.mock('../config-manager', () => ({ getSettings: () => ({}) }));
jest.mock('../ancient-pathways', () => ({ resolveAncientPathwaysDir: () => null }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { generateRigParts, mediaGenerateRigPartsDef, type RigPartDeps } from '../tools/media-rig-parts';
import { guideGeometry, RIG_PART_TEMPLATES } from '../movie/rig-part-templates';
import { measureLimbJoints, type Point } from '../movie/rig-part-joints';

// Real PNG encode/decode and pixel loops over 1K images (AGENTS.md: explicit timeout).
jest.setTimeout(60_000);

/** A stand-in for Gemini: a limb near the guide's joints, a little off, on magenta. */
async function limbPng(width: number, height: number, a: Point, b: Point, halfWidth: number): Promise<string> {
  const data = Buffer.alloc(width * height * 3);
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * vx + (y + 0.5 - a.y) * vy) / len2));
      const d = Math.hypot(x + 0.5 - (a.x + t * vx), y + 0.5 - (a.y + t * vy));
      const c = d <= halfWidth - 4 ? [30, 30, 34] : d <= halfWidth ? [10, 10, 10] : [255, 0, 255];
      data.set(c, (y * width + x) * 3);
    }
  }
  return (await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer()).toString('base64');
}

describe('media_generate_rig_parts', () => {
  let root: string;
  let charactersDir: string;
  let front: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-parts-'));
    charactersDir = path.join(root, 'characters');
    front = path.join(charactersDir, 'leila', 'turnaround', 'front.png');
    fs.mkdirSync(path.dirname(front), { recursive: true });
    fs.writeFileSync(front, Buffer.from('89504e470d0a1a0a', 'hex'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const deps = (generate: RigPartDeps['generate']): RigPartDeps => ({
    generate,
    outputRoot: () => path.join(root, 'out'),
    charactersDir: () => charactersDir,
    now: () => new Date('2026-09-17T10:00:00Z'),
  });

  it('asks before running, because it spends the Gemini key', () => {
    expect(mediaGenerateRigPartsDef.requiresConfirmation).toBe(true);
    expect(mediaGenerateRigPartsDef.description).toMatch(/US\$0\.067 per attempt/);
  });

  it('sends the guide first with the character art, snaps the part, and writes PartDef values', async () => {
    const t = RIG_PART_TEMPLATES.upper_arm_l!;
    const calls: Array<{ prompt: string; images: number; aspect: string; guideSize: [number, number] }> = [];
    const result = await generateRigParts({ character: 'leila', description: 'Black puffed sleeve.', parts: ['upper_arm_l'], skipUnderLayer: true }, deps(async (prompt, images, aspect) => {
      const guide = await sharp(Buffer.from(images[0]!.base64, 'base64')).metadata();
      calls.push({ prompt, images: images.length, aspect, guideSize: [guide.width!, guide.height!] });
      // Gemini returned a smaller image of the same shape, drawn 5° off and shifted.
      const g = guideGeometry(t, 624, 936);
      const tilt = 5 * Math.PI / 180, len = g.distal.y - g.proximal.y;
      const a = { x: g.proximal.x + 18, y: g.proximal.y + 10 };
      return { mimeType: 'image/png', base64: await limbPng(624, 936, a, { x: a.x - Math.sin(tilt) * len, y: a.y + Math.cos(tilt) * len }, g.halfWidth) };
    }));

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ images: 2, aspect: '2:3', guideSize: [832, 1248] });
    expect(calls[0]!.prompt).toMatch(/upper ring marks the shoulder/);

    const part = result.result.parts[0];
    expect(part).toMatchObject({ part: 'upper_arm_l', ok: true, partDef: { filename: 'upper_arm_l.png', pivot: [0.5, expect.any(Number)] } });
    expect(result.result.spentMicroUsd).toBe(67_000);
    expect(result.result.references).toEqual([front]);

    // The saved part really has its joints where the PartDef says.
    const { data, info } = await sharp(part.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual(part.partDef.size);
    const img = { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
    const m = measureLimbJoints(img, { x: info.width / 2, y: 0 })!;
    expect(Math.abs(m.proximal.x / info.width - part.partDef.pivot[0])).toBeLessThan(0.03);
    expect(Math.abs(m.proximal.y / info.height - part.partDef.pivot[1])).toBeLessThan(0.02);
    expect(Math.abs(m.distal.y / info.height - part.partDef.childAnchor[1])).toBeLessThan(0.02);
    expect(fs.existsSync(part.overlayFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(result.result.runDir, 'report.json'), 'utf8')).parts[0].ok).toBe(true);
  });

  it('retries a rejected attempt with the reason, and reports a part that never passes as failed', async () => {
    const prompts: string[] = [];
    const blob = await limbPng(832, 1248, { x: 416, y: 600 }, { x: 416, y: 650 }, 300);
    const result = await generateRigParts({ character: 'leila', description: 'd', parts: ['forearm_l'], maxAttempts: 2, skipUnderLayer: true }, deps(async prompt => {
      prompts.push(prompt);
      return { mimeType: 'image/png', base64: blob };
    }));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/Previous attempt was rejected: one limb/);
    expect(result.success).toBe(false);
    expect(result.result.parts[0]).toMatchObject({ ok: false });
    expect(result.result.parts[0].attempts).toHaveLength(2);
    expect(result.error).toMatch(/forearm_l: /);
    expect(result.result.spentMicroUsd).toBe(134_000);
  });

  it('a failed request is not retried and costs nothing', async () => {
    const generate = jest.fn(async () => { throw new Error('Google rejected the Gemini API key. Check the key saved in Settings.'); });
    const result = await generateRigParts({ character: 'leila', description: 'd', parts: ['upper_arm_r'], skipUnderLayer: true }, deps(generate));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Google rejected the Gemini API key/);
    expect(result.result.spentMicroUsd).toBe(0);
  });

  it('refuses reference images outside the characters folder, and unknown parts, before any request', async () => {
    const generate = jest.fn();
    const outside = await generateRigParts({ character: 'leila', description: 'd', referenceImages: [path.join(root, 'secret.png')] }, deps(generate));
    expect(outside).toMatchObject({ success: false, error: expect.stringMatching(/must be inside/) });
    const traversal = await generateRigParts({ character: 'leila', description: 'd', referenceImages: ['../secret.png'] }, deps(generate));
    expect(traversal.success).toBe(false);
    const part = await generateRigParts({ character: 'leila', description: 'd', parts: ['tail'], skipUnderLayer: true }, deps(generate));
    expect(part).toMatchObject({ success: false, error: expect.stringMatching(/Unsupported part: tail/) });
    expect(generate).not.toHaveBeenCalled();
  });

  it('a dry run writes guides and prompts and generates nothing', async () => {
    const generate = jest.fn();
    const result = await generateRigParts({ character: 'leila', description: 'd', dryRun: true }, deps(generate));
    expect(generate).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    for (const part of ['upper_arm_l', 'forearm_l']) {
      expect(fs.existsSync(path.join(result.result.runDir, part, 'guide.png'))).toBe(true);
      expect(fs.readFileSync(path.join(result.result.runDir, part, 'prompt.txt'), 'utf8')).toMatch(/placement guide/);
    }
  });
});
