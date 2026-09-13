/** One review decision belongs to one immutable, QA-verified movie. */
import type { MediaJob } from '../media-studio';
import type { StudioRenderedOutput } from '../../shared/media-output';

export function createStudioExportReview(input: {
  source: { type: 'job' | 'storyboard'; id: string };
  title: string; moviePath: string; output: StudioRenderedOutput; brief?: string;
}, existing?: MediaJob): MediaJob {
  const { output, source, moviePath } = input;
  const id = `${source.type === 'job' ? 'jobexport' : 'sbexport'}_${output.exportId}`;
  if (output.outputSpec.variants.length !== 1 || !output.sha256) throw new Error('Review requires one verified exported format.');
  if (existing) {
    if (existing.id !== id || existing.renderPath !== moviePath || existing.renderedOutput?.sha256 !== output.sha256) {
      throw new Error('This export identity already belongs to a different movie. The existing review was kept.');
    }
    return existing; // In particular, never reset an approved/rejected decision.
  }
  const variant = output.outputSpec.variants[0];
  return {
    id, title: `[${source.type === 'job' ? variant.id : 'Storyboard'}] ${input.title}`,
    format: output.outputSpec.durationIntent, state: 'awaiting_approval',
    reviewSource: source, burnSubtitles: output.burnSubtitles, outputSpec: output.outputSpec,
    renderedOutput: output, renderPath: moviePath, durationSeconds: output.durationSeconds,
    brief: input.brief, createdAt: output.createdAt, updatedAt: output.createdAt,
    history: [{ at: output.createdAt, from: 'media_production', to: 'awaiting_approval',
      by: 'export review', note: `Review this ${variant.width} × ${variant.height} movie: ${output.filename}` }],
  };
}
