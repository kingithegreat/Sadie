/**
 * podcast-recap.ts — how a podcast episode becomes a Media Studio job.
 *
 * Shared because both sides need the same words: the renderer's "Make a recap"
 * button and any future main-process path (a chat intent, a scheduled per-feed
 * automation) must produce identical briefs, or the safety contract below
 * quietly forks. This file is the one copy.
 */

export interface FeedEpisode {
  title: string;
  summary: string;
  published: string;
  duration: string;
}

const MAX_TITLE_CHARS = 200;

/**
 * The episode's own show notes travel in the brief as SOURCE MATERIAL.
 *
 * That is the safety story of the whole feature: media-generate's first
 * content guardrail is "never fabricate", and its research/script stages
 * prefer summarising given text over model recall. A recap of a real episode
 * must be built from what the episode actually says — so the notes are given,
 * marked as the only permitted source, and an episode with no notes constrains
 * the recap rather than inviting the model to fill the gap from memory.
 */
export function episodeToJobInput(
  showTitle: string,
  ep: FeedEpisode,
): { title: string; brief: string; format: 'short' } {
  const title = `Recap: ${ep.title}`.slice(0, MAX_TITLE_CHARS);
  const brief = [
    `A recap of the podcast episode "${ep.title}" from "${showTitle}".`,
    ep.published ? `Published: ${ep.published}.` : '',
    '',
    'Episode notes (use ONLY this as source material — do not add facts of your own):',
    ep.summary || '(the feed provided no notes; keep the recap to what the title itself supports)',
    '',
    'Credit the show by name and encourage listening to the full episode.',
  ].filter(Boolean).join('\n');
  // Recaps are the short format by definition — the 60-second premise of the
  // pipeline this was ported from (ideamake).
  return { title, brief, format: 'short' };
}
