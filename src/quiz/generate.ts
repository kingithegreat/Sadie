/**
 * Quiz generation — parsing, validation, and dedup for LLM-generated questions.
 *
 * The quiz was "patchy" because the IPC handlers trusted whatever the model
 * returned and then PATCHED bad items instead of rejecting them: missing
 * options were padded with literal "Option A"–"Option D" filler, an absent
 * correctIndex silently became 0, duplicate questions across batches were
 * kept, and the prompt's own EXAMPLE questions leaked back into real quizzes.
 * A failed batch was silently skipped, so a 10-question quiz could arrive
 * with 6 questions and no explanation.
 *
 * This module is the single validation path for both quiz handlers
 * (general + study-from-notes). Rules:
 *   - an invalid item is DROPPED, never repaired into garbage
 *   - a valid item has real question text, exactly 4 distinct non-empty
 *     options, and a correctIndex that is either in range or recoverable
 *     from an answer-text field the model used instead
 *   - duplicates (normalised question text) are dropped across batches
 *   - the prompt's example questions are recognised and dropped
 *
 * Pure and dependency-free on purpose: lives in root src so the required CI
 * gate (tsc + jest) protects it — same placement as the CRM core, the
 * supervisor, and the trust summarizers.
 */

export interface ParsedQuizQuestion {
  type: 'multiple-choice' | 'code-output' | 'bug-fix' | 'fill-blank' | 'concept';
  question: string;
  code: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const ALLOWED_TYPES = new Set([
  'multiple-choice',
  'code-output',
  'bug-fix',
  'fill-blank',
  'concept',
]);

/** Minimum characters for question text to count as a real question. */
const MIN_QUESTION_LENGTH = 8;

/**
 * Normalised signatures of the example questions embedded in the generation
 * prompts. Small local models frequently echo these back verbatim; they must
 * never appear in a real quiz.
 */
/**
 * Stable key for "is this the same question?" — text plus code.
 *
 * Code-output questions legitimately share a stem ("What does this code
 * print?") while asking about different snippets, so text alone is not an
 * identity.
 */
export function questionKey(question: string, code?: string): string {
  const text = normalizeQuestionText(question);
  const body = (code || '').replace(/\s+/g, ' ').trim();
  return body ? `${text}::${body}` : text;
}

/**
 * Verbatim questions from the prompt's EXAMPLE block, rejected so the model
 * cannot pad a quiz by parroting the format sample.
 *
 * Keyed WITH code deliberately. "What does this code print?" is both the
 * example's stem and the most natural phrasing for every code-output question
 * ever written; banning the bare text meant real questions asking about real
 * snippets were silently deleted, leaving quizzes short and repetitive. Only
 * the example's exact text+code pair is a parrot.
 */
const EXAMPLE_SIGNATURES = new Set([
  questionKey('Which keyword defines a function in Python?'),
  questionKey('What is X?'),
  // The example's exact text+code pair.
  questionKey('What does this code print?', 'print(2 ** 3)'),
  // And the bare stem with NO code — you cannot ask what code prints without
  // showing any, so that form is malformed however it arrived. Both entries
  // are needed: together they reject the parrot and the nonsense while still
  // admitting "What does this code print?" about a genuine, different snippet.
  questionKey('What does this code print?'),
]);

/** Strip markdown code fences (``` / ```json) the model may wrap output in. */
export function stripFences(raw: string): string {
  return (raw || '').replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
}

/**
 * Extract the FIRST complete top-level JSON array from a string using a
 * string-aware balanced-bracket scan. Unlike the old greedy /\[[\s\S]*\]/
 * this cannot be broken by trailing prose containing "]" or by a second
 * array after the real one.
 */
export function extractJsonArray(raw: string): string | null {
  const text = raw || '';
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // truncated / unbalanced — caller treats as a failed batch
}

/** Lowercase, collapse whitespace, strip trailing punctuation — dedup key. */
export function normalizeQuestionText(question: string): string {
  return String(question || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!\s]+$/g, '')
    .trim();
}

/**
 * Validate a single raw item from the model. Returns a clean question or
 * null. Never pads, never invents options, never guesses an answer.
 */
export function validateQuestion(q: unknown): ParsedQuizQuestion | null {
  if (!q || typeof q !== 'object') return null;
  const item = q as Record<string, unknown>;

  const question = String(item.question ?? '').trim();
  if (question.length < MIN_QUESTION_LENGTH) return null;

  if (!Array.isArray(item.options)) return null;
  const options = item.options
    .map(o => String(o ?? '').trim())
    .filter(o => o.length > 0);
  if (options.length !== 4) return null;

  // All four options must be distinct (case-insensitive) — a model that
  // repeats an option has produced an unanswerable question.
  const distinct = new Set(options.map(o => o.toLowerCase()));
  if (distinct.size !== 4) return null;

  // Resolve the correct answer. Prefer an explicit in-range correctIndex;
  // otherwise try the answer-text fields some models use instead. If
  // neither resolves, the item is unusable — drop it rather than guess.
  let correctIndex = -1;
  if (typeof item.correctIndex === 'number' && Number.isInteger(item.correctIndex)
    && item.correctIndex >= 0 && item.correctIndex < 4) {
    correctIndex = item.correctIndex;
  }
  const answerText = String(item.answer ?? item.correct ?? item.correctAnswer ?? '').trim();
  if (answerText) {
    const found = options.findIndex(o => o.toLowerCase() === answerText.toLowerCase());
    if (found >= 0) correctIndex = found;
  }
  if (correctIndex < 0) return null;

  const type = ALLOWED_TYPES.has(String(item.type)) ? String(item.type) : 'multiple-choice';

  return {
    type: type as ParsedQuizQuestion['type'],
    question,
    code: typeof item.code === 'string' ? item.code : '',
    options,
    correctIndex,
    explanation: String(item.explanation ?? '').trim() || 'No explanation provided.',
  };
}

/**
 * Parse one raw model response into validated questions.
 * Returns [] when nothing usable came back (caller may retry the batch).
 */
export function parseQuizBatch(raw: string): ParsedQuizQuestion[] {
  const cleaned = stripFences(raw);
  const arrayText = extractJsonArray(cleaned);
  if (!arrayText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ParsedQuizQuestion[] = [];
  for (const item of parsed) {
    const valid = validateQuestion(item);
    if (valid) out.push(valid);
  }
  return out;
}

/**
 * Merge questions across batches: drop prompt-example echoes and duplicate
 * question text (first occurrence wins). Optionally cap at `limit`.
 */
export function dedupeQuestions(
  questions: ParsedQuizQuestion[],
  limit?: number,
): ParsedQuizQuestion[] {
  const seen = new Set<string>();
  const out: ParsedQuizQuestion[] = [];
  for (const q of questions) {
    // Key on question text AND code. Code-output questions legitimately share
    // the same stem ("What does this code print?") with different snippets;
    // keying on text alone collapsed those into one and threw away valid
    // questions, which is part of why short quizzes came back repetitive.
    const key = questionKey(q.question, q.code);
    if (!normalizeQuestionText(q.question) || seen.has(key) || EXAMPLE_SIGNATURES.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

/**
 * A "do not repeat these" clause listing questions already accepted.
 *
 * Quiz batches were generated in a loop that sent the SAME prompt every time,
 * so the model had no idea what it had already produced and naturally
 * regenerated its most obvious questions. dedupeQuestions then dropped the
 * literal repeats — but near-duplicates ("Which keyword defines a function?"
 * vs "What keyword is used to define a function?") survived as distinct
 * strings, which is how a finished quiz ended up asking the same thing three
 * times.
 *
 * Returns '' when there is nothing to avoid, so the first batch's prompt is
 * unchanged.
 */
export function buildAvoidClause(existing: ParsedQuizQuestion[], max = 20): string {
  const asked = existing
    .map(q => q.question.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-max);
  if (asked.length === 0) return '';

  return [
    '',
    'ALREADY ASKED — do not repeat these, and do not rephrase them:',
    ...asked.map(q => `- ${q}`),
    'Generate questions covering DIFFERENT aspects of the topic.',
  ].join('\n');
}

/**
 * Fill a quiz to the requested size, or report honestly that it could not.
 *
 * Both quiz handlers used to run a fixed `ceil(count/batch) + 2` attempts and
 * then return whatever they had with `success: true`. Only a ZERO-length result
 * counted as an error, so asking for 5 and receiving 3 looked like success —
 * reported live: "quiz was meant to give me 5 questions and it gave me 3".
 *
 * The comment above that loop claimed it kept generating "instead of silently
 * returning fewer questions". It did not: once the attempt budget ran out it
 * returned short, silently, which is the behaviour the comment denied.
 *
 * Two things had to change and both are here so the two callers cannot drift:
 *
 *  - A more generous budget, because rejects are NORMAL. The prompt embeds a
 *    worked EXAMPLE, small models echo it, and dedupeQuestions then strips the
 *    echo — so a batch of 3 routinely yields 1 or 2.
 *  - Stop early when it stops helping. Consecutive batches that add nothing new
 *    mean the model is repeating itself, and ten more rounds will not fix that.
 *    Spending a minute to confirm it is stuck is worse than saying so.
 *
 * `shortfall` is the point of the whole thing: the caller can tell the user
 * "here are 3, I could not make 5" instead of handing over 3 and saying nothing.
 */
export interface QuizFillResult {
  questions: ParsedQuizQuestion[];
  /** What was asked for. */
  requested: number;
  /** requested - questions.length. Zero when the quiz is full. */
  shortfall: number;
  /** Batches actually run, for the log. */
  attempts: number;
  /** Why it stopped, so a short quiz is explainable rather than mysterious. */
  stoppedBecause: 'full' | 'no-new-questions' | 'attempt-limit';
}

/** Consecutive empty batches before concluding the model is repeating itself. */
export const QUIZ_DRY_ROUNDS = 2;

export async function fillQuiz(opts: {
  questionCount: number;
  batchSize?: number;
  /** Runs one batch and returns the model's raw text. */
  generate: (count: number, existing: ParsedQuizQuestion[]) => Promise<string>;
  onBatch?: (info: { attempt: number; got: number; total: number; raw: string }) => void;
}): Promise<QuizFillResult> {
  const requested = Math.max(1, Math.trunc(opts.questionCount) || 1);
  const batchSize = opts.batchSize ?? 3;

  // Room for rejects rather than the bare minimum: the old +2 assumed batches
  // mostly succeed, and they mostly do not.
  const maxAttempts = Math.ceil(requested / batchSize) + 6;

  let questions: ParsedQuizQuestion[] = [];
  let dryRounds = 0;
  let attempts = 0;
  let stoppedBecause: QuizFillResult['stoppedBecause'] = 'attempt-limit';

  while (attempts < maxAttempts && questions.length < requested) {
    attempts++;
    const want = Math.min(batchSize, requested - questions.length);

    let raw = '';
    try {
      raw = await opts.generate(want, questions);
    } catch {
      // A failed batch is a dry round, not a fatal error — the next one may
      // work, and a transient provider hiccup should not lose the quiz.
      raw = '';
    }

    const before = questions.length;
    questions = dedupeQuestions([...questions, ...parseQuizBatch(raw || '')], requested);
    const gained = questions.length - before;

    opts.onBatch?.({ attempt: attempts, got: gained, total: questions.length, raw: raw || '' });

    if (gained > 0) {
      dryRounds = 0;
    } else if (++dryRounds >= QUIZ_DRY_ROUNDS) {
      stoppedBecause = 'no-new-questions';
      break;
    }
  }

  if (questions.length >= requested) stoppedBecause = 'full';

  return {
    questions,
    requested,
    shortfall: Math.max(0, requested - questions.length),
    attempts,
    stoppedBecause,
  };
}
