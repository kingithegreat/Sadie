/**
 * chat-idea.ts — how an idea brainstormed in chat becomes a Media Studio job.
 *
 * The podcast recap has the same shape (see podcast-recap.ts): one shared
 * composition, so the renderer's button and any future main-process path
 * produce identical briefs. The safety story carries over too — media-generate
 * prefers summarising given text over model recall, so the user's own words
 * travel in the brief as SOURCE MATERIAL rather than being paraphrased away.
 */

export interface ChatIdea {
  /** The message text the user wrote. */
  content: string;
  /** ISO timestamp of the message, for context in the brief. */
  createdAt?: string | number;
}

const MAX_TITLE_CHARS = 200;
/** A title cut from prose needs to stay scannable in the job list. */
const MAX_TITLE_SOURCE_CHARS = 120;

/**
 * Derive a working title from the idea's first line or first sentence.
 * Pure and dumb on purpose: no model call, so creating a job from an idea is
 * instant and works offline. The script stage does the language work.
 */
export function deriveIdeaTitle(content: string): string {
  const text = (content || '').trim();
  if (!text) return 'Untitled video';
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] || firstLine;
  const base = (firstLine.length <= MAX_TITLE_SOURCE_CHARS ? firstLine : firstSentence)
    .replace(/^[-*#\s]+/, '')
    .slice(0, MAX_TITLE_SOURCE_CHARS);
  return base || 'Untitled video';
}

/**
 * The whole composition: the user's words become the brief's source material.
 * Format defaults to short — the common case; the panel lets them change it.
 */
export function chatIdeaToJobInput(
  idea: ChatIdea,
): { title: string; brief: string; format: 'short' } {
  const text = (idea.content || '').trim();
  return {
    title: deriveIdeaTitle(text).slice(0, MAX_TITLE_CHARS),
    brief: [
      'A video from an idea the user brainstormed in chat.',
      idea.createdAt ? `Idea noted: ${idea.createdAt}.` : '',
      '',
      'The idea, in the user\'s own words (use ONLY this as source material — do not add facts of your own):',
      text || '(the idea was empty; ask the user what the video should say)',
    ].filter(Boolean).join('\n'),
    format: 'short',
  };
}
