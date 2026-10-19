/**
 * Decision provider contract — Phase 1 of the "HomeBot — Jev Integration Plan".
 *
 * A decision provider answers typed questions (choice, score, boolean) about a
 * piece of state and returns typed answers with probabilities and confidence.
 * It is the seam behind which the default local rule provider and the optional
 * TypeSafe "Jev" System One provider sit. Nothing here is wired to a call site
 * yet; that is Phase 2.
 */

/** Which provider `decision.provider` selects. Default is 'local'. */
export type DecisionProviderId = 'local' | 'jev';

export const DECISION_PROVIDER_IDS: readonly DecisionProviderId[] = ['local', 'jev'];
export const DEFAULT_DECISION_PROVIDER: DecisionProviderId = 'local';

/** Free-form state the questions are asked about (request text, context, …). */
export type DecisionState = Record<string, unknown>;

interface QuestionBase {
  /** Stable key the answer is returned under. */
  id: string;
  /** Human-readable question, sent to Jev verbatim. */
  prompt: string;
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'choice';
  options: string[];
  /** Local provider hints: option → keywords that vote for it. */
  keywords?: Record<string, string[]>;
}

export interface ScoreQuestion extends QuestionBase {
  type: 'score';
  /** Inclusive range, default 0..1. */
  min?: number;
  max?: number;
  /** Local provider hints: each keyword hit pushes the score towards max. */
  keywords?: string[];
}

export interface BooleanQuestion extends QuestionBase {
  type: 'boolean';
  /** Local provider hints: any hit answers true. */
  keywords?: string[];
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | BooleanQuestion;

export type DecisionAnswer = string | number | boolean;

/** Result of one decide() call, keyed by question id. */
export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  /** Per question: outcome → probability (choice: each option; boolean: "true"/"false"; score: "value"). */
  probabilities: Record<string, Record<string, number>>;
  /** Per question confidence, 0..1. */
  confidence: Record<string, number>;
}

export interface DecisionProvider {
  readonly id: DecisionProviderId;
  decide(state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult>;
}

export type DecisionErrorCode = 'disabled' | 'timeout' | 'network' | 'http' | 'invalid_response';

/** Typed failure from a provider. Callers branch on `code`, never on message text. */
export class DecisionError extends Error {
  readonly code: DecisionErrorCode;
  readonly status?: number;
  constructor(code: DecisionErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
    this.status = status;
  }
}

/** Normalise any stored value to a known provider id; unknown → 'local'. */
export function normalizeDecisionProvider(value: unknown): DecisionProviderId {
  return (DECISION_PROVIDER_IDS as readonly unknown[]).includes(value)
    ? (value as DecisionProviderId)
    : DEFAULT_DECISION_PROVIDER;
}
