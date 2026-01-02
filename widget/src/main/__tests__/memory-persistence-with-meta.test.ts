

const mr = require('../message-router');
const memory = require('../tools/memory');
const reflectionMeta = require('../reflection-meta');

describe('memory persistence with reflection metadata', () => {
  it('persists memory with reflection meta when allowed', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.95,
      final_message: 'Remember this'
    };
    // Simulate a processIncomingRequest call
    const res = await mr.processIncomingRequest(
      { message: 'remember this' } as any,
      'http://unused'
    );
    // Check the reflection meta in the response
    expect(res.data.reflection.confidence).toBe(0.95);
    expect(res.data.reflection.accepted).toBe(true);
    expect(res.data.assistant.content).toBe('Remember this');
  });
});
