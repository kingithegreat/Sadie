/** Persisted source/attempt identity, separate from the last successful movie. */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { getSettings } from '../config-manager';
import { assembleStoryboardScenes, type AssembledScene } from './storyboard-assembly';
import { isCustomCaptionStyle, resolveCaptionStyle } from '../../shared/caption-style';
import { resolveBurnSubtitles, resolveStudioOutputSpec, readStudioExportAttempt, type StudioExportAttempt, type StudioExportState,
  type StudioRenderedOutput } from '../../shared/media-output';

const activeAttempts = new Map<string, string>();
const activeDirectories = new Map<string, string>();
const key = (dir: string) => fs.realpathSync(dir).toLowerCase();

/** Stream actual bytes, not timestamps (replaced files can retain their mtime). */
export async function storyboardFileDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** No settings secrets enter the revision. Freeze the requested voice engine per export. */
export function storyboardNarrationEngine(): 'edge' | 'kokoro' {
  try { if (getSettings().narrationEngine === 'kokoro') return 'kokoro'; } catch { /* Same default as the voice adapter; its privacy guard still applies. */ }
  return 'edge';
}

export async function storyboardSourceRevision(
  scenes: AssembledScene[], meta: Record<string, any>,
  options: { sceneId?: string; motion?: boolean; engine?: 'edge' | 'kokoro' } = {},
): Promise<string> {
  const sourceScenes = options.sceneId ? scenes.filter(scene => scene.sceneId === options.sceneId) : scenes;
  const inputs = [];
  for (const scene of sourceScenes) {
    const shots = [];
    for (const shot of scene.shots) {
      let frame = 'missing';
      if (shot.frameImagePath) {
        try { frame = await storyboardFileDigest(shot.frameImagePath); } catch { frame = 'unreadable'; }
      }
      shots.push({ shotId: shot.shotId, prompt: shot.prompt, framing: shot.framing, lens: shot.lens,
        movement: shot.movement, durationSec: shot.durationSec, narration: shot.narration, frame,
        // Only a real transition joins identity, so boards of cuts keep their
        // existing exports current.
        ...(shot.transition && shot.transition !== 'cut'
          ? { transition: shot.transition, transitionSec: shot.transitionSec ?? null } : {}),
        // A title card changes the picture, so it changes identity — but only
        // when there is one, so exports made before cards existed stay current.
        ...(shot.textCard ? { textCard: shot.textCard } : {}) });
    }
    inputs.push({ sceneId: scene.sceneId, shots });
  }
  const narrated = sourceScenes.some(scene => scene.shots.some(shot => !!shot.narration?.trim()));
  // Operational fields (updatedAt, attempt, export pointer) intentionally do not affect content identity.
  return createHash('sha256').update(JSON.stringify({ schema: 'storyboard-source-1', scenes: inputs,
    outputSpec: meta.outputSpec === undefined ? 'legacy-1080p-crop' : resolveStudioOutputSpec(meta.outputSpec),
    burnSubtitles: resolveBurnSubtitles(meta.burnSubtitles), motion: options.motion !== false,
    // Only a non-default style joins the identity, so exports made before caption styles existed stay current.
    ...(isCustomCaptionStyle(meta.captionStyle) ? { captionStyle: resolveCaptionStyle(meta.captionStyle) } : {}),
    narrationEngine: narrated ? options.engine ?? storyboardNarrationEngine() : null,
  })).digest('hex');
}

export function updateStoryboardExportMeta(projectDir: string, patch: Record<string, unknown>): void {
  const file = path.join(projectDir, 'project.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const staged = `${file}.${randomUUID()}.saving`;
  try {
    fs.writeFileSync(staged, JSON.stringify({ ...current, ...patch }, null, 2));
    fs.renameSync(staged, file);
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
}

export function beginStoryboardExport(projectDir: string, sceneId?: string): StudioExportAttempt {
  const identity = key(projectDir);
  if (activeAttempts.has(identity)) throw new Error('This storyboard is already rendering. Wait for that attempt to finish.');
  const attempt: StudioExportAttempt = { id: randomUUID(), status: 'preparing', sourceRevision: null,
    startedAt: new Date().toISOString(), ...(sceneId ? { sceneId } : {}) };
  updateStoryboardExportMeta(projectDir, { latestExportAttempt: attempt });
  activeAttempts.set(identity, attempt.id);
  activeDirectories.set(path.resolve(projectDir).toLowerCase(), identity);
  return attempt;
}

export function recordStoryboardAttempt(projectDir: string, attempt: StudioExportAttempt): void {
  const file = path.join(projectDir, 'project.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  updateStoryboardExportMeta(projectDir, { latestExportAttempt: attempt,
    ...(attempt.variantId ? { variantExportAttempts: { ...current.variantExportAttempts, [attempt.variantId]: attempt } } : {}) });
}

export function endStoryboardExport(projectDir: string): void {
  const directory = path.resolve(projectDir).toLowerCase();
  const identity = activeDirectories.get(directory);
  if (identity) activeAttempts.delete(identity);
  activeDirectories.delete(directory);
}

/** A metadata path is not authority to open a different directory or a symlink. */
export function resolveStoryboardExportPath(projectDir: string, filename: unknown): string | null {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.mp4$/.test(filename)) return null;
  try {
    const moviePath = path.join(projectDir, 'renders', filename);
    const stat = fs.lstatSync(moviePath);
    const expected = path.join(fs.realpathSync(projectDir), 'renders', filename);
    return stat.isFile() && stat.size > 0 && fs.realpathSync(moviePath) === expected ? moviePath : null;
  } catch { return null; }
}

export async function readStoryboardExportState(projectDir: string, meta: Record<string, any>, scenes?: AssembledScene[]): Promise<StudioExportState> {
  const warnings: string[] = [];
  const savedAttempt = meta.latestExportAttempt;
  let latestAttempt: StudioExportAttempt | undefined;
  if (savedAttempt !== undefined) {
    latestAttempt = readStudioExportAttempt(savedAttempt);
    if (!latestAttempt) warnings.push('The latest attempt record is unreadable. Its status is unknown.');
  }
  if (latestAttempt && ['preparing', 'rendering', 'validating'].includes(latestAttempt.status) &&
      activeAttempts.get(key(projectDir)) !== (latestAttempt.batchId ?? latestAttempt.id)) {
    latestAttempt = { ...latestAttempt, status: 'interrupted', finishedAt: new Date().toISOString(),
      error: 'The app stopped before this export finished. The previous successful export has been kept. Render again when ready.' };
    recordStoryboardAttempt(projectDir, latestAttempt);
  }
  const outputs: StudioExportState['outputs'] = [];
  const renders = path.join(projectDir, 'renders');
  if (fs.existsSync(renders)) {
    for (const name of fs.readdirSync(renders).filter(name => name.endsWith('.mp4.json'))) {
      try {
        const sidecar = path.join(renders, name);
        if (fs.realpathSync(sidecar) !== path.join(fs.realpathSync(projectDir), 'renders', name)) throw new Error('Invalid metadata path');
        const data: StudioRenderedOutput = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
        const moviePath = resolveStoryboardExportPath(projectDir, data.filename);
        if (!moviePath || `${data.filename}.json` !== name || typeof data.exportId !== 'string' || !data.outputSpec ||
            typeof data.burnSubtitles !== 'boolean' || !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0 ||
            typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) {
          throw new Error('Invalid export record');
        }
        outputs.push({ exportId: data.exportId, filename: data.filename, createdAt: data.createdAt,
          durationSeconds: data.durationSeconds, burnSubtitles: data.burnSubtitles,
          sourceSavedAt: typeof data.sourceSavedAt === 'string' ? data.sourceSavedAt : null,
          sceneId: typeof data.sceneId === 'string' ? data.sceneId : undefined,
          motion: typeof data.motion === 'boolean' ? data.motion : undefined,
          sha256: typeof data.sha256 === 'string' && /^[a-f0-9]{64}$/.test(data.sha256) ? data.sha256 : undefined,
          outputSpec: resolveStudioOutputSpec(data.outputSpec),
          sourceRevision: typeof data.sourceRevision === 'string' && /^[a-f0-9]{64}$/.test(data.sourceRevision) ? data.sourceRevision : undefined,
          fileSizeBytes: fs.statSync(moviePath).size, moviePath });
      } catch { warnings.push('Some export records are missing or unreadable. No files were removed.'); }
    }
  }
  let sourceRevision: string | null = null;
  const untrackedOutputs = fs.existsSync(renders) ? fs.readdirSync(renders).flatMap(filename => {
    if (outputs.some(output => output.filename === filename)) return [];
    const moviePath = resolveStoryboardExportPath(projectDir, filename);
    return moviePath ? [{ filename, moviePath }] : [];
  }) : [];
  const sceneRevisions: Record<string, string> = Object.create(null);
  const variantRevisions: StudioExportState['variantRevisions'] = {};
  const sceneVariantRevisions: NonNullable<StudioExportState['sceneVariantRevisions']> = Object.create(null);
  try {
    const savedScenes = scenes ?? assembleStoryboardScenes(projectDir);
    sourceRevision = await storyboardSourceRevision(savedScenes, meta);
    if (meta.outputSpec !== undefined) {
      const spec = resolveStudioOutputSpec(meta.outputSpec);
      for (const variant of spec.variants) {
        variantRevisions[variant.id] = await storyboardSourceRevision(savedScenes, { ...meta, outputSpec: { ...spec, variants: [variant] } });
      }
    }
    for (const sceneId of new Set(outputs.map(output => output.sceneId).filter((id): id is string => !!id))) {
      if (savedScenes.some(scene => scene.sceneId === sceneId)) sceneRevisions[sceneId] = await storyboardSourceRevision(savedScenes, meta, { sceneId });
      if (meta.outputSpec !== undefined && savedScenes.some(scene => scene.sceneId === sceneId)) {
        const spec = resolveStudioOutputSpec(meta.outputSpec);
        sceneVariantRevisions[sceneId] = {};
        for (const variant of spec.variants) sceneVariantRevisions[sceneId][variant.id] =
          await storyboardSourceRevision(savedScenes, { ...meta, outputSpec: { ...spec, variants: [variant] } }, { sceneId });
      }
    }
  }
  catch { warnings.push('The current source revision could not be verified.'); }
  const variantAttempts: NonNullable<StudioExportState['variantAttempts']> = {};
  for (const id of ['landscape', 'portrait', 'square'] as const) {
    const saved = readStudioExportAttempt(meta.variantExportAttempts?.[id]);
    if (!saved || saved.variantId !== id) continue;
    variantAttempts[id] = saved;
    if (['preparing', 'rendering', 'validating'].includes(saved.status) && !activeAttempts.has(key(projectDir))) {
      variantAttempts[id] = { ...saved, status: 'interrupted', finishedAt: new Date().toISOString(),
        error: 'The app stopped before this format finished. Other successful formats are kept.' };
    }
  }
  if (JSON.stringify(variantAttempts) !== JSON.stringify(meta.variantExportAttempts ?? {})) updateStoryboardExportMeta(projectDir, { variantExportAttempts: variantAttempts });
  return { sourceRevision, sceneRevisions, variantRevisions, sceneVariantRevisions, variantAttempts,
    sourceSavedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : null, latestAttempt,
    outputs: outputs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), untrackedOutputs,
    ...(warnings.length ? { warning: [...new Set(warnings)].join(' ') } : {}) };
}
