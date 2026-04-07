/**
 * Tests for small-model optimization features:
 * - isSmallModel / getSystemPromptForModel
 * - detectToolCategories
 * - handleSlashCommand (/compact, /status, /reset)
 * - ragSearch (auto-injection helper)
 * - matchSkills (skills loader)
 */

// Inline mocks that must precede the module import
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp/sadie-test'), getName: jest.fn(() => 'SADIE'), getVersion: jest.fn(() => '0.0.0-test') },
  ipcMain: { on: jest.fn(), handle: jest.fn(), removeHandler: jest.fn() },
  BrowserWindow: jest.fn(),
  dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
}));
jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => ({})),
  saveSettings: jest.fn(),
  assertPermission: jest.fn(() => true),
}));
jest.mock('../memory-manager', () => ({
  MemoryManager: { getConversation: jest.fn(), loadConversation: jest.fn() },
}));
jest.mock('../tools', () => ({
  initializeTools: jest.fn(),
  getOllamaTools: jest.fn(() => []),
  getSmallModelTools: jest.fn(() => []),
  getAllToolDefinitions: jest.fn(() => []),
  executeToolBatch: jest.fn(async () => []),
  hasTool: jest.fn(() => false),
}));
jest.mock('../tools/enrichment', () => ({
  enrichNbaGames: jest.fn(async () => ''),
  enrichWeather: jest.fn(async () => ''),
  enrichGenericQuery: jest.fn(async () => ''),
}));
jest.mock('../tools/web', () => ({
  setTavilyApiKey: jest.fn(),
  setSerperApiKey: jest.fn(),
  setOpenaiApiKey: jest.fn(),
}));
jest.mock('../webhook-auth', () => ({
  sadieWebhookHeaders: jest.fn(() => ({})),
}));
jest.mock('../custom-llm-client', () => ({
  streamFromCustomLLM: jest.fn(),
  validateCustomLLMConfig: jest.fn(() => ({ valid: false, error: 'not configured' })),
}));
jest.mock('../mcp-client', () => ({
  initializeMcpServers: jest.fn(),
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
}));
jest.mock('../permission-requester', () => ({
  permissionRequester: { request: jest.fn() },
}));
jest.mock('../env', () => ({
  isE2E: false,
  isPackagedBuild: false,
}));
jest.mock('../../shared/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logTelemetryEvent: jest.fn(),
}));
jest.mock('../stream-proxy-client', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../tools/rag', () => {
  const actual: any = jest.requireActual('../tools/rag');
  return {
    ...actual,
    ragToolDefs: actual.ragToolDefs,
    ragToolHandlers: actual.ragToolHandlers,
  };
});

import {
  isSmallModel,
  getSystemPromptForModel,
  detectToolCategories,
  handleSlashCommand,
} from '../message-router';
import { ragSearch, tokenize, cosineSim } from '../tools/rag';
import { SADIE_SYSTEM_PROMPT_COMPACT } from '../../shared/system-prompt';

// ── isSmallModel ────────────────────────────────────────────────────────────

describe('isSmallModel', () => {
  it('detects integer size tags :1b–:3b', () => {
    expect(isSmallModel('llama3.2:3b')).toBe(true);
    expect(isSmallModel('qwen2.5-coder:3b')).toBe(true);
    expect(isSmallModel('phi3:1b')).toBe(true);
    expect(isSmallModel('model:2b')).toBe(true);
  });

  it('detects decimal size tags like :2.7b and :1.5b', () => {
    expect(isSmallModel('dolphin-phi:2.7b')).toBe(true);
    expect(isSmallModel('qwen2.5:1.5b')).toBe(true);
    expect(isSmallModel('qwen2.5:0.5b')).toBe(true);
    expect(isSmallModel('phi3.5:3.8b')).toBe(true);
  });

  it('rejects larger models', () => {
    expect(isSmallModel('llama3.2:8b')).toBe(false);
    expect(isSmallModel('dolphin-llama3:8b')).toBe(false);
    expect(isSmallModel('qwen2.5:7b')).toBe(false);
    expect(isSmallModel('claude-sonnet-4-20250514')).toBe(false);
  });

  it('detects known small family names', () => {
    expect(isSmallModel('tinyllama')).toBe(true);
    expect(isSmallModel('smollm')).toBe(true);
    expect(isSmallModel('phi-mini')).toBe(true);
  });

  it('detects 4GB-friendly model families added for hardware profile support', () => {
    // moondream — 1.8B vision model, 4GB-friendly replacement for llava
    expect(isSmallModel('moondream')).toBe(true);
    // dolphin-phi — 2.7B uncensored model, 4GB-friendly replacement for dolphin-llama3:8b
    expect(isSmallModel('dolphin-phi')).toBe(true);
    expect(isSmallModel('dolphin-phi:2.7b')).toBe(true);
    // gemma2:2b
    expect(isSmallModel('gemma2:2b')).toBe(true);
  });

  it('does not mis-classify phi3.5 without mini suffix as small', () => {
    // phi3.5 at 14b should NOT be small — only the mini variant qualifies
    expect(isSmallModel('phi3.5:14b')).toBe(false);
  });
});

// ── getSystemPromptForModel ─────────────────────────────────────────────────

describe('getSystemPromptForModel', () => {
  it('uses compact prompt for small models', () => {
    const prompt = getSystemPromptForModel('llama3.2:3b');
    expect(prompt).toContain('Think step by step');
    expect(prompt).toContain('TOOL EXAMPLES');
  });

  it('uses verbose prompt for large models', () => {
    const prompt = getSystemPromptForModel('llama3.2:8b');
    expect(prompt).not.toContain('TOOL EXAMPLES');
    expect(prompt).toContain('HONESTY');
  });

  it('appends user guidelines when present', () => {
    const prompt = getSystemPromptForModel('llama3.2:3b', 'Always respond in French');
    expect(prompt).toContain('Always respond in French');
  });
});

// ── detectToolCategories ────────────────────────────────────────────────────

describe('detectToolCategories', () => {
  it('returns web for weather queries', () => {
    const cats = detectToolCategories('What is the weather in London?');
    expect(cats).toContain('web');
  });

  it('returns filesystem for file operations', () => {
    const cats = detectToolCategories('Create a file on my desktop');
    expect(cats).toContain('filesystem');
  });

  it('returns empty array for vague queries (core-tool fallback)', () => {
    expect(detectToolCategories('hello there')).toEqual([]);
  });

  it('returns empty array when too many categories match (core-tool fallback)', () => {
    // This message hits many categories at once
    const cats = detectToolCategories('search weather file email code process notification');
    expect(cats).toEqual([]);
  });

  it('returns utility for reminder queries', () => {
    const cats = detectToolCategories('Set a reminder for tomorrow');
    expect(cats).toContain('utility');
  });
});

// ── handleSlashCommand ──────────────────────────────────────────────────────

describe('handleSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(handleSlashCommand('hello', 'conv1', 'llama3.2:3b')).toBeNull();
  });

  it('returns null for unknown slash commands', () => {
    expect(handleSlashCommand('/unknown', 'conv1', 'llama3.2:3b')).toBeNull();
  });

  it('/status returns model info', () => {
    const result = handleSlashCommand('/status', 'slash-test-status', 'llama3.2:3b');
    expect(result).toContain('llama3.2:3b');
    expect(result).toContain('small');
    expect(result).toContain('Model');
  });

  it('/reset clears conversation', () => {
    const result = handleSlashCommand('/reset', 'slash-test-reset', 'llama3.2:3b');
    expect(result).toContain('reset');
  });

  it('/compact on empty conversation', () => {
    const result = handleSlashCommand('/compact', 'slash-test-compact-empty', 'llama3.2:3b');
    expect(result).toContain('empty');
  });
});

// ── Compact prompt content ──────────────────────────────────────────────────

describe('compact prompt enhancements', () => {
  it('includes CoT instruction', () => {
    expect(SADIE_SYSTEM_PROMPT_COMPACT).toContain('Think step by step');
  });

  it('includes few-shot tool examples', () => {
    expect(SADIE_SYSTEM_PROMPT_COMPACT).toContain('TOOL EXAMPLES');
    expect(SADIE_SYSTEM_PROMPT_COMPACT).toContain('get_weather');
    expect(SADIE_SYSTEM_PROMPT_COMPACT).toContain('list_directory');
  });
});

// ── ragSearch ───────────────────────────────────────────────────────────────

describe('ragSearch', () => {
  it('returns null when index is empty', () => {
    expect(ragSearch('test query')).toBeNull();
  });

  it('tokenize strips stopwords', () => {
    const tokens = tokenize('the quick brown fox jumps over the lazy dog');
    expect(tokens).not.toContain('the');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
  });

  it('cosineSim returns 1 for identical vectors', () => {
    const vec = { hello: 1, world: 2 };
    expect(cosineSim(vec, vec)).toBeCloseTo(1.0);
  });

  it('cosineSim returns 0 for orthogonal vectors', () => {
    expect(cosineSim({ a: 1 }, { b: 1 })).toBe(0);
  });
});
