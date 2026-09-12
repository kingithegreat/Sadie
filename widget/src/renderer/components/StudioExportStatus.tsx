import type { StudioExportState } from '../../shared/media-output';
import './StudioExportStatus.css';

interface Props {
  state?: StudioExportState;
  moviePath: string | null;
  unsaved: boolean;
  busy: boolean;
  rendering?: boolean;
  onSelect: (moviePath: string) => void;
}

const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unknown';
const revision = (value: string | null | undefined) => value ? value.slice(0, 12) : 'Unknown';

/** Describes the exact file in the player, not whichever attempt ran most recently. */
export function StudioExportStatus({ state, moviePath, unsaved, busy, rendering, onSelect }: Props) {
  const output = state?.outputs.find(item => item.moviePath === moviePath);
  const attempt = state?.latestAttempt;
  const known = !!output?.sourceRevision && !!state?.sourceRevision;
  const stale = unsaved || (known && output!.sourceRevision !== state!.sourceRevision);
  const failed = attempt?.status === 'failed' || attempt?.status === 'interrupted';
  const variant = output?.outputSpec.variants[0];
  const heading = rendering ? 'Export in progress — previous movies are kept'
    : moviePath && failed && output ? `Previous successful export — latest attempt ${attempt.status}`
    : moviePath && failed ? `Unverified older file — latest attempt ${attempt.status}`
    : moviePath && stale ? 'Preview out of date'
      : moviePath && known ? 'Preview matches the saved revision'
        : moviePath ? 'Saved movie — source revision unknown' : 'No movie selected';
  return <section className="ms-export-status" aria-label="Export freshness" aria-live="polite">
    <strong>{heading}</strong>
    {unsaved && <p>Unsaved edits — Save Board keeps your changes; Render Movie saves and exports them.</p>}
    {moviePath && stale && failed && <p>Preview out of date — the previous good movie is still available.</p>}
    {moviePath && !known && <p>This older export has no verified source revision. Render again to record one; the old file will be kept.</p>}
    <dl>
      <div><dt>Saved source</dt><dd title={state?.sourceRevision ?? undefined}>{revision(state?.sourceRevision)} · {date(state?.sourceSavedAt)}</dd></div>
      {moviePath && <div><dt>Displayed export</dt><dd title={output?.sourceRevision}>{revision(output?.sourceRevision)} · {date(output?.createdAt)}</dd></div>}
      {output && <div><dt>File details</dt><dd>{variant?.width} × {variant?.height} · {output.durationSeconds.toFixed(2)} seconds · {output.fileSizeBytes === undefined ? 'Size unknown' : `${(output.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`}{output.sceneId ? ` · Scene ${output.sceneId}` : ''}</dd></div>}
      {attempt && <div><dt>{rendering ? 'Previous recorded attempt' : 'Latest attempt'}{attempt.sceneId ? ` (scene ${attempt.sceneId})` : ''}</dt><dd>{attempt.status} · started {date(attempt.startedAt)}{attempt.finishedAt ? ` · finished ${date(attempt.finishedAt)}` : ''}</dd></div>}
    </dl>
    {failed && attempt.error && <details><summary>Why this attempt did not finish</summary><p className="ms-export-error">{attempt.error}</p></details>}
    {state?.warning && <p>{state.warning}</p>}
    {!!state && (state.outputs.length > 0 || !!state.untrackedOutputs?.length) && <label>Export history
      <select aria-label="Export history" value={moviePath ?? ''} disabled={busy} onChange={event => onSelect(event.target.value)}>
        <option value="" disabled>Choose a saved movie</option>
        {moviePath && !output && !state.untrackedOutputs?.some(item => item.moviePath === moviePath) && <option value={moviePath}>Older movie — revision unknown</option>}
        {state.outputs.map(item => <option key={item.exportId} value={item.moviePath}>
          {date(item.createdAt)} · {item.outputSpec.variants[0]?.aspectRatio} · {item.sceneId ? `Scene ${item.sceneId}` : 'Complete movie'} · {item.exportId.slice(0, 8)}
        </option>)}
        {state.untrackedOutputs?.map(item => <option key={item.moviePath} value={item.moviePath}>{item.filename} · Revision unknown</option>)}
      </select>
    </label>}
  </section>;
}
