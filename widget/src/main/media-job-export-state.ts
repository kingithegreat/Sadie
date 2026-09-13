/** Ordinary-job provenance. Files without evidence stay reachable, but Unknown. */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { MediaJob } from './media-studio';
import { hasExternalMediaRenderer, resolveBurnSubtitles, resolveStudioOutputSpec, readStudioExportAttempt,
  type StudioExportState, type StudioRenderedOutput } from '../shared/media-output';

export const mediaScriptDigest = (script: string) => createHash('sha256').update(script).digest('hex');

export async function mediaFileDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function mediaJobSourceRevision(job: MediaJob, inputs = job.renderInputs): Promise<string | null> {
  if (!inputs || hasExternalMediaRenderer(job)) return null;
  // Old narration has no proof of which script it spoke. Do not invent that link.
  if (job.script && !job.narrationScriptHash) return null;
  const digest = async (file: string | null | undefined) => file ? mediaFileDigest(file) : null;
  try {
    const content = {
      schema: 'media-job-source-1', title: job.title, script: job.script ?? null, narrationScriptHash: job.narrationScriptHash ?? null,
      outputSpec: resolveStudioOutputSpec(job.outputSpec, job.format, job.format === 'long' ? '16:9' : '9:16'),
      burnSubtitles: resolveBurnSubtitles(job.burnSubtitles), durationSeconds: job.durationSeconds ?? null,
      audio: await digest(job.narrationPath), captions: await digest(job.captionsPath),
      image: await digest(inputs.imagePath), scenes: await Promise.all(inputs.scenePaths.map(digest)),
      music: await digest(inputs.musicPath), zoom: inputs.zoom, visuals: inputs.visuals, style: inputs.style ?? null,
    };
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
  } catch { return null; }
}

/** Geometry/caption display changes do not require new narration or scene art. */
export async function mediaJobInputRevision(job: MediaJob, inputs = job.renderInputs): Promise<string | null> {
  return mediaJobSourceRevision({ ...job, outputSpec: undefined, burnSubtitles: true }, inputs);
}

/** Review verifies current bytes and source again, not a cached renderer label. */
export async function assertMediaJobReviewable(job: MediaJob, expectedRenderPath?: string): Promise<void> {
  if (job.perExportReview || job.outputSpec?.variants.length === 2) {
    throw new Error('Review each exported format separately, using its saved movie review entry.');
  }
  if (expectedRenderPath !== undefined && expectedRenderPath !== job.renderPath) {
    throw new Error('The current movie changed. Select and watch that export before approving it.');
  }
  if (job.latestExportAttempt && job.latestExportAttempt.status !== 'succeeded') {
    throw new Error('The latest export did not finish successfully. Render and check the current movie before review.');
  }
  const output = job.renderedOutput;
  if (output?.sha256 && (!job.renderPath || await mediaFileDigest(job.renderPath) !== output.sha256)) {
    throw new Error('The movie changed after export. Render and check it again before review.');
  }
  // Storyboard review jobs are immutable per-export records, not ordinary editable jobs.
  if ((job.renderInputs || job.latestExportAttempt) && output?.sourceRevision && await mediaJobSourceRevision(job) !== output.sourceRevision) {
    throw new Error('The saved source changed after export. Render this revision before review.');
  }
}

/** The immutable snapshot is private to one attempt, including generated scenes. */
export function snapshotMediaFile(file: string, dir: string, name: string): string {
  const destination = path.join(dir, `${name}${path.extname(file)}`);
  fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
  return destination;
}

function resolveJobMovie(dir: string, filename: unknown): string | null {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.mp4$/.test(filename) ||
      filename.includes('.rejected.') || filename.includes('.rendering-')) return null;
  try {
    const candidate = path.join(dir, filename);
    const stat = fs.lstatSync(candidate);
    return stat.isFile() && stat.size > 0 && fs.realpathSync(candidate) === path.join(fs.realpathSync(dir), filename)
      ? candidate : null;
  } catch { return null; }
}

export async function readMediaJobExportState(job: MediaJob, dir: string): Promise<StudioExportState> {
  const outputs: StudioExportState['outputs'] = [];
  const warnings: string[] = [];
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const candidates: Array<{ data: StudioRenderedOutput; moviePath: string }> = [];
  for (const name of names.filter(name => name.endsWith('.mp4.json'))) {
    try {
      const file = path.join(dir, name);
      if (fs.realpathSync(file) !== path.join(fs.realpathSync(dir), name)) throw new Error('Invalid metadata path');
      const data: StudioRenderedOutput = JSON.parse(fs.readFileSync(file, 'utf8'));
      const moviePath = resolveJobMovie(dir, data.filename);
      if (!moviePath || name !== `${data.filename}.json`) throw new Error('Invalid export metadata path');
      candidates.push({ data, moviePath });
    } catch { warnings.push('Some export records are missing or unreadable. No files were removed.'); }
  }
  // A storyboard review job points outside media-assets to ONE immutable export.
  // Retain its verified metadata, without scanning that other project's history
  // or claiming the ordinary-job source algorithm can compare its current board.
  if (job.renderedOutput && job.renderPath && !candidates.some(item => item.moviePath === job.renderPath)) {
    try {
      if (/\.rejected\.|\.rendering-/.test(path.basename(job.renderPath)) ||
          path.basename(job.renderPath) !== job.renderedOutput.filename || !fs.lstatSync(job.renderPath).isFile() ||
          fs.realpathSync(job.renderPath) !== path.resolve(job.renderPath)) throw new Error('Invalid review movie path');
      candidates.push({ data: job.renderedOutput, moviePath: job.renderPath });
    } catch { warnings.push('The saved review movie is missing or unreadable. No files were changed.'); }
  }
  for (const { data, moviePath } of candidates) {
    try {
      if (typeof data.exportId !== 'string' || !data.outputSpec ||
          typeof data.burnSubtitles !== 'boolean' || !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0 ||
          typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('Invalid export metadata');
      const verified = typeof data.sha256 === 'string' && /^[a-f0-9]{64}$/.test(data.sha256) &&
        data.sha256 === await mediaFileDigest(moviePath);
      if (!verified) {
        warnings.push('An older or changed movie cannot be verified against its export record. Its source revision is Unknown.');
        continue;
      }
      outputs.push({ exportId: data.exportId, filename: data.filename, createdAt: data.createdAt,
        sourceSavedAt: typeof data.sourceSavedAt === 'string' ? data.sourceSavedAt : null,
        durationSeconds: data.durationSeconds, burnSubtitles: data.burnSubtitles,
        outputSpec: resolveStudioOutputSpec(data.outputSpec), moviePath, fileSizeBytes: fs.statSync(moviePath).size,
        ...(Array.isArray(data.scenePaths) && data.scenePaths.every(file => file === null || typeof file === 'string') ? { scenePaths: data.scenePaths } : {}),
        ...(verified ? { sha256: data.sha256, sourceRevision: typeof data.sourceRevision === 'string' && /^[a-f0-9]{64}$/.test(data.sourceRevision) ? data.sourceRevision : undefined } : {}),
      });
    } catch { warnings.push('Some export records are missing or unreadable. No files were removed.'); }
  }
  const untrackedOutputs = names.flatMap(filename => {
    const moviePath = resolveJobMovie(dir, filename);
    return moviePath && !outputs.some(output => output.moviePath === moviePath) ? [{ filename, moviePath }] : [];
  });
  // External/imported movies are not scanned or assigned HomeBot provenance.
  if (job.renderPath && !outputs.some(output => output.moviePath === job.renderPath) &&
      !untrackedOutputs.some(output => output.moviePath === job.renderPath)) {
    untrackedOutputs.push({ filename: path.basename(job.renderPath), moviePath: job.renderPath });
  }
  const variantRevisions: StudioExportState['variantRevisions'] = {};
  try {
    const spec = resolveStudioOutputSpec(job.outputSpec, job.format, job.format === 'long' ? '16:9' : '9:16');
    for (const variant of spec.variants) {
      variantRevisions[variant.id] = await mediaJobSourceRevision({ ...job, outputSpec: { ...spec, variants: [variant] } });
    }
  } catch { warnings.push('The saved output settings could not be compared with these movies.'); }
  const variantAttempts: NonNullable<StudioExportState['variantAttempts']> = {};
  for (const id of ['landscape', 'portrait', 'square'] as const) {
    const attempt = readStudioExportAttempt(job.variantExportAttempts?.[id]);
    if (attempt?.variantId === id) variantAttempts[id] = attempt;
  }
  return { sourceRevision: await mediaJobSourceRevision(job), variantRevisions, sourceSavedAt: job.updatedAt,
    latestAttempt: readStudioExportAttempt(job.latestExportAttempt), variantAttempts,
    outputs: outputs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    untrackedOutputs, ...(warnings.length ? { warning: [...new Set(warnings)].join(' ') } : {}) };
}
