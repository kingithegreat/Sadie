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
