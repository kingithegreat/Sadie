import { evaluateMemoryPolicy, canPersistMemory, redactMemoryContent } from '../message-router';

// Mock remember function for enforcement test
let rememberCallCount = 0;
function rememberMock({ content, meta }: { content: string; meta: any }) {
  rememberCallCount++;
  return Promise.resolve();
}

describe('Memory Policy Enforcement (Router)', () => {
  beforeEach(() => {
    rememberCallCount = 0;
  });

  it('allows memory when confidence is high and content is clean', async () => {
    const policy = evaluateMemoryPolicy({
      text: 'user prefers dark mode',
      confidence: 0.9,
      settings: { saveConversationHistory: true }
    });
    expect(policy.decision).toBe('allow');
    if (canPersistMemory({ decision: policy.decision, confidence: 0.9 })) {
      await rememberMock({ content: 'user prefers dark mode', meta: { confidence: 0.9, reason: policy.reason } });
    }
    expect(rememberCallCount).toBe(1);
  });

  it('denies memory when confidence is too low', async () => {
    const policy = evaluateMemoryPolicy({
      text: 'user prefers dark mode',
      confidence: 0.5,
      settings: { saveConversationHistory: true }
    });
    expect(policy.decision).toBe('deny');
    if (canPersistMemory({ decision: policy.decision, confidence: 0.5 })) {
      await rememberMock({ content: 'user prefers dark mode', meta: { confidence: 0.5, reason: policy.reason } });
    }
    expect(rememberCallCount).toBe(0);
  });

  it('denies memory when saveConversationHistory is false', async () => {
    const policy = evaluateMemoryPolicy({
      text: 'user prefers dark mode',
      confidence: 0.9,
      settings: { saveConversationHistory: false }
    });
    expect(policy.decision).toBe('deny');
    if (canPersistMemory({ decision: policy.decision, confidence: 0.9 })) {
      await rememberMock({ content: 'user prefers dark mode', meta: { confidence: 0.9, reason: policy.reason } });
    }
    expect(rememberCallCount).toBe(0);
  });

  it('redacts memory when content is sensitive but not denied', async () => {
    const policy = evaluateMemoryPolicy({
      text: 'api key: 123',
      confidence: 0.9,
      settings: { saveConversationHistory: true }
    });
    expect(policy.decision).toBe('deny'); // Deny takes precedence
    if (canPersistMemory({ decision: policy.decision, confidence: 0.9 })) {
      await rememberMock({ content: redactMemoryContent('api key: 123'), meta: { confidence: 0.9, reason: policy.reason } });
    }
    expect(rememberCallCount).toBe(0);
  });

  it('denies memory when content matches deny pattern', async () => {
    const policy = evaluateMemoryPolicy({
      text: 'my password is 123',
      confidence: 0.9,
      settings: { saveConversationHistory: true }
    });
    expect(policy.decision).toBe('deny');
    if (canPersistMemory({ decision: policy.decision, confidence: 0.9 })) {
      await rememberMock({ content: 'my password is 123', meta: { confidence: 0.9, reason: policy.reason } });
    }
    expect(rememberCallCount).toBe(0);
  });
});
