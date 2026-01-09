import {
  evaluateMemoryRetrievalPolicy,
  filterRetrievableMemories,
  prepareMemoriesForContext,
  MEMORY_RETRIEVAL_MIN_CONFIDENCE,
  MEMORY_MAX_AGE_DAYS,
  MEMORY_MAX_INJECTED_ITEMS,
} from '../message-router';

describe('Memory Retrieval Policy Helpers', () => {
  const now = new Date('2025-12-20T12:00:00Z');
  const defaultSettings = { saveConversationHistory: true };

  it('denies when saveConversationHistory=false', () => {
    const res = evaluateMemoryRetrievalPolicy({ queryText: 'test', reflectionConfidence: 1, settings: { saveConversationHistory: false }, now });
    expect(res.allowed).toBe(false);
  });

  it('denies when reflectionConfidence < threshold', () => {
    const res = evaluateMemoryRetrievalPolicy({ queryText: 'test', reflectionConfidence: MEMORY_RETRIEVAL_MIN_CONFIDENCE - 0.01, settings: defaultSettings, now });
    expect(res.allowed).toBe(false);
  });

  it('denies when query matches deny pattern', () => {
    const res = evaluateMemoryRetrievalPolicy({ queryText: 'my password', reflectionConfidence: 1, settings: defaultSettings, now });
    expect(res.allowed).toBe(false);
  });

  it('excludes expired memories', () => {
    const old = new Date(now.getTime() - (MEMORY_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    const memories = [{ text: 'recent', confidence: 1, created: now }, { text: 'old', confidence: 1, created: old }];
    const filtered = filterRetrievableMemories(memories, now);
    expect(filtered.map(m => m.text)).toContain('recent');
    expect(filtered.map(m => m.text)).not.toContain('old');
  });

  it('excludes low-confidence memories', () => {
    const memories = [{ text: 'ok', confidence: MEMORY_RETRIEVAL_MIN_CONFIDENCE, created: now }, { text: 'bad', confidence: MEMORY_RETRIEVAL_MIN_CONFIDENCE - 0.1, created: now }];
    const filtered = filterRetrievableMemories(memories, now);
    expect(filtered.map(m => m.text)).toContain('ok');
    expect(filtered.map(m => m.text)).not.toContain('bad');
  });

  it('redacts sensitive memory content', () => {
    const memories = [{ text: 'api key: 123', confidence: 1, created: now, redactionLevel: 'redact' as const }];
    const out = prepareMemoriesForContext(memories);
    expect(out[0]).toMatch(/\[REDACTED\]/);
  });

  it('redaction is idempotent', () => {
    const memories = [{ text: 'api key: 123', confidence: 1, created: now, redactionLevel: 'redact' as const }];
    const once = prepareMemoriesForContext(memories);
    const twice = prepareMemoriesForContext([{ ...memories[0], text: once[0], redactionLevel: 'redact' as const }]);
    expect(twice[0]).toBe(once[0]);
  });

  it('limits injected memory count', () => {
    const memories = Array.from({ length: MEMORY_MAX_INJECTED_ITEMS + 2 }, (_, i) => ({ text: `mem${i}`, confidence: 1, created: now }));
    const out = prepareMemoriesForContext(memories);
    expect(out.length).toBe(MEMORY_MAX_INJECTED_ITEMS);
  });
});
