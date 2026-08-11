/**
 * media-studio.ts — the job model and state machine for the Media Studio.
 *
 * Phase 1 of the plan recorded in the brain ("SADIE Media Studio — Automated
 * YouTube Content Pipeline"). The plan's own build principle is to get one
 * vertical slice reliable before adding autonomy, so this file owns the part
 * everything else depends on: what a job is, what states it may be in, and
 * which transitions are legal.
 *
 * Deliberately has NO dependency on Electron, n8n, or any provider. It is pure
 * data and rules, so it can be tested exhaustively without a running app —
 * which matters because every later phase (TTS, Remotion, YouTube publishing)
 * trusts these transitions to be enforced.
 *
 * The single most important rule here: nothing reaches `published` without
 * passing through `approved`, and `approved` can only be set by an explicit
 * human decision. The plan states that as a guardrail; this makes it
 * structural rather than a matter of remembering.
 */

/** Pipeline states, in the order the plan defines them. */
export const MEDIA_STATES = [
  'idea',
  'researching',
  'script_draft',
  'script_qa',
  'media_production',
  'render_qa',
  'awaiting_approval',
  'approved',
  'scheduled',
  'published',
  'analysing',
] as const;

/** Explicit, retryable failure states — a stall must be visible, not implicit. */
export const MEDIA_FAILURE_STATES = [
  'blocked',
  'failed',
  'needs_revision',
  'rejected',
] as const;

export type MediaState = (typeof MEDIA_STATES)[number];
export type MediaFailureState = (typeof MEDIA_FAILURE_STATES)[number];
export type MediaJobState = MediaState | MediaFailureState;

export type MediaFormat = 'short' | 'long';

export interface MediaJobEvent {
  at: string;
  from: MediaJobState;
  to: MediaJobState;
  /** Who caused it — 'human' for approval decisions, else the stage name. */
  by: string;
  note?: string;
}

export interface MediaJob {
  id: string;
  title: string;
  format: MediaFormat;
  state: MediaJobState;
  /** Free-text topic or brief the idea started from. */
  brief?: string;
  script?: string;
  /** Sources gathered by the research stage — kept for attribution. */
  sources?: string[];
  /** Absolute path to the recorded narration audio, once it exists. */
  narrationPath?: string;
  /** Absolute path to the SRT subtitles generated alongside the narration. */
  captionsPath?: string;
  /** True spoken length, measured from the audio rather than estimated. */
  durationSeconds?: number;
  /** Absolute path to a rendered file, once one exists. */
  renderPath?: string;
  /** YouTube video id, only ever set after publishing. */
  videoId?: string;
  /** When the video actually went out. Set with videoId, never alone. */
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  history: MediaJobEvent[];
}

/**
 * Legal transitions.
 *
 * Written as an explicit map rather than "any state to any state" because the
 * plan's guardrails are only real if something enforces them. Note that
 * `awaiting_approval` leads to `approved` or `rejected` and nowhere else, and
 * that `published` is reachable only from `scheduled` or `approved`.
 */
const TRANSITIONS: Record<MediaJobState, readonly MediaJobState[]> = {
  idea:             ['researching', 'blocked', 'rejected'],
  researching:      ['script_draft', 'blocked', 'failed'],
  script_draft:     ['script_qa', 'needs_revision', 'blocked', 'failed'],
  script_qa:        ['media_production', 'needs_revision', 'failed'],
  media_production: ['render_qa', 'blocked', 'failed'],
  render_qa:        ['awaiting_approval', 'needs_revision', 'failed'],
  // The human gate. Nothing else may set `approved`.
  awaiting_approval:['approved', 'rejected', 'needs_revision'],
  approved:         ['scheduled', 'published', 'rejected'],
  scheduled:        ['published', 'blocked', 'rejected'],
  published:        ['analysing'],
  analysing:        [],

  // Failure states are retryable — each returns to the stage that can redo it.
  blocked:          ['idea', 'researching', 'script_draft', 'media_production', 'scheduled', 'rejected'],
  failed:           ['researching', 'script_draft', 'script_qa', 'media_production', 'render_qa', 'rejected'],
  needs_revision:   ['script_draft', 'media_production', 'rejected'],
  // Terminal by choice: a rejected idea is closed, not silently revived.
  rejected:         [],
};

export function isFailureState(s: MediaJobState): s is MediaFailureState {
  return (MEDIA_FAILURE_STATES as readonly string[]).includes(s);
}

export function isValidState(s: string): s is MediaJobState {
  return (MEDIA_STATES as readonly string[]).includes(s)
    || (MEDIA_FAILURE_STATES as readonly string[]).includes(s);
}

export function allowedNext(from: MediaJobState): readonly MediaJobState[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: MediaJobState, to: MediaJobState): boolean {
  return allowedNext(from).includes(to);
}

/** States that require an explicit human decision to leave. */
export function requiresHumanDecision(s: MediaJobState): boolean {
  return s === 'awaiting_approval';
}

/**
 * States that put a video in front of the public, or queue it to be.
 *
 * The plan requires a kill switch for publishing. Entering either of these
 * needs `publishingEnabled: true` passed explicitly, so the switch is
 * fail-closed and cannot be forgotten by a new caller — the same shape as the
 * approval gate, for the same reason: a guardrail that depends on every future
 * caller remembering it is not a guardrail.
 */
export function isPublishingState(s: MediaJobState): boolean {
  return s === 'scheduled' || s === 'published';
}

export class InvalidTransitionError extends Error {
  constructor(public readonly from: MediaJobState, public readonly to: MediaJobState) {
    super(
      `Cannot move a job from "${from}" to "${to}". ` +
      (allowedNext(from).length
        ? `From "${from}" the allowed next states are: ${allowedNext(from).join(', ')}.`
        : `"${from}" is a terminal state.`),
    );
    this.name = 'InvalidTransitionError';
  }
}

export interface TransitionOptions {
  by?: string;
  note?: string;
  /**
   * Set only by a real human decision from the UI or an explicit chat
   * approval. Leaving `awaiting_approval` requires it, so an automated stage
   * cannot approve its own work even if it asks for a legal transition.
   */
  humanDecision?: boolean;
  /**
   * The publishing kill switch. Required to enter `scheduled` or `published`.
   * Absent or false means publishing is off, and the transition is refused —
   * fail-closed, so a caller that never heard of the switch cannot publish.
   */
  publishingEnabled?: boolean;
  /** Injected in tests; defaults to now. */
  now?: () => Date;
}

/**
 * Apply a transition, returning a NEW job. Throws on an illegal move rather
 * than clamping or ignoring, because a silently-ignored transition is how a
 * pipeline ends up with a job that looks published and is not.
 */
export function transition(job: MediaJob, to: MediaJobState, opts: TransitionOptions = {}): MediaJob {
  if (!isValidState(to)) throw new InvalidTransitionError(job.state, to as MediaJobState);
  if (!canTransition(job.state, to)) throw new InvalidTransitionError(job.state, to);

  if (requiresHumanDecision(job.state) && !opts.humanDecision) {
    throw new Error(
      `Leaving "${job.state}" needs a human decision. ` +
      `This is the approval gate: an automated stage cannot approve or reject its own work.`,
    );
  }

  if (isPublishingState(to) && !opts.publishingEnabled) {
    throw new Error(
      `Publishing is switched off, so "${job.title}" cannot move to ${to.replace(/_/g, ' ')}. ` +
      `Turn publishing on in Settings to allow it.`,
    );
  }

  // Idempotency. The plan requires that a retry cannot publish twice, and a
  // retry is exactly what happens when a network call times out after the
  // upload succeeded. The video id is the natural key: once a job has one, it
  // is out, and re-entering a publishing state would mean a second upload.
  if (isPublishingState(to) && job.videoId) {
    throw new Error(
      `"${job.title}" has already been published as ${job.videoId}. ` +
      `Refusing to publish it again.`,
    );
  }

  const at = (opts.now?.() ?? new Date()).toISOString();
  return {
    ...job,
    state: to,
    updatedAt: at,
    history: [...job.history, { at, from: job.state, to, by: opts.by ?? 'system', note: opts.note }],
  };
}

/**
 * Record that a video actually went out, with the id the platform gave it.
 *
 * Separate from `transition` because publishing has a fact attached — the
 * video id — and the id is what makes the operation idempotent. Calling this
 * twice is refused rather than silently overwriting, so a retried publish
 * cannot quietly replace the id of the copy already online.
 */
export function markPublished(
  job: MediaJob,
  videoId: string,
  opts: TransitionOptions = {},
): MediaJob {
  const id = (videoId || '').trim();
  if (!id) throw new Error('A published video needs the id the platform assigned it.');
  if (job.videoId) {
    throw new Error(`"${job.title}" is already published as ${job.videoId}.`);
  }

  const moved = transition(job, 'published', opts);
  return {
    ...moved,
    videoId: id,
    publishedAt: moved.updatedAt,
  };
}

export interface NewJobInput {
  title: string;
  format?: MediaFormat;
  brief?: string;
  id?: string;
  now?: () => Date;
}

export function createJob(input: NewJobInput): MediaJob {
  const title = (input.title || '').trim();
  if (!title) throw new Error('A media job needs a title.');

  const at = (input.now?.() ?? new Date()).toISOString();
  return {
    id: input.id || `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    format: input.format ?? 'short',
    state: 'idea',
    brief: input.brief?.trim() || undefined,
    createdAt: at,
    updatedAt: at,
    history: [],
  };
}

/**
 * Human-readable progress, for the UI and for chat replies.
 * Failure states report the stage they are stuck at rather than a percentage,
 * because "60% complete and failed" tells nobody anything useful.
 */
export function describeProgress(job: MediaJob): string {
  if (isFailureState(job.state)) {
    const last = job.history[job.history.length - 1];
    const stuckAt = last ? last.from : 'an earlier stage';
    return `${job.state.replace(/_/g, ' ')} (at ${stuckAt.replace(/_/g, ' ')})`;
  }
  const idx = (MEDIA_STATES as readonly string[]).indexOf(job.state);
  return `${job.state.replace(/_/g, ' ')} — step ${idx + 1} of ${MEDIA_STATES.length}`;
}
