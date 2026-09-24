/**
 * media_generate_rig_parts — cutout-rig limbs whose joints land where the rig
 * attaches them, plus a finished under-layer plate under every socket.
 *
 * Port of draft #368 onto main, with Gemini as the paint engine (not
 * Pollinations). Mechanism: fixed magenta guide with grey capsule + rings at
 * the rig's joint sites → Gemini draws the part → magenta keyed to alpha →
 * joints = centres of the rounded caps on the principal axis → snap onto the
 * part canvas → gate. Under-layer base plate is generated first; extreme-pose
 * reveal QA asserts sockets stay finished art.
 *
 * Output: HomeBot userData/rig-parts staging only. Never writes Ancient Pathways.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveAncientPathwaysDir } from '../ancient-pathways';
import {
  GEMINI_IMAGE_COST_MICRO_USD,
  generateGeminiImageFromImages,
  type GeminiInputImage,
} from '../movie/gemini-image-adapter';
import {
  gateRigPart,
  keyMagentaGround,
  measureLimbJoints,
  snapToJoints,
  type PartCheck,
  type Point,
  type RgbaImage,
} from '../movie/rig-part-joints';
import {
  buildRigPartPrompt,
  GUIDE_ASPECT,
  guideGeometry,
  partCanvas,
  partDefFractions,
  renderGuide,
  RIG_PART_TEMPLATES,
  type RigPartTemplate,
} from '../movie/rig-part-templates';
import {
  buildUnderlayerPrompt,
  extremePoseRevealCheck,
  mouthLandmark,
  renderUnderlayerGuide,
  UNDERLAYER_ASPECT,
  underlayerSockets,
} from '../movie/rig-part-underlayer';

/** Native sharp must stay off the cold-start path — static import hang packaged Electron before ready. */
type SharpFn = typeof import('sharp').default;
let sharpLoader: Promise<SharpFn> | null = null;
function loadSharp(): Promise<SharpFn> {
  if (!sharpLoader) sharpLoader = import('sharp').then((m) => m.default);
  return sharpLoader;
}

function electronApp() {
  // Lazy require so evaluating this module during studio boot never touches Electron bindings.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('electron') as typeof import('electron')).app;
}

const DEFAULT_PARTS = ['upper_arm_l', 'forearm_l'];
const MAX_ATTEMPTS = 3;
const MAX_CHARACTER_REFS = 4;

export const mediaGenerateRigPartsDef: ToolDefinition = {
  name: 'media_generate_rig_parts',
  description:
    'Generate cutout-rig limb parts whose joints land where the rig attaches them, plus a finished ' +
    'under-layer base plate so extreme poses never reveal holes. Uses Gemini (~US$0.067 per attempt) with ' +
    'the saved key. Saves to HomeBot staging for review; does not modify Ancient Pathways.',
  category: 'media',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      character: { type: 'string', description: 'Character slug, e.g. "leila".' },
      description: { type: 'string', description: 'Visual description: clothing, sleeves, skin, outline.' },
      parts: {
        type: 'array', items: { type: 'string' },
        description: `Parts to make. Supported: ${Object.keys(RIG_PART_TEMPLATES).join(', ')}. Default: ${DEFAULT_PARTS.join(', ')}.`,
      },
      referenceImages: {
        type: 'array', items: { type: 'string' },
        description: 'Up to 4 PNG/JPEG files from the Ancient Pathways characters folder.',
      },
      scale: { type: 'number', description: 'Output size multiplier (2-8, default 4).' },
      maxAttempts: { type: 'number', description: 'Attempts per part, 1-3 (default 3).' },
      dryRun: { type: 'boolean', description: 'Write guides/prompts only; no generation, no cost.' },
      skipUnderLayer: { type: 'boolean', description: 'Skip base-plate under-layer (default false).' },
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
  committedJoints?: { proximal: Point; distal: Point };
  attempts: RigPartAttempt[];
}

export interface UnderLayerOutcome {
  ok: boolean;
  file?: string;
  mouthLandmark?: Point;
  revealChecks?: Array<{ part: string; ok: boolean; detail: string }>;
  error?: string;
}

export interface RigPartDeps {
  generate: (prompt: string, images: GeminiInputImage[], aspectRatio: string) => Promise<{ base64: string; mimeType: string }>;
  outputRoot: () => string;
  charactersDir: () => string | null;
  now: () => Date;
}

const defaultDeps: RigPartDeps = {
  generate: generateGeminiImageFromImages,
  outputRoot: () => path.join(electronApp().getPath('userData'), 'rig-parts'),
  charactersDir: () => {
    const ap = resolveAncientPathwaysDir();
    return ap ? path.join(ap, 'workspace', 'branding', 'characters') : null;
  },
  now: () => new Date(),
};

async function toRgba(buffer: Buffer): Promise<RgbaImage> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

async function png(img: RgbaImage): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toBuffer();
}

async function jointOverlay(img: RgbaImage, joints: Point[]): Promise<Buffer> {
  const sharp = await loadSharp();
  const rings = joints
    .map(p => `<circle cx="${p.x}" cy="${p.y}" r="9" fill="none" stroke="#00e000" stroke-width="3"/><circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#00e000"/>`)
    .join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${rings}</svg>`);
  return sharp({ create: { width: img.width, height: img.height, channels: 4, background: '#8a9099' } })
    .composite([{ input: await png(img) }, { input: svg }])
    .png()
    .toBuffer();
}

function resolveReferences(character: string, requested: unknown, charactersDir: string | null): { files: string[]; error?: string } {
  if (!charactersDir) return { files: [], error: 'Ancient Pathways was not found, so there is no character art to use as a reference. Reading AP is optional for dryRun.' };
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
  const dryRun = Boolean(args.dryRun);
  const skipUnderLayer = Boolean(args.skipUnderLayer);

  const refs = resolveReferences(character, args.referenceImages ?? args.referenceImages, deps.charactersDir());
  if (refs.error && !dryRun) return { success: false, error: refs.error };

  const stamp = deps.now().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(deps.outputRoot(), character, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const refImages: GeminiInputImage[] = (refs.files || []).map(f => ({
    mimeType: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg',
    base64: fs.readFileSync(f).toString('base64'),
  }));

  let spentMicroUsd = 0;
  const underLayer: UnderLayerOutcome = { ok: skipUnderLayer, mouthLandmark: mouthLandmark() };
  let underLayerImage: RgbaImage | null = null;

  if (!skipUnderLayer) {
    const underDir = path.join(runDir, 'underlayer');
    fs.mkdirSync(underDir, { recursive: true });
    const guidePng = await png(renderUnderlayerGuide());
    fs.writeFileSync(path.join(underDir, 'guide.png'), guidePng);
    fs.writeFileSync(path.join(underDir, 'sockets.json'), JSON.stringify({ sockets: underlayerSockets(), mouthLandmark: underLayer.mouthLandmark }, null, 2));
    if (dryRun) {
      fs.writeFileSync(path.join(underDir, 'prompt.txt'), buildUnderlayerPrompt(description));
      underLayer.ok = true;
    } else {
      try {
        const image = await deps.generate(
          buildUnderlayerPrompt(description),
          [{ mimeType: 'image/png', base64: guidePng.toString('base64') }, ...refImages],
          UNDERLAYER_ASPECT,
        );
        spentMicroUsd += GEMINI_IMAGE_COST_MICRO_USD;
        const buffer = Buffer.from(image.base64, 'base64');
        fs.writeFileSync(path.join(underDir, 'raw.png'), buffer);
        const raw = await toRgba(buffer);
        const keyed = keyMagentaGround(raw);
        underLayerImage = keyed.image;
        underLayer.file = path.join(underDir, 'base-plate.png');
        fs.writeFileSync(underLayer.file, await png(keyed.image));
        underLayer.ok = true;
      } catch (err) {
        underLayer.error = (err as Error).message || String(err);
      }
    }
  }

  const outcomes: RigPartOutcome[] = [];
  for (const partId of partIds) {
    const template: RigPartTemplate = RIG_PART_TEMPLATES[partId]!;
    const partDir = path.join(runDir, partId);
    fs.mkdirSync(partDir, { recursive: true });
    const guideImg = renderGuide(template);
    const guidePng = await png(guideImg);
    fs.writeFileSync(path.join(partDir, 'guide.png'), guidePng);
    const canvas = partCanvas(template, scale);
    const guideOnCanvas = guideGeometry(template);
    fs.writeFileSync(path.join(partDir, 'committed-joints.json'), JSON.stringify({
      guide: guideOnCanvas,
      canvas: { proximal: canvas.proximal, distal: canvas.distal, width: canvas.width, height: canvas.height },
      mechanism: 'guide-ring centres / rounded-cap centres on principal axis',
    }, null, 2));
    const outcome: RigPartOutcome = { part: partId, ok: false, attempts: [], committedJoints: { proximal: canvas.proximal, distal: canvas.distal } };
    outcomes.push(outcome);

    if (dryRun) {
      fs.writeFileSync(path.join(partDir, 'prompt.txt'), buildRigPartPrompt(template, description));
      continue;
    }
    if (!underLayer.ok && !skipUnderLayer) continue;

    let rejection: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const rawFile = path.join(partDir, `attempt-${attempt}.png`);
      const record: RigPartAttempt = { attempt, ok: false, failedChecks: [], rawFile };
      outcome.attempts.push(record);
      let raw: RgbaImage;
      try {
        const image = await deps.generate(
          buildRigPartPrompt(template, description, rejection),
          [{ mimeType: 'image/png', base64: guidePng.toString('base64') }, ...refImages],
          GUIDE_ASPECT,
        );
        spentMicroUsd += GEMINI_IMAGE_COST_MICRO_USD;
        const buffer = Buffer.from(image.base64, 'base64');
        fs.writeFileSync(rawFile, buffer);
        raw = await toRgba(buffer);
      } catch (err) {
        record.error = (err as Error).message || String(err);
        break;
      }

      const guide = guideGeometry(template, raw.width, raw.height);
      const keyed = keyMagentaGround(raw);
      const measured = measureLimbJoints(keyed.image, guide.proximal);
      if (!measured) {
        record.failedChecks = [{ name: 'one limb', ok: false, detail: 'no part was found on the magenta ground' }];
        rejection = 'no separate part was drawn on the magenta background';
        continue;
      }
      const snap = snapToJoints(
        keyed.image,
        { proximal: measured.proximal, distal: measured.distal },
        { proximal: canvas.proximal, distal: canvas.distal },
        canvas.width,
        canvas.height,
      );
      const remeasured = measureLimbJoints(snap.image, canvas.proximal);
      const gate = gateRigPart({
        measured,
        guide: { proximal: guide.proximal, distal: guide.distal, halfWidth: guide.halfWidth },
        residualGroundPx: keyed.residualGroundPx,
        snap,
        remeasured,
        spec: { proximal: canvas.proximal, distal: canvas.distal },
      });
      record.failedChecks = gate.checks.filter(c => !c.ok);
      record.jointErrorPx = Number.isFinite(gate.jointErrorPx) ? Math.round(gate.jointErrorPx * 10) / 10 : undefined;
      if (!gate.ok) {
        rejection = record.failedChecks.map(c => `${c.name}: ${c.detail}`).join('; ');
        continue;
      }

      if (underLayerImage) {
        const reveal = extremePoseRevealCheck(underLayerImage, null, underlayerSockets());
        underLayer.revealChecks = underLayer.revealChecks ?? [];
        underLayer.revealChecks.push({ part: partId, ok: reveal.ok, detail: reveal.detail });
        if (!reveal.ok) {
          record.failedChecks.push({ name: 'under-layer reveal', ok: false, detail: reveal.detail });
          rejection = reveal.detail;
          continue;
        }
      }

      record.ok = true;
      outcome.ok = true;
      outcome.file = path.join(partDir, template.filename);
      outcome.overlayFile = path.join(partDir, `${partId}-joints.png`);
      fs.writeFileSync(outcome.file, await png(snap.image));
      fs.writeFileSync(outcome.overlayFile, await jointOverlay(snap.image, [canvas.proximal, canvas.distal]));
      const fr = partDefFractions(canvas);
      outcome.partDef = { filename: template.filename, pivot: fr.pivot, childAnchor: fr.childAnchor, size: [canvas.width, canvas.height] };
      fs.writeFileSync(path.join(partDir, 'part-def.json'), JSON.stringify({
        ...outcome.partDef,
        measuredJointsPx: remeasured ? { proximal: remeasured.proximal, distal: remeasured.distal } : null,
        committedJointsPx: { proximal: canvas.proximal, distal: canvas.distal },
        jointErrorPx: record.jointErrorPx,
        toleranceNote: 'jointErrorPx must be within ~3% of bone length (gateRigPart)',
      }, null, 2));
      break;
    }
  }

  const report = {
    character,
    scale,
    runDir,
    references: refs.files,
    dryRun,
    spentMicroUsd,
    underLayer,
    parts: outcomes,
    patternSource: 'PR #368 media_generate_rig_parts / rig-part-templates / joint measure (guide-ring + cap centres); Gemini paint engine; under-layer base plate',
    mechanism: 'fixed guide rings → measured rounded-cap centres on principal axis → snap to rig joints; base plate under every socket',
  };
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  const made = outcomes.filter(o => o.ok).length;
  const attempts = outcomes.reduce((n, o) => n + o.attempts.length, 0);
  const revealBad = (underLayer.revealChecks ?? []).some(c => !c.ok);
  const underOk = skipUnderLayer || (underLayer.ok && !revealBad);
  const ok = dryRun ? true : made > 0 && underOk;
  return {
    success: ok,
    result: {
      ...report,
      message: dryRun
        ? `Wrote ${outcomes.length} guide(s) and prompt(s) to ${runDir}. No images were generated.`
        : `${made} of ${outcomes.length} part(s) passed joint + under-layer checks after ${attempts} attempt(s) (about US$${(spentMicroUsd / 1e6).toFixed(2)}). Staging: ${runDir}.`,
    },
    ...(ok ? {} : {
      error: [
        ...outcomes.map(o => `${o.part}: ${o.attempts.at(-1)?.error || o.attempts.at(-1)?.failedChecks.map(c => c.detail).join('; ') || 'not made'}`),
        ...(underLayer.error ? [`under-layer: ${underLayer.error}`] : []),
        ...((underLayer.revealChecks ?? []).filter(c => !c.ok).map(c => `under-layer ${c.part}: ${c.detail}`)),
      ].join(' | '),
    }),
  };
}

export const mediaGenerateRigPartsHandler: ToolHandler = (args) => generateRigParts(args);

export const rigPartToolDefs: ToolDefinition[] = [mediaGenerateRigPartsDef];
export const rigPartToolHandlers: Record<string, ToolHandler> = {
  media_generate_rig_parts: mediaGenerateRigPartsHandler,
};
