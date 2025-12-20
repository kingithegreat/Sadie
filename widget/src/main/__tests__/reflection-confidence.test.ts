import { enforceReflectionConfidence, processIncomingRequest } from '../message-router';

describe('Reflection Confidence Enforcement', () => {
  it('accepts reflection with confidence >= threshold', () => {
    const reflection = { confidence: 0.8 };
    const result = enforceReflectionConfidence(reflection);
    expect(result.accept).toBe(true);
  });

  it('rejects reflection with confidence < threshold', () => {
    const reflection = { confidence: 0.5 };
    const result = enforceReflectionConfidence(reflection);
    expect(result.accept).toBe(false);
    expect(result.reason).toMatch(/Confidence below threshold/);
  });

  it('rejects reflection with missing confidence', () => {
    const reflection = { };
    const result = enforceReflectionConfidence(reflection);
    expect(result.accept).toBe(false);
    expect(result.reason).toMatch(/confidence/);
  });

  it('rejects invalid reflection object', () => {
    const result = enforceReflectionConfidence(null);
    expect(result.accept).toBe(false);
    expect(result.reason).toMatch(/invalid/);
  });
});

describe('Router output confidence surfacing', () => {
  it('surfaces confidence and accepted=true for high confidence', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.9,
      final_message: 'High confidence message.'
    };
    const res = await processIncomingRequest({ message: 'test' }, 'http://unused');
    expect(res.data.reflection.confidence).toBe(0.9);
    expect(res.data.reflection.accepted).toBe(true);
  });

  it('surfaces accepted=false for low confidence', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.2,
      final_message: 'Low confidence message.'
    };
    const res = await processIncomingRequest({ message: 'test' }, 'http://unused');
    expect(res.data.reflection.confidence).toBe(0.2);
    expect(res.data.reflection.accepted).toBe(false);
  });

  it('defaults confidence to 0 if malformed', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 'not-a-number',
      final_message: 'Malformed confidence.'
    };
    const res = await processIncomingRequest({ message: 'test' }, 'http://unused');
    expect(res.data.reflection.confidence).toBe(0);
    expect(res.data.reflection.accepted).toBe(false);
  });
});
