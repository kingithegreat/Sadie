/**
 * Tests for the error recovery hint classification system.
 *
 * classifyError() takes a stream-error message + details and returns
 * an actionable RecoveryHint the renderer uses to show specific fix guidance.
 */

// Mock dependencies that message-router imports
jest.mock('axios');
jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => ({})),
  saveSettings: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
  logTelemetryEvent: jest.fn(),
}));
jest.mock('child_process', () => ({
  execFile: jest.fn(),
  exec: jest.fn((_cmd: string, cb: any) => cb(null, '', '')),
  spawn: jest.fn(),
}));
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp'),
    on: jest.fn(),
    isPackaged: false,
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
  BrowserWindow: jest.fn(),
}));

import { classifyError } from '../message-router';

// ── classifyError ───────────────────────────────────────────────────────────

describe('classifyError', () => {
  test('detects Ollama connection refused', () => {
    const hint = classifyError('Ollama error', 'connect ECONNREFUSED 127.0.0.1:11434');
    expect(hint.service).toBe('ollama');
    expect(hint.action).toBe('start-ollama');
    expect(hint.userMessage).toMatch(/isn't running|not running/i);
  });

  test('detects Ollama ECONNRESET', () => {
    const hint = classifyError('Ollama error', 'socket hang up ECONNRESET');
    expect(hint.service).toBe('ollama');
    expect(hint.action).toBe('start-ollama');
  });

  test('detects both services unavailable', () => {
    const hint = classifyError('Both n8n and Ollama unavailable', 'ECONNREFUSED');
    expect(hint.service).toBe('ollama');
    expect(hint.userMessage).toMatch(/can't reach|cannot reach/i);
    expect(hint.action).toBe('start-ollama');
  });

  test('detects model not found with model name', () => {
    const hint = classifyError('Ollama error', 'model "qwen2.5:7b" not found');
    expect(hint.service).toBe('model');
    expect(hint.action).toBe('pull-model');
    expect(hint.model).toBe('qwen2.5:7b');
    expect(hint.actionLabel).toContain('Pull');
    expect(hint.userMessage).toMatch(/download/i);
  });

  test('detects model not found without specific model name', () => {
    const hint = classifyError('Ollama error', 'not found');
    expect(hint.service).toBe('model');
  });

  test('detects n8n upstream error', () => {
    const hint = classifyError('Upstream error (n8n unavailable)', 'probe:502');
    expect(hint.service).toBe('n8n');
    expect(hint.userMessage).toMatch(/automations/i);
    expect(hint.action).toBe('retry');
  });

  test('detects timeout', () => {
    const hint = classifyError('Request timed out', 'ETIMEDOUT');
    expect(hint.service).toBe('unknown');
    expect(hint.action).toBe('retry');
    expect(hint.userMessage).toMatch(/too long/i);
  });

  test('detects cloud rate limit errors', () => {
    const hint = classifyError('Cloud API error (OPENAI gpt-4o): Request failed with status code 429');
    expect(hint.service).toBe('unknown');
    expect(hint.action).toBe('check-settings');
    expect(hint.actionLabel).toBe('Settings');
    expect(hint.userMessage).toMatch(/online AI service/i);
  });

  /**
   * The test above passes and proved nothing, because it calls classifyError the
   * way NO production path ever does.
   *
   * Both call sites hard-code the label: finishFailedStream is invoked with
   * `errorLabel: 'Ollama error'` (message-router.ts:4816) and
   * `'Ollama streaming error'` (:5461), and there are only those two. The cloud
   * text always arrives as `details`, never as `message`.
   *
   * classifyError joins them — `${message} ${details}` — so `combined` contains
   * the words "ollama" and "error" for EVERY failure, which makes the
   * connection-refused branch match unconditionally and return before the cloud
   * branch is ever reached.
   *
   * Net effect for a user on a cloud provider: a rejected key, an exhausted
   * quota or a 429 all render "The AI on this PC isn't running. Start it below",
   * with a Start Ollama button. They press it, are told Ollama is running, retry,
   * and fail identically — with the actual fix (Settings → key/billing) never
   * mentioned.
   *
   * These tests call it with the arguments production actually produces.
   */
  describe('cloud failures, called the way production calls it', () => {
    const CLOUD_CASES: Array<[string, string]> = [
      ['rate limit', 'Cloud API error (OPENAI gpt-4o): Request failed with status code 429'],
      ['bad key', 'Cloud API error (ANTHROPIC claude): Request failed with status code 401 unauthorized'],
      ['out of quota', 'Cloud API error (OPENAI gpt-4o): insufficient_quota'],
      ['forbidden', 'Cloud API error (GROQ llama): Request failed with status code 403 forbidden'],
    ];

    test.each(CLOUD_CASES)('%s is not blamed on the local AI', (_name, details) => {
      for (const label of ['Ollama error', 'Ollama streaming error']) {
        const hint = classifyError(label, details);
        expect(hint.action).toBe('check-settings');
        expect(hint.actionLabel).toBe('Settings');
        expect(hint.userMessage).toMatch(/online AI service/i);
        // The specific trap: never offer to start a local service that is not
        // the thing that failed.
        expect(hint.action).not.toBe('start-ollama');
        expect(hint.userMessage).not.toMatch(/on this PC/i);
      }
    });
  });

  test('a genuine local connection failure is still blamed on the local AI', () => {
    // The reordering must not cost us the case the branch exists for.
    for (const details of ['connect ECONNREFUSED 127.0.0.1:11434', 'socket hang up ECONNRESET']) {
      const hint = classifyError('Ollama error', details);
      expect(hint.service).toBe('ollama');
      expect(hint.action).toBe('start-ollama');
      expect(hint.userMessage).toMatch(/on this PC/i);
    }
  });

  test('returns generic retry for unknown errors', () => {
    const hint = classifyError('Something unexpected happened', 'weird error');
    expect(hint.service).toBe('unknown');
    expect(hint.action).toBe('retry');
    expect(hint.actionLabel).toBe('Retry');
  });

  test('handles empty details gracefully', () => {
    const hint = classifyError('Ollama error');
    expect(hint).toBeDefined();
    expect(hint.service).toBe('ollama');
  });

  test('every hint has a userMessage string', () => {
    const cases = [
      classifyError('Ollama error', 'ECONNREFUSED'),
      classifyError('Upstream error', 'n8n timeout'),
      classifyError('Unknown', ''),
      classifyError('model not found', '404'),
    ];
    for (const hint of cases) {
      expect(typeof hint.userMessage).toBe('string');
      expect(hint.userMessage.length).toBeGreaterThan(0);
    }
  });

  test('every hint has a valid service value', () => {
    const valid = ['ollama', 'n8n', 'model', 'unknown'];
    const hint = classifyError('random error');
    expect(valid).toContain(hint.service);
  });
});

describe('classifyError — plain language guarantee', () => {
  // The renderer draws a StartOllamaButton / PullModelButton directly beneath
  // these messages, so a shell command in the text is both jargon AND redundant
  // with the button under it. This guard is the point of the whole change: the
  // previous assertions REQUIRED "ollama serve" and "ollama pull", so the jargon
  // was pinned in place by the tests meant to protect the behaviour.
  const JARGON =
    /(^|[^a-z])(ollama|n8n|backend|vram|api|localhost|econn[a-z]*|stderr|npm|cli|serve)([^a-z]|$)/i;

  const SAMPLES = [
    'ECONNREFUSED connecting to ollama',
    'both services unavailable',
    'model "qwen2.5:7b" not found (404)',
    'n8n upstream failure',
    'ETIMEDOUT',
    'Cloud API error (OPENAI gpt-4o): status code 429',
    'something entirely unexpected',
  ];

  test.each(SAMPLES)('no jargon reaches the user for: %s', (input) => {
    const hint = classifyError(input);
    expect(hint.userMessage).not.toMatch(JARGON);
    expect(hint.userMessage.length).toBeGreaterThan(15);
  });

  test('every hint offers a way forward', () => {
    for (const input of SAMPLES) {
      const hint = classifyError(input);
      expect(hint.action).toBeTruthy();
      expect(hint.actionLabel).toBeTruthy();
    }
  });
});
