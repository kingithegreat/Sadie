import {
  isSmallModel,
  MAX_HISTORY_MESSAGES,
  SMALL_MODEL_HISTORY_MESSAGES,
  SMALL_MODEL_DIGEST_CHARS,
  SMALL_MODEL_MEMORY_CHARS,
} from '../message-router';

// ── Constant sanity checks ───────────────────────────────────────────────────

describe('context budget constants', () => {
  test('SMALL_MODEL_HISTORY_MESSAGES is strictly less than MAX_HISTORY_MESSAGES', () => {
    expect(SMALL_MODEL_HISTORY_MESSAGES).toBeLessThan(MAX_HISTORY_MESSAGES);
  });

  test('SMALL_MODEL_HISTORY_MESSAGES is at least 4 (enough for one exchange + context)', () => {
    expect(SMALL_MODEL_HISTORY_MESSAGES).toBeGreaterThanOrEqual(4);
  });

  test('SMALL_MODEL_DIGEST_CHARS caps digest to a reasonable size', () => {
    expect(SMALL_MODEL_DIGEST_CHARS).toBeGreaterThan(0);
    expect(SMALL_MODEL_DIGEST_CHARS).toBeLessThanOrEqual(1000);
  });

  test('SMALL_MODEL_MEMORY_CHARS caps memory recall to a reasonable size', () => {
    expect(SMALL_MODEL_MEMORY_CHARS).toBeGreaterThan(0);
    expect(SMALL_MODEL_MEMORY_CHARS).toBeLessThanOrEqual(1000);
  });

  test('MAX_HISTORY_MESSAGES equals 50', () => {
    expect(MAX_HISTORY_MESSAGES).toBe(50);
  });

  test('small-model caps equal the documented values', () => {
    expect(SMALL_MODEL_HISTORY_MESSAGES).toBe(12);
    expect(SMALL_MODEL_DIGEST_CHARS).toBe(500);
    expect(SMALL_MODEL_MEMORY_CHARS).toBe(300);
  });
});

// ── History trimming behaviour ───────────────────────────────────────────────

describe('history trimming with context budget', () => {
  /** Simulates the same trim logic used in message-router.ts */
  function trimHistory(history: string[], model: string): string[] {
    const smallModel = isSmallModel(model);
    const max = smallModel ? SMALL_MODEL_HISTORY_MESSAGES : MAX_HISTORY_MESSAGES;
    return history.slice(-max);
  }

  test('small model trims to SMALL_MODEL_HISTORY_MESSAGES', () => {
    const history = Array.from({ length: 30 }, (_, i) => `msg-${i}`);
    const trimmed = trimHistory(history, 'llama3.2:3b');
    expect(trimmed).toHaveLength(SMALL_MODEL_HISTORY_MESSAGES);
    expect(trimmed[0]).toBe(`msg-${30 - SMALL_MODEL_HISTORY_MESSAGES}`);
  });

  test('large model trims to MAX_HISTORY_MESSAGES', () => {
    const history = Array.from({ length: 80 }, (_, i) => `msg-${i}`);
    const trimmed = trimHistory(history, 'llama3.1:70b');
    expect(trimmed).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(trimmed[0]).toBe(`msg-${80 - MAX_HISTORY_MESSAGES}`);
  });

  test('short history is returned unchanged for small model', () => {
    const history = ['a', 'b', 'c'];
    expect(trimHistory(history, 'phi3:3b')).toEqual(history);
  });

  test('short history is returned unchanged for large model', () => {
    const history = ['a', 'b', 'c'];
    expect(trimHistory(history, 'mistral:7b')).toEqual(history);
  });
});

// ── Digest capping behaviour ─────────────────────────────────────────────────

describe('digest capping with context budget', () => {
  /** Simulates the digest-cap logic from message-router.ts */
  function capDigest(raw: string | undefined, model: string): string | undefined {
    if (!raw) return raw;
    const smallModel = isSmallModel(model);
    return smallModel ? raw.slice(-SMALL_MODEL_DIGEST_CHARS) : raw;
  }

  test('small model caps long digest to SMALL_MODEL_DIGEST_CHARS', () => {
    const long = 'x'.repeat(2000);
    const result = capDigest(long, 'llama3.2:1b');
    expect(result).toHaveLength(SMALL_MODEL_DIGEST_CHARS);
  });

  test('large model passes digest through unchanged', () => {
    const long = 'x'.repeat(2000);
    const result = capDigest(long, 'deepseek-r1:14b');
    expect(result).toHaveLength(2000);
  });

  test('short digest is unchanged for small model', () => {
    const short = 'hello';
    expect(capDigest(short, 'tinyllama')).toBe(short);
  });

  test('undefined digest stays undefined', () => {
    expect(capDigest(undefined, 'llama3.2:3b')).toBeUndefined();
  });
});

// ── Memory recall capping behaviour ──────────────────────────────────────────

describe('memory recall capping with context budget', () => {
  /** Simulates the memory-cap logic from message-router.ts */
  function capMemory(recalled: string | null, model: string): string | null {
    if (!recalled) return recalled;
    const smallModel = isSmallModel(model);
    return smallModel ? recalled.slice(0, SMALL_MODEL_MEMORY_CHARS) : recalled;
  }

  test('small model caps long memory to SMALL_MODEL_MEMORY_CHARS', () => {
    const long = 'y'.repeat(1000);
    const result = capMemory(long, 'gemma:2b');
    expect(result).toHaveLength(SMALL_MODEL_MEMORY_CHARS);
  });

  test('large model passes memory through unchanged', () => {
    const long = 'y'.repeat(1000);
    expect(capMemory(long, 'llama3.1:70b')).toHaveLength(1000);
  });

  test('short memory is unchanged for small model', () => {
    expect(capMemory('likes cats', 'qwen:1b')).toBe('likes cats');
  });

  test('null memory stays null', () => {
    expect(capMemory(null, 'llama3.2:3b')).toBeNull();
  });
});
