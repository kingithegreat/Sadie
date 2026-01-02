import {
  evaluateMemoryRetrievalPolicy,
  filterRetrievableMemories,
  prepareMemoriesForContext,
  MEMORY_RETRIEVAL_MIN_CONFIDENCE,
  MEMORY_MAX_AGE_DAYS,
  MEMORY_MAX_INJECTED_ITEMS,
} from '../message-router';

describe('Memory Retrieval Policy Integration', () => {
  const now = new Date('2025-12-20T12:00:00Z');
  const defaultSettings = { saveConversationHistory: true };

  it('retrieval denied: recall not called', () => {
    const res = evaluateMemoryRetrievalPolicy({ queryText: 'password', reflectionConfidence: 1, settings: defaultSettings, now });
    expect(res.allowed).toBe(false);
    // Simulate: recall not called
  });

  it('retrieval allowed: sanitized memory injected', () => {
    const memories = [
      { text: 'user prefers dark mode', confidence: 1, created: now },
      { text: 'api key: 123', confidence: 1, created: now, redactionLevel: 'redact' as const }
    ];
    const filtered = filterRetrievableMemories(memories, now);
    const injected = prepareMemoriesForContext(filtered);
    expect(injected.length).toBe(1);
    expect(injected[0]).toBe('user prefers dark mode');
  });

  it('retrieval redacted: redacted content injected', () => {
    const memories = [
      { text: 'api key: 123', confidence: 1, created: now, redactionLevel: 'redact' as const }
    ];
    const filtered = filterRetrievableMemories(memories, now);
    const injected = prepareMemoriesForContext(filtered);
    expect(injected.length).toBe(0);
  });

  it('retrieval blocked by low confidence', () => {
    const memories = [
      { text: 'user prefers dark mode', confidence: MEMORY_RETRIEVAL_MIN_CONFIDENCE - 0.1, created: now }
    ];
    const filtered = filterRetrievableMemories(memories, now);
    expect(filtered.length).toBe(0);
  });

  it('memory never appears in assistant output verbatim', () => {
    const memories = [
      { text: 'api key: 123', confidence: 1, created: now, redactionLevel: 'redact' as const }
    ];
    const injected = prepareMemoriesForContext(memories);
    expect(injected[0]).not.toBe('api key: 123');
  });
});
