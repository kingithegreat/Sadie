import { isSmallModel, getSystemPromptForModel } from '../message-router';
import { HOMEBOT_SYSTEM_PROMPT, HOMEBOT_SYSTEM_PROMPT_COMPACT } from '../../shared/system-prompt';

// ── isSmallModel ─────────────────────────────────────────────────────────────

describe('isSmallModel', () => {
  // Models that ARE small
  const smallModels = [
    'llama3.2:1b',
    'llama3.2:3b',
    'llama3.2:1b-instruct-q4_K_M',
    'phi3:3b',
    'phi3-mini',
    'phi-3-mini',
    'phi3mini',
    'gemma:2b',
    'qwen:0.5b',
    'qwen:1b',
    'qwen2:1b',
    'smollm',
    'smollm:135m',
    'tinyllama',
    'tinyllama:1.1b',
    'tinydolphin',
    // Cloud API small models
    'claude-3-haiku-20240307',
    'claude-3-5-haiku-20241022',
    'gpt-3.5-turbo',
    'gpt-4o-mini',
    'o1-mini',
  ];

  // Models that are NOT small
  const largeModels = [
    'llama3.2:8b',
    'llama3.1:70b',
    'mistral:7b',
    'codellama:13b',
    'deepseek-r1:14b',
    'dolphin-llama3:8b',
    'gemma:7b',
    'qwen2:7b',
    'phi3:14b',
    'llama3.2',           // no explicit size tag → treat as normal
    '',
    // Cloud API large models
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'gpt-4o',
    'gpt-4-turbo',
  ];

  test.each(smallModels)('"%s" → true', (model) => {
    expect(isSmallModel(model)).toBe(true);
  });

  test.each(largeModels)('"%s" → false', (model) => {
    expect(isSmallModel(model)).toBe(false);
  });

  test('matching is case-insensitive', () => {
    expect(isSmallModel('Llama3.2:3B')).toBe(true);
    expect(isSmallModel('TinyLlama')).toBe(true);
  });
});

// ── getSystemPromptForModel ───────────────────────────────────────────────────

describe('getSystemPromptForModel', () => {
  test('small model returns compact prompt', () => {
    const result = getSystemPromptForModel('llama3.2:3b');
    expect(result).toBe(HOMEBOT_SYSTEM_PROMPT_COMPACT);
  });

  test('large model returns full prompt', () => {
    const result = getSystemPromptForModel('llama3.1:8b');
    expect(result).toBe(HOMEBOT_SYSTEM_PROMPT);
  });

  test('compact prompt is shorter than full prompt', () => {
    expect(HOMEBOT_SYSTEM_PROMPT_COMPACT.length).toBeLessThan(HOMEBOT_SYSTEM_PROMPT.length);
  });

  test('guidelines appended for small model', () => {
    const result = getSystemPromptForModel('llama3.2:3b', 'Always respond in French.');
    expect(result).toContain(HOMEBOT_SYSTEM_PROMPT_COMPACT);
    expect(result).toContain('## User Guidelines');
    expect(result).toContain('Always respond in French.');
  });

  test('guidelines appended for large model', () => {
    const result = getSystemPromptForModel('llama3.1:8b', 'Be concise.');
    expect(result).toContain(HOMEBOT_SYSTEM_PROMPT);
    expect(result).toContain('## User Guidelines');
    expect(result).toContain('Be concise.');
  });

  test('empty guidelines string is ignored', () => {
    const result = getSystemPromptForModel('llama3.2:3b', '');
    expect(result).toBe(HOMEBOT_SYSTEM_PROMPT_COMPACT);
    expect(result).not.toContain('## User Guidelines');
  });

  test('whitespace-only guidelines string is ignored', () => {
    const result = getSystemPromptForModel('llama3.1:8b', '   \n  ');
    expect(result).toBe(HOMEBOT_SYSTEM_PROMPT);
    expect(result).not.toContain('## User Guidelines');
  });

  test('undefined guidelines returns base prompt unchanged', () => {
    expect(getSystemPromptForModel('llama3.2:3b', undefined)).toBe(HOMEBOT_SYSTEM_PROMPT_COMPACT);
    expect(getSystemPromptForModel('mistral:7b', undefined)).toBe(HOMEBOT_SYSTEM_PROMPT);
  });
});
