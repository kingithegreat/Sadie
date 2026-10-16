import { LocalDecisionProvider } from '../local-provider';
import type { DecisionQuestion } from '../types';

const questions: DecisionQuestion[] = [
  { id: 'tool', type: 'choice', prompt: 'Which tool?', options: ['chat', 'weather', 'calendar'],
    keywords: { weather: ['weather', 'rain', 'forecast'], calendar: ['meeting', 'calendar'] } },
  { id: 'risky', type: 'boolean', prompt: 'Is it risky?', keywords: ['delete', 'rm -rf'] },
  { id: 'complexity', type: 'score', prompt: 'How complex?', min: 0, max: 10, keywords: ['refactor', 'architecture'] },
];

describe('LocalDecisionProvider', () => {
  const p = new LocalDecisionProvider();

  it('is the local provider', () => expect(p.id).toBe('local'));

  it('answers each question type from keywords', async () => {
    const r = await p.decide({ text: 'Will it RAIN tomorrow? Check the forecast' }, questions);
    expect(r.answers).toEqual({ tool: 'weather', risky: false, complexity: 0 });
    expect(r.probabilities.tool.weather).toBeGreaterThan(r.probabilities.tool.chat);
    const sum = Object.values(r.probabilities.tool).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
    expect(r.confidence.tool).toBe(r.probabilities.tool.weather);
    expect(r.probabilities.risky).toEqual({ true: 0.2, false: 0.8 });
  });

  it('reads nested state and scales scores', async () => {
    const r = await p.decide({ msg: { parts: ['please refactor and delete the old file'] } }, questions);
    expect(r.answers.risky).toBe(true);
    expect(r.answers.complexity).toBe(5);
    expect(r.answers.tool).toBe('chat'); // tie -> first option
  });

  it('is deterministic', async () => {
    const s = { text: 'meeting at 3' };
    expect(await p.decide(s, questions)).toEqual(await p.decide(s, questions));
  });
});
