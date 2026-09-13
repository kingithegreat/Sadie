/** Missing fields on existing projects retain the historical caption behavior. */
export function resolveBurnSubtitles(value: unknown, fallback = true): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('Choose whether captions are on or off.');
  return value;
}

/** Review and approved exports must be sent back for revision before editing. */
export function canEditMediaOutput(state: string): boolean {
  return ['idea', 'researching', 'script_draft', 'script_qa', 'media_production',
    'needs_revision', 'failed', 'blocked'].includes(state);
}

/** Older bridge jobs identify their renderer in the existing stage history. */
export function hasExternalMediaRenderer(job: { externalRenderer?: string; history?: Array<{ note?: string }> }): boolean {
  return !!job.externalRenderer || !!job.history?.some(event =>
    event.note === 'Ancient Pathways pipeline runs its own stages internally' ||
    event.note === 'Showrunner runs its own stages internally');
}

export type StudioAspectRatio = '16:9' | '9:16' | '1:1';
export interface StudioOutputVariant {
  id: 'landscape' | 'portrait' | 'square';
  aspectRatio: StudioAspectRatio;
  width: number;
  height: number;
  fps: 30;
  framing: { mode: 'fit' | 'crop'; x: number; y: number };
}

export interface StudioOutputSpec {
  schemaVersion: 1;
  durationIntent: 'short' | 'long';
  variants: StudioOutputVariant[];
}

export interface StudioRenderedOutput {
  exportId: string;
  filename: string;
  createdAt: string;
  sourceSavedAt: string | null;
  durationSeconds: number;
  burnSubtitles: boolean;
  outputSpec: StudioOutputSpec;
  /** Absent on older exports: never infer provenance from a filename or mtime. */
  sourceRevision?: string;
  fileSizeBytes?: number;
  sha256?: string;
  sceneId?: string;
  motion?: boolean;
  /** Ordinary-job input plates frozen for this exact export; absent on older files. */
  scenePaths?: Array<string | null>;
}

export interface StudioExportAttempt {
  id: string;
  status: 'preparing' | 'rendering' | 'validating' | 'succeeded' | 'failed' | 'interrupted';
  sourceRevision: string | null;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  exportId?: string;
  sceneId?: string;
}

export interface StudioExportState {
  sourceRevision: string | null;
  sceneRevisions?: Record<string, string>;
  sourceSavedAt: string | null;
  latestAttempt?: StudioExportAttempt;
  outputs: Array<StudioRenderedOutput & { moviePath: string }>;
  /** Real files without trusted sidecars remain reachable, with unknown provenance. */
  untrackedOutputs?: Array<{ filename: string; moviePath: string }>;
  warning?: string;
}

const outputPresets = {
  '16:9': { id: 'landscape', width: 1920, height: 1080 },
  '9:16': { id: 'portrait', width: 1080, height: 1920 },
  '1:1': { id: 'square', width: 1080, height: 1080 },
} as const;

/** Strict main-process validation; a renderer request is not trusted metadata. */
export function resolveStudioOutputVariant(value: unknown): StudioOutputVariant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a supported output format.');
  const v = value as Record<string, unknown>;
  if (v.aspectRatio !== '16:9' && v.aspectRatio !== '9:16' && v.aspectRatio !== '1:1') {
    throw new Error('Choose Landscape, Portrait or Square.');
  }
  const preset = outputPresets[v.aspectRatio];
  const dimensionsMatch = [1, 2 / 3].some(scale =>
    v.width === Math.round(preset.width * scale) && v.height === Math.round(preset.height * scale));
  if (!dimensionsMatch) throw new Error('Choose a supported 720p or 1080p size for this shape.');
  if (v.id !== preset.id) throw new Error('The output identity must match its shape.');
  if (v.fps !== 30) throw new Error('Studio output currently supports 30 frames per second.');
  const framing = v.framing as Record<string, unknown> | undefined;
  if (!framing || (framing.mode !== 'fit' && framing.mode !== 'crop')) {
    throw new Error('Choose Fit entire image or Crop to fill.');
  }
  for (const coordinate of [framing.x, framing.y]) {
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1) {
      throw new Error('Keep the crop position between 0 and 1.');
    }
  }
  return {
    id: preset.id, aspectRatio: v.aspectRatio, width: v.width as number, height: v.height as number,
    fps: 30, framing: { mode: framing.mode, x: framing.x as number, y: framing.y as number },
  };
}

/** New projects use landscape/fit; an explicit legacy ratio retains old crop behavior. */
export function resolveStudioOutputSpec(
  value: unknown,
  durationIntent: 'short' | 'long' = 'short',
  legacyRatio?: StudioAspectRatio,
): StudioOutputSpec {
  if (value === undefined) {
    return createStudioOutputSpec(legacyRatio ?? '16:9', durationIntent, '1080p', legacyRatio ? 'crop' : 'fit');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose valid output settings.');
  const spec = value as Record<string, unknown>;
  if (spec.schemaVersion !== 1) throw new Error('This output-settings version is not supported.');
  if (spec.durationIntent !== 'short' && spec.durationIntent !== 'long') throw new Error('Choose short or long content length.');
  if (!Array.isArray(spec.variants) || spec.variants.length !== 1) {
    throw new Error('Choose one output for this export. Multi-output rendering is not available yet.');
  }
  return { schemaVersion: 1, durationIntent: spec.durationIntent, variants: spec.variants.map(resolveStudioOutputVariant) };
}

export function createStudioOutputSpec(
  aspectRatio: StudioAspectRatio = '16:9',
  durationIntent: 'short' | 'long' = 'short',
  resolution: '720p' | '1080p' = '1080p',
  mode: 'fit' | 'crop' = 'fit',
): StudioOutputSpec {
  const preset = outputPresets[aspectRatio];
  if (!preset || (resolution !== '720p' && resolution !== '1080p')) throw new Error('Choose a supported output format.');
  const scale = resolution === '720p' ? 2 / 3 : 1;
  return resolveStudioOutputSpec({
    schemaVersion: 1, durationIntent,
    variants: [{ ...preset, aspectRatio, width: Math.round(preset.width * scale), height: Math.round(preset.height * scale),
      fps: 30, framing: { mode, x: 0.5, y: 0.5 } }],
  });
}
