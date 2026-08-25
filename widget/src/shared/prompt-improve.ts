/**
 * Turning a rough request into one the assistant can actually act on.
 *
 * Most of what goes wrong here starts at the prompt. "fetch and sumerize" got a
 * curl command and the word *Done*; "do a tool call test try all avilable tools
 * safely" got tool syntax printed as prose. Neither was the model being stupid —
 * both were requests with no stated target, no success condition and no
 * indication of what to do with the result.
 *
 * This is deliberately a REWRITE the user can read and reject, not an invisible
 * pre-processing step. Silently rewriting what someone typed and sending it is
 * the sort of thing that makes an app feel like it is arguing with you.
 *
 * Pure and in shared/ so the rules are testable without a model, and so the same
 * cleaning applies whether the improvement came from a cloud model or a local one.
 */

/** Below this there is nothing to work with, and guessing invents requirements. */
export const MIN_IMPROVABLE_WORDS = 3;

/** Above this it is a document, not a prompt — rewriting it would lose detail. */
export const MAX_IMPROVABLE_CHARS = 4000;

export type ImproveRefusal = 'empty' | 'too_short' | 'too_long';

export interface ImproveCheck {
  ok: boolean;
  reason?: ImproveRefusal;
  /** What to show the user. Empty when ok. */
  message: string;
}

/**
 * Should this draft be improved at all?
 *
 * Refusing loudly beats returning something invented. A two-word draft has no
 * intent to sharpen, and "improving" it means the model guessing at a goal the
 * user never stated — which is worse than the original.
 */
export function checkImprovable(draft: string): ImproveCheck {
  const trimmed = (draft || '').trim();

  if (!trimmed) {
    return { ok: false, reason: 'empty', message: 'Type something first.' };
  }

  if (trimmed.length > MAX_IMPROVABLE_CHARS) {
    return {
      ok: false,
      reason: 'too_long',
      message: 'This is long enough that rewriting it would probably lose something. Sending it as-is is usually better.',
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < MIN_IMPROVABLE_WORDS) {
    return {
      ok: false,
      reason: 'too_short',
      message: 'Add a bit more first — there is not enough here to sharpen without guessing what you meant.',
    };
  }

  return { ok: true, message: '' };
}

/**
 * The instruction given to the model.
 *
 * The constraints matter more than the request. Left to itself a model will
 * pad a prompt with invented specifics — a filename you never mentioned, a
 * format you did not ask for — and the result reads well while asking for
 * something you did not want.
 */
export const IMPROVE_SYSTEM_PROMPT = [
  'You rewrite a user\'s draft request so an AI assistant can act on it.',
  '',
  'Rules, in order of importance:',
  '1. NEVER invent requirements. No filenames, formats, counts, dates, tools or',
  '   constraints the user did not mention. If a detail is missing, leave it',
  '   missing — a vague request rewritten with fabricated specifics is worse',
  '   than the original.',
  '2. Keep the user\'s intent and voice. This is their request, sharpened, not',
  '   your version of it.',
  '3. Make implicit things explicit ONLY where the draft already implies them:',
  '   what to produce, and what "done" looks like.',
  '4. Fix spelling and grammar. "sumerize" becomes "summarise".',
  '5. Stay about the same length. Do not turn one sentence into a specification.',
  '',
  'Output ONLY the rewritten request. No preamble, no explanation, no quotes,',
  'no "Here is the improved prompt". Just the request itself.',
].join('\n');

/** The user-side payload for the improvement call. */
export function buildImproveUserPrompt(draft: string): string {
  return `Rewrite this request:\n\n${draft.trim()}`;
}

/**
 * Clean what the model returned.
 *
 * Small local models in particular wrap answers in quotes, prefix them with
 * "Improved prompt:", or add a trailing explanation despite being told not to.
 * A rewrite that arrives with `Here is the improved prompt:` glued to the front
 * would be pasted straight into the user's box.
 */
export function cleanImprovedPrompt(raw: string): string {
  let text = (raw || '').trim();
  if (!text) return '';

  // Models bold the label and put the colon INSIDE the emphasis:
  // `**Rewritten request:** Summarise…`. Unwrap that first so the label rule
  // below sees plain text.
  //
  // The trailing colon inside the bold is required on purpose — without it,
  // `**Summarise** the article` would be stripped of emphasis it meant to keep.
  text = text.replace(/^\s*\*\*([^*\n]{1,40}:)\*\*\s*/, '$1 ');

  // Strip a leading label, with or without markdown emphasis.
  text = text.replace(
    /^\s*(?:\*{0,2})(?:here(?:'s| is)\s+(?:the\s+)?)?(?:improved|rewritten|revised|better)\s*(?:prompt|request|version)?\s*(?:\*{0,2})\s*[:\-—]\s*/i,
    ''
  );

  // Drop a trailing explanation the model added anyway. Only when it starts its
  // own paragraph — a legitimate rewrite can contain the word "changed".
  text = text.replace(
    /\n\s*\n\s*(?:\*{0,2})(?:note|explanation|changes?|i\s+(?:changed|added|made))\b[\s\S]*$/i,
    ''
  );

  text = text.trim();

  // Unwrap surrounding quotes, but only a matched pair around the WHOLE thing —
  // a rewrite that legitimately quotes something must survive intact.
  const paired = text.match(/^(["'`])([\s\S]*)\1$/);
  if (paired && !paired[2].includes(paired[1])) {
    text = paired[2].trim();
  }

  // Unwrap a fenced block, which models add when they think they are writing code.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();

  return text;
}

/**
 * Is the result worth showing?
 *
 * Returning the draft unchanged, or a truncated fragment of it, is a failure
 * dressed as a success — the user clicks, waits, and nothing happens with no
 * explanation.
 */
export function isUsefulImprovement(draft: string, improved: string): boolean {
  const a = (draft || '').trim();
  const b = (improved || '').trim();

  if (!b) return false;
  if (b.toLowerCase() === a.toLowerCase()) return false;
  // A rewrite much shorter than the draft has dropped something.
  if (b.length < a.length * 0.5) return false;

  return true;
}
