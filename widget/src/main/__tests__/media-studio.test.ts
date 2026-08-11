/**
 * The Media Studio state machine.
 *
 * The plan's guardrails are only real if something enforces them, so the
 * approval gate gets the most attention here: the whole point of the pipeline
 * is that a video cannot reach the public without a human saying yes, and a
 * guardrail that lives in a document is not a guardrail.
 *
 * Pure data and rules — no Electron, no n8n, no provider — so every transition
 * can be checked exhaustively.
 */

import {
  MEDIA_STATES,
  MEDIA_FAILURE_STATES,
  createJob,
  transition,
  canTransition,
  allowedNext,
  isFailureState,
  isValidState,
  describeProgress,
  markPublished,
  requiresHumanDecision,
  InvalidTransitionError,
  type MediaJob,
  type MediaJobState,
} from '../media-studio';

const at = (iso: string) => () => new Date(iso);

function jobAt(state: MediaJobState): MediaJob {
  return { ...createJob({ title: 'One-Minute Bible: Jonah', now: at('2026-08-12T09:00:00Z') }), state };
}

describe('creating a job', () => {
  it('starts at idea with no history', () => {
    const j = createJob({ title: 'What Jesus Actually Said' });
    expect(j.state).toBe('idea');
    expect(j.history).toEqual([]);
    expect(j.format).toBe('short');
  });

  it('refuses an empty title', () => {
    expect(() => createJob({ title: '   ' })).toThrow(/title/i);
  });

  it('keeps the brief and format it was given', () => {
    const j = createJob({ title: 'The Bible Explained', format: 'long', brief: 'Romans, chapter by chapter' });
    expect(j.format).toBe('long');
    expect(j.brief).toBe('Romans, chapter by chapter');
  });
});

describe('the approval gate', () => {
  it('cannot be passed without a human decision', () => {
    const j = jobAt('awaiting_approval');
    // An automated stage asking for a legal transition is still refused.
    expect(() => transition(j, 'approved', { by: 'render_qa' })).toThrow(/human decision/i);
  });

  it('lets a human approve', () => {
    const j = transition(jobAt('awaiting_approval'), 'approved', { by: 'aden', humanDecision: true });
    expect(j.state).toBe('approved');
    expect(j.history[0].by).toBe('aden');
  });

  it('lets a human reject', () => {
    const j = transition(jobAt('awaiting_approval'), 'rejected', { by: 'aden', humanDecision: true });
    expect(j.state).toBe('rejected');
  });

  it('is the ONLY route to approved', () => {
    // Nothing anywhere in the machine may reach `approved` except from the gate.
    const sources = [...MEDIA_STATES, ...MEDIA_FAILURE_STATES]
      .filter(s => canTransition(s as MediaJobState, 'approved'));
    expect(sources).toEqual(['awaiting_approval']);
  });

  it('and nothing reaches published without passing approved', () => {
    const sources = [...MEDIA_STATES, ...MEDIA_FAILURE_STATES]
      .filter(s => canTransition(s as MediaJobState, 'published'));
    // Both routes are downstream of the human gate.
    expect(sources.sort()).toEqual(['approved', 'scheduled']);
  });
});

describe('illegal moves are refused, not clamped', () => {
  it('an idea cannot jump straight to published', () => {
    expect(() => transition(jobAt('idea'), 'published')).toThrow(InvalidTransitionError);
  });

  it('the error names what IS allowed', () => {
    try {
      transition(jobAt('idea'), 'published');
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toMatch(/researching/);
    }
  });

  it('rejected is terminal', () => {
    expect(allowedNext('rejected')).toEqual([]);
    expect(() => transition(jobAt('rejected'), 'idea')).toThrow(/terminal/i);
  });

  it('an unknown state is refused', () => {
    expect(isValidState('somewhere_else')).toBe(false);
    expect(() => transition(jobAt('idea'), 'somewhere_else' as MediaJobState)).toThrow();
  });
});

describe('the happy path runs end to end', () => {
  it('idea → published, recording every step', () => {
    let j = createJob({ title: 'Bible Stories You Didn\'t Know', now: at('2026-08-12T09:00:00Z') });
    const path: MediaJobState[] = [
      'researching', 'script_draft', 'script_qa', 'media_production',
      'render_qa', 'awaiting_approval',
    ];
    for (const next of path) j = transition(j, next, { by: next });
    j = transition(j, 'approved', { by: 'aden', humanDecision: true });
    // Both publishing hops now require the kill switch to be on, which is what
    // a real publisher passes once the user has enabled publishing.
    j = transition(j, 'scheduled', { by: 'publisher', publishingEnabled: true });
    j = transition(j, 'published', { by: 'publisher', publishingEnabled: true });

    expect(j.state).toBe('published');
    expect(j.history).toHaveLength(9);
    // Every hop is recorded with both ends, so a stall is always traceable.
    expect(j.history[0]).toMatchObject({ from: 'idea', to: 'researching' });
    expect(j.history.at(-1)).toMatchObject({ from: 'scheduled', to: 'published' });
  });
});

describe('failures are explicit and retryable', () => {
  it('every failure state is reachable from somewhere', () => {
    for (const f of MEDIA_FAILURE_STATES) {
      const reachable = [...MEDIA_STATES, ...MEDIA_FAILURE_STATES]
        .some(s => canTransition(s as MediaJobState, f));
      expect({ state: f, reachable }).toEqual({ state: f, reachable: true });
    }
  });

  it('a failed render can go back and be redone', () => {
    const j = transition(jobAt('render_qa'), 'needs_revision', { by: 'render_qa', note: 'audio clipping' });
    expect(j.state).toBe('needs_revision');
    const retried = transition(j, 'media_production', { by: 'aden' });
    expect(retried.state).toBe('media_production');
  });

  it('describes where a stuck job stalled rather than a meaningless percentage', () => {
    const j = transition(jobAt('script_qa'), 'needs_revision', { by: 'qa' });
    expect(describeProgress(j)).toMatch(/needs revision/);
    expect(describeProgress(j)).toMatch(/script qa/);
  });

  it('reports ordinary progress as a step count', () => {
    expect(describeProgress(jobAt('script_draft'))).toMatch(/step 3 of 11/);
  });
});

describe('machine integrity', () => {
  it('every transition target is a real state', () => {
    for (const s of [...MEDIA_STATES, ...MEDIA_FAILURE_STATES]) {
      for (const t of allowedNext(s as MediaJobState)) {
        expect(isValidState(t)).toBe(true);
      }
    }
  });

  it('no state transitions to itself', () => {
    for (const s of [...MEDIA_STATES, ...MEDIA_FAILURE_STATES]) {
      expect(allowedNext(s as MediaJobState)).not.toContain(s);
    }
  });

  it('only the approval gate demands a human', () => {
    const gated = [...MEDIA_STATES, ...MEDIA_FAILURE_STATES]
      .filter(s => requiresHumanDecision(s as MediaJobState));
    expect(gated).toEqual(['awaiting_approval']);
  });

  it('classifies failure states correctly', () => {
    expect(isFailureState('blocked')).toBe(true);
    expect(isFailureState('published')).toBe(false);
  });
});

/**
 * Two guardrails the plan names explicitly and that had nothing behind them:
 *
 *   "Add idempotency so retries cannot accidentally publish duplicate videos."
 *   "Build kill switches for scheduled publishing and individual workflows."
 *
 * Both are enforced in the machine rather than at a call site, for the same
 * reason as the approval gate: a rule every future caller must remember is not
 * a rule. Both fail closed — a caller that has never heard of the kill switch
 * cannot publish.
 */
describe('the publishing kill switch', () => {
  it('refuses to schedule when publishing is off', () => {
    const j = jobAt('approved');
    expect(() => transition(j, 'scheduled', { by: 'publisher' })).toThrow(/publishing is switched off/i);
  });

  it('refuses to publish when publishing is off', () => {
    const j = jobAt('approved');
    expect(() => transition(j, 'published', { by: 'publisher' })).toThrow(/publishing is switched off/i);
  });

  it('allows it when explicitly enabled', () => {
    const j = transition(jobAt('approved'), 'scheduled', { by: 'publisher', publishingEnabled: true });
    expect(j.state).toBe('scheduled');
  });

  it('does not block any non-publishing stage', () => {
    // The switch must not turn into a general handbrake on the pipeline.
    const j = transition(jobAt('script_draft'), 'script_qa', { by: 'qa' });
    expect(j.state).toBe('script_qa');
  });

  it('is fail-closed — omitting the flag is the same as off', () => {
    expect(() => transition(jobAt('approved'), 'published', {})).toThrow(/switched off/i);
  });
});

describe('idempotent publishing', () => {
  it('records the video id and when it went out', () => {
    const j = markPublished(jobAt('approved'), 'yt_abc123', { publishingEnabled: true, by: 'publisher' });
    expect(j.state).toBe('published');
    expect(j.videoId).toBe('yt_abc123');
    expect(j.publishedAt).toBe(j.updatedAt);
  });

  it('refuses a second publish of the same job', () => {
    const first = markPublished(jobAt('approved'), 'yt_abc123', { publishingEnabled: true });
    // The retry case: the upload succeeded, the response timed out, the caller
    // tries again. It must not produce a second video.
    expect(() => markPublished(first, 'yt_different', { publishingEnabled: true }))
      .toThrow(/already published as yt_abc123/i);
  });

  it('refuses to re-enter a publishing state once a video id exists', () => {
    const published = markPublished(jobAt('approved'), 'yt_abc123', { publishingEnabled: true });
    const analysing = transition(published, 'analysing', { by: 'analytics' });
    // Even a legal-looking route back must not republish.
    expect(() => transition({ ...analysing, state: 'approved' }, 'scheduled', { publishingEnabled: true }))
      .toThrow(/already been published/i);
  });

  it('requires the platform id, refusing an empty one', () => {
    expect(() => markPublished(jobAt('approved'), '   ', { publishingEnabled: true }))
      .toThrow(/needs the id/i);
  });

  it('still honours the kill switch', () => {
    expect(() => markPublished(jobAt('approved'), 'yt_abc123')).toThrow(/switched off/i);
  });
});
