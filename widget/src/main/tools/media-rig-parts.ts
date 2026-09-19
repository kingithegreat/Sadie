/**
 * media_generate_rig_parts — generate cutout-rig limbs whose joints land where
 * the rig attaches them.
 *
 * For each part: draw a guide with the joints marked (rig-part-templates.ts),
 * send it with the character's art to Gemini, cut the magenta ground, measure
 * the real joint centres, snap the art onto the rig's joints, and gate it
 * (rig-part-joints.ts). A rejected attempt is retried with the reason, up to
 * the attempt limit, and never passed off as good.
 *
 * Output goes to a staging folder in HomeBot's data, never into Ancient
 * Pathways: every attempt, the snapped part, a joint overlay to check by eye,
 * and PartDef values for skeleton.py.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveAncientPathwaysDir } from '../ancient-pathways';
import {
  GEMINI_IMAGE_COST_MICRO_USD,
  generateGeminiImageFromImages,
  type GeminiInputImage,
} from '../movie/gemini-image-adapter';
import {
  gateRigPart, keyMagentaGround, measureLimbJoints, snapToJoints,
  type PartCheck, type Point, type RgbaImage,
} from '../movie/rig-part-joints';
import {
  buildRigPartPrompt, GUIDE_ASPECT, guideGeometry, partCanvas, partDefFractions, renderGuide,
  RIG_PART_TEMPLATES, type RigPartTemplate,
} from '../movie/rig-part-templates';

const DEFAULT_PARTS = ['upper_arm_l', 'forearm_l'];
const MAX_ATTEMPTS = 3;
/** Gemini 3.1 Flash Image keeps character consistency across up to 4 character images. */
const MAX_CHARACTER_REFS = 4;

export const mediaGenerateRigPartsDef: ToolDefinition = {
  name: 'media_generate_rig_parts',
  description:
    'Generate separate limb parts (upper arms, forearms) for a 2D cutout animation rig so the joints ' +
    'attach in the right places. Each part is drawn over a guide that marks its joints, then HomeBot ' +
    'measures the real joint centres and snaps the art onto the rig. Parts that cannot be trusted are ' +
    'retried, then reported as failed. Uses Gemini image generation: about US$0.067 per attempt, ' +
    'charged to the saved Gemini key. Saves to a staging folder for review; nothing in Ancient Pathways is changed.',
  category: 'media',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      character: { type: 'string', description: 'Character slug, e.g. "leila". Used for the folder name and to find reference art.' },
      description: { type: 'string', description: 'What the character looks like: clothing, sleeves, skin, outline style.' },
      parts: {
        type: 'array', items: { type: 'string' },
        description: `Parts to make. Supported: ${Object.keys(RIG_PART_TEMPLATES).join(', ')}. Default: ${DEFAULT_PARTS.join(', ')}.`,
      },
      referenceImages: {
        type: 'array', items: { type: 'string' },
        description: 'Up to 4 PNG/JPEG files of the character from the Ancient Pathways characters folder. Default: the character\'s front turnaround.',
      },
      scale: { type: 'number', description: 'Output size multiplier over the rig\'s 1x part size (2-8, default 4). Use the same value for a whole character.' },
      maxAttempts: { type: 'number', description: 'Attempts per part, 1-3 (default 3).' },
      dryRun: { type: 'boolean', description: 'Write the guides and prompts only; no image generation, no cost.' },
    },
    required: ['character', 'description'],
  },
};

export interface RigPartAttempt {
  attempt: number;
  ok: boolean;
  failedChecks: PartCheck[];
  jointErrorPx?: number;
  rawFile: string;
  error?: string;
}

export interface RigPartOutcome {
  part: string;
  ok: boolean;
  file?: string;
  overlayFile?: string;
  partDef?: { filename: string; pivot: [number, number]; childAnchor: [number, number]; size: [number, number] };
  attempts: RigPartAttempt[];
}

export interface RigPartDeps {
  generate: (prompt: string, images: GeminiInputImage[], aspectRatio: string) => Promise<{ base64: string; mimeType: string }>;
  outputRoot: () => string;
  charactersDir: () => string | null;
  now: () => Date;
}

const defaultDeps: RigPartDeps = {
  generate: generateGeminiImageFromImages,
  outputRoot: () => path.join(app.getPath('userData'), 'rig-parts'),
  charactersDir: () => {
    const ap = resolveAncientPathwaysDir();
    return ap ? path.join(ap, 'workspace', 'branding', 'characters') : null;
  },
  now: () => new Date(),
};

async function toRgba(buffer: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

function png(img: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
}

/** The snapped part on grey with the rig's joints ringed, to check by eye. */
async function jointOverlay(img: RgbaImage, joints: Point[]): Promise<Buffer> {
  const rings = joints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="9" fill="none" stroke="#00e000" stroke-width="3"/><circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#00e000"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${rings}</svg>`);
  return sharp({ create: { width: img.width, height: img.height, channels: 4, background: '#8a9099' } })
    .composite([{ input: await png(img) }, { input: svg }]).png().toBuffer();
}

/** Reference images may only come from the Ancient Pathways characters folder. */
function resolveReferences(character: string, requested: unknown, charactersDir: string | null): { files: string[]; error?: string } {
  if (!charactersDir) return { files: [], error: 'Ancient Pathways was not found, so there is no character art to use as a reference.' };
  const root = path.resolve(charactersDir);
  const list = Array.isArray(requested) && requested.length
    ? requested.filter((f): f is string => typeof f === 'string')
    : [path.join(root, character, 'turnaround', 'front.png')];
  if (list.length > MAX_CHARACTER_REFS) return { files: [], error: `Use at most ${MAX_CHARACTER_REFS} reference images.` };
  const files: string[] = [];
  for (const file of list) {
    const full = path.resolve(path.isAbsolute(file) ? file : path.join(root, file));
    if (full !== root && !full.startsWith(root + path.sep)) return { files: [], error: `Reference images must be inside ${root}.` };
    if (!/\.(png|jpe?g)$/i.test(full) || !fs.existsSync(full)) return { files: [], error: `Reference image not found: ${full}` };
    files.push(full);
  }
  return { files };
}

export async function generateRigParts(args: Record<string, any>, deps: RigPartDeps = defaultDeps): Promise<ToolResult> {
  const character = typeof args.character === 'string' ? args.character.trim().toLowerCase() : '';
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (!/^[a-z0-9_-]{1,40}$/.test(character)) return { success: false, error: 'Character must be a short slug: letters, numbers, dashes or underscores.' };
  if (!description) return { success: false, error: 'Describe what the character looks like.' };
  const partIds: string[] = Array.isArray(args.parts) && args.parts.length ? args.parts.map(String) : DEFAULT_PARTS;
  const unknown = partIds.filter(p => !RIG_PART_TEMPLATES[p]);
  if (unknown.length) return { success: false, error: `Unsupported part: ${unknown.join(', ')}. Supported: ${Object.keys(RIG_PART_TEMPLATES).join(', ')}.` };
  const scale = Math.round(Number(args.scale ?? 4));
  if (!(scale >= 2 && scale <= 8)) return { success: false, error: 'Scale must be between 2 and 8.' };
  const maxAttempts = Math.round(Number(args.maxAttempts ?? MAX_ATTEMPTS));
  if (!(maxAttempts >= 1 && maxAttempts <= MAX_ATTEMPTS)) return { success: false, error: `Attempts must be between 1 and ${MAX_ATTEMPTS}.` };

  const refs = resolveReferences(character, args.referenceImages, deps.charactersDir());
  if (refs.error) return { success: false, error: refs.error };

  const stamp = deps.now().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(deps.outputRoot(), character, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const refImages: GeminiInputImage[] = refs.files.map(f => ({
    mimeType: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg',
    base64: fs.readFileSync(f).toString('base64'),
  }));

  const outcomes: RigPartOutcome[] = [];
  let spentMicroUsd = 0;
  for (const partId of partIds) {
    const template: RigPartTemplate = RIG_PART_TEMPLATES[partId]!;
    const partDir = path.join(runDir, partId);
    fs.mkdirSync(partDir, { recursive: true });
    const guidePng = await png(renderGuide(template));
    fs.writeFileSync(path.join(partDir, 'guide.png'), guidePng);
    const canvas = partCanvas(template, scale);
    const outcome: RigPartOutcome = { part: partId, ok: false, attempts: [] };
    outcomes.push(outcome);

    if (args.dryRun) {
      fs.writeFileSync(path.join(partDir, 'prompt.txt'), buildRigPartPrompt(template, description));
      continue;
    }

    let rejection: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const rawFile = path.join(partDir, `attempt-${attempt}.png`);
      const record: RigPartAttempt = { attempt, ok: false, failedChecks: [], rawFile };
      outcome.attempts.push(record);
      let raw: RgbaImage;
      try {
        const prompt = buildRigPartPrompt(template, description, rejection);
        const image = await deps.generate(prompt, [{ mimeType: 'image/png', base64: guidePng.toString('base64') }, ...refImages], GUIDE_ASPECT);
        spentMicroUsd += GEMINI_IMAGE_COST_MICRO_USD;
        const buffer = Buffer.from(image.base64, 'base64');
        fs.writeFileSync(rawFile, buffer);
        raw = await toRgba(buffer);
      } catch (err) {
        record.error = (err as Error).message || String(err);
        // A request that never produced an image will not improve by retrying the same way.
        break;
      }

      // The model may return a different pixel size at the same aspect; the guide scales with it.
      const guide = guideGeometry(template, raw.width, raw.height);
      const { image: cut, residualGroundPx } = keyMagentaGround(raw);
      const measured = measureLimbJoints(cut, guide.proximal);
      if (!measured) {
        record.failedChecks = [{ name: 'one limb', ok: false, detail: 'no part was found on the magenta ground' }];
        rejection = 'no separate part was drawn on the magenta background';
        continue;
      }
      const snap = snapToJoints(cut, measured, canvas, canvas.width, canvas.height);
      const remeasured = measureLimbJoints(snap.image, canvas.proximal);
      const gate = gateRigPart({ measured, guide, residualGroundPx, snap, remeasured, spec: canvas });
      record.failedChecks = gate.checks.filter(c => !c.ok);
      record.jointErrorPx = Number.isFinite(gate.jointErrorPx) ? Math.round(gate.jointErrorPx * 10) / 10 : undefined;
      if (!gate.ok) {
        rejection = record.failedChecks.map(c => `${c.name}: ${c.detail}`).join('; ');
        continue;
      }
      record.ok = true;
      outcome.ok = true;
      outcome.file = path.join(partDir, template.filename);
      outcome.overlayFile = path.join(partDir, `${partId}-joints.png`);
      fs.writeFileSync(outcome.file, await png(snap.image));
      fs.writeFileSync(outcome.overlayFile, await jointOverlay(snap.image, [canvas.proximal, canvas.distal]));
      const fr = partDefFractions(canvas);
      outcome.partDef = { filename: template.filename, pivot: fr.pivot, childAnchor: fr.childAnchor, size: [canvas.width, canvas.height] };
      break;
    }
  }

  const report = { character, scale, runDir, references: refs.files, dryRun: !!args.dryRun, spentMicroUsd, parts: outcomes };
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  const made = outcomes.filter(o => o.ok).length;
  const attempts = outcomes.reduce((n, o) => n + o.attempts.length, 0);
  return {
    success: args.dryRun ? true : made > 0,
    result: {
      ...report,
      message: args.dryRun
        ? `Wrote ${outcomes.length} guide(s) and prompt(s) to ${runDir}. No images were generated.`
        : `${made} of ${outcomes.length} part(s) passed the joint checks after ${attempts} attempt(s) (about US$${(spentMicroUsd / 1e6).toFixed(2)}). Review them in ${runDir}.`,
    },
    ...(args.dryRun || made > 0 ? {} : { error: outcomes.map(o => `${o.part}: ${o.attempts.at(-1)?.error || o.attempts.at(-1)?.failedChecks.map(c => c.detail).join('; ') || 'not made'}`).join(' | ') }),
  };
}

export const mediaGenerateRigPartsHandler: ToolHandler = args => generateRigParts(args);

export const rigPartToolDefs: ToolDefinition[] = [mediaGenerateRigPartsDef];
export const rigPartToolHandlers: Record<string, ToolHandler> = { media_generate_rig_parts: mediaGenerateRigPartsHandler };
