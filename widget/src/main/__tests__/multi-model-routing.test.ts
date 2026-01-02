import { analyzeAndRouteMessage } from '../message-router';

describe('Multi-Model Routing', () => {
  it('routes NBA queries to tools (fast model phase)', async () => {
    const decision = await analyzeAndRouteMessage('What are the NBA scores?');
    expect(decision.type).toBe('tools');
    if (decision.type === 'tools') {
      expect(decision.calls[0].name).toBe('nba_query');
    }
  });

  it('routes generic queries to LLM (fast model phase)', async () => {
    const decision = await analyzeAndRouteMessage('Tell me a joke.');
    expect(decision.type).toBe('llm');
  });
});
