import {
  evaluateMemoryPolicy,
  redactMemoryContent,
  canPersistMemory,
  MEMORY_MIN_CONFIDENCE,
  MEMORY_MAX_CHARS,
} from '../message-router';

describe('Memory Policy Helpers', () => {
  const defaultSettings = { saveConversationHistory: true };

  it('denies when saveConversationHistory=false', () => {
    const res = evaluateMemoryPolicy({ text: 'test', confidence: 1, settings: { saveConversationHistory: false } });
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/disabled/);
  });

  it('denies when confidence < threshold', () => {
    const res = evaluateMemoryPolicy({ text: 'test', confidence: MEMORY_MIN_CONFIDENCE - 0.01, settings: defaultSettings });
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/confidence/);
  });

  it('redacts when over max length', () => {
    const longText = 'a'.repeat(MEMORY_MAX_CHARS + 1);
    const res = evaluateMemoryPolicy({ text: longText, confidence: 1, settings: defaultSettings });
    expect(res.decision).toBe('redact');
    expect(res.reason).toMatch(/max length/);
  });

  it('denies sensitive deny patterns', () => {
    const res = evaluateMemoryPolicy({ text: 'my password is 123', confidence: 1, settings: defaultSettings });
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/denied by pattern/);
  });

  it('denies when content matches deny patterns even if redactable', () => {
    const res = evaluateMemoryPolicy({ text: 'api key: 123', confidence: 1, settings: defaultSettings });
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/denied by pattern/);
  });

  it('allows clean, short, confident content', () => {
    const res = evaluateMemoryPolicy({ text: 'user prefers dark mode', confidence: 1, settings: defaultSettings });
    expect(res.decision).toBe('allow');
  });

  it('redaction is idempotent', () => {
    const text = 'api key: 123';
    const once = redactMemoryContent(text);
    const twice = redactMemoryContent(once);
    expect(twice).toBe(once);
  });

  it('redaction never returns empty string', () => {
    const text = 'apikey';
    const redacted = redactMemoryContent(text);
    expect(redacted).not.toBe('');
    expect(redacted).toMatch(/\[REDACTED\]/);
  });

  it('canPersistMemory only allows decision=allow', () => {
    expect(canPersistMemory({ decision: 'allow', confidence: 1 })).toBe(true);
    expect(canPersistMemory({ decision: 'deny', confidence: 1 })).toBe(false);
    expect(canPersistMemory({ decision: 'redact', confidence: 1 })).toBe(false);
  });
});
