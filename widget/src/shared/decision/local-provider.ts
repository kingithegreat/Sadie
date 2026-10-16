/**
 * Default decision provider: deterministic keyword rules, no network, no cost.
 * The same state and questions always produce the same result.
 */
import type {
  BooleanQuestion, ChoiceQuestion, DecisionProvider, DecisionQuestion, DecisionResult, DecisionState, ScoreQuestion,
} from './types';

/** Lower-cased text of every string/number/boolean in the state, depth-first. */
export function stateText(state: unknown, depth = 0): string {
  if (depth > 5 || state === null || state === undefined) return '';
  if (typeof state === 'string') return state.toLowerCase();
  if (typeof state === 'number' || typeof state === 'boolean') return String(state);
  if (Array.isArray(state)) return state.map(v => stateText(v, depth + 1)).join(' ');
  if (typeof state === 'object') return Object.values(state as Record<string, unknown>).map(v => stateText(v, depth + 1)).join(' ');
  return '';
}

function hits(text: string, keywords: string[] | undefined): number {
  if (!keywords) return 0;
  return keywords.filter(k => k && text.includes(k.toLowerCase())).length;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export class LocalDecisionProvider implements DecisionProvider {
  readonly id = 'local' as const;

  async decide(state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult> {
    const text = stateText(state);
    const result: DecisionResult = { answers: {}, probabilities: {}, confidence: {} };
    for (const q of questions) {
      if (q.type === 'choice') this.choice(text, q, result);
      else if (q.type === 'score') this.score(text, q, result);
      else this.boolean(text, q, result);
    }
    return result;
  }

  private choice(text: string, q: ChoiceQuestion, out: DecisionResult): void {
    const options = q.options.length > 0 ? q.options : [''];
    // +1 smoothing keeps every option possible; ties resolve to the first option.
    const weights = options.map(o => 1 + hits(text, q.keywords?.[o]));
    const total = weights.reduce((a, b) => a + b, 0);
    let best = 0;
    weights.forEach((w, i) => { if (w > weights[best]) best = i; });
    out.answers[q.id] = options[best];
    out.probabilities[q.id] = Object.fromEntries(options.map((o, i) => [o, round(weights[i] / total)]));
    out.confidence[q.id] = round(weights[best] / total);
  }

  private score(text: string, q: ScoreQuestion, out: DecisionResult): void {
    const min = q.min ?? 0;
    const max = q.max ?? 1;
    const n = hits(text, q.keywords);
    const total = q.keywords?.length ?? 0;
    const fraction = total > 0 ? n / total : 0;
    const value = round(min + (max - min) * fraction);
    out.answers[q.id] = value;
    out.probabilities[q.id] = { value: 1 };
    // Rules with no keyword hits are a guess.
    out.confidence[q.id] = n > 0 ? 0.6 : 0.3;
  }

  private boolean(text: string, q: BooleanQuestion, out: DecisionResult): void {
    const n = hits(text, q.keywords);
    const pTrue = n > 0 ? round(Math.min(0.95, 0.6 + 0.1 * n)) : 0.2;
    out.answers[q.id] = n > 0;
    out.probabilities[q.id] = { true: pTrue, false: round(1 - pTrue) };
    out.confidence[q.id] = Math.max(pTrue, round(1 - pTrue));
  }
}
