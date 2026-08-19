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

// ── cloud fallback offer ────────────────────────────────────────────────────
//
// The offer is the renderer's ONLY permission to draw "use the online AI
// instead". It must appear when a switch would genuinely work, and be absent
// every other time — an offer that leads to a second identical failure is
// worse than no offer, and one that leads to data leaving the machine against
// the user's privacy choice is worse than that.

describe('classifyError cloud fallback offer', () => {
  const CONFIGURED_CLOUD = {
    useCustomLLM: false,                  // privacy switch: local only
    customLLM: { enabled: false, provider: 'anthropic', model: 'claude-sonnet-5', apiUrl: '' },
    anthropicApiKey: 'sk-ant-test',       // ...but a usable key is already saved
  } as any;

  const LOCAL_FAILURES: Array<[string, string, string]> = [
    ['Ollama stopped',    'Ollama error',                     'connect ECONNREFUSED 127.0.0.1:11434'],
    ['both unavailable',  'Both n8n and Ollama unavailable',  'connect ECONNREFUSED'],
    ['local timeout',     'Streaming error',                  'ETIMEDOUT'],
  ];

  test.each(LOCAL_FAILURES)('offers the switch on %s when a provider is ready', (_label, message, details) => {
    const hint = classifyError(message, details, CONFIGURED_CLOUD);
    expect(hint.cloudFallback).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  test('no offer when no cloud provider is configured', () => {
    const hint = classifyError('Ollama error', 'ECONNREFUSED', {} as any);
    expect(hint.cloudFallback).toBeUndefined();
  });

  test('no offer when the provider is configured but has no key', () => {
    const noKey = { ...CONFIGURED_CLOUD, anthropicApiKey: '' };
    const hint = classifyError('Ollama error', 'ECONNREFUSED', noKey);
    expect(hint.cloudFallback).toBeUndefined();
  });

  test('no offer when the provider has no model selected', () => {
    const noModel = { ...CONFIGURED_CLOUD, customLLM: { ...CONFIGURED_CLOUD.customLLM, model: '' } };
    const hint = classifyError('Ollama error', 'ECONNREFUSED', noModel);
    expect(hint.cloudFallback).toBeUndefined();
  });

  test('no offer when the user is ALREADY on cloud — cloud is not the escape hatch', () => {
    const onCloud = { ...CONFIGURED_CLOUD, useCustomLLM: true };
    const hint = classifyError('Ollama error', 'ECONNREFUSED', onCloud);
    expect(hint.cloudFallback).toBeUndefined();
  });

  test('no offer while uncensored mode is on — it promises the local model', () => {
    const uncensored = { ...CONFIGURED_CLOUD, uncensoredMode: true };
    const hint = classifyError('Ollama error', 'ECONNREFUSED', uncensored);
    expect(hint.cloudFallback).toBeUndefined();
  });

  test('no offer when settings cannot be read at all', () => {
    const hint = classifyError('Ollama error', 'ECONNREFUSED', null);
    expect(hint.cloudFallback).toBeUndefined();
  });

  test('a cloud-side failure never offers cloud as its own remedy', () => {
    const hint = classifyError('Cloud API error (ANTHROPIC): status code 429', '', CONFIGURED_CLOUD);
    expect(hint.cloudFallback).toBeUndefined();
    expect(hint.action).toBe('check-settings');
  });

  test('the offer does not flip the privacy switch by itself', () => {
    const { saveSettings } = jest.requireMock('../config-manager');
    saveSettings.mockClear();
    classifyError('Ollama error', 'ECONNREFUSED', CONFIGURED_CLOUD);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  test('the wording mentions the alternative only when it is actually offered', () => {
    const withOffer = classifyError('Ollama error', 'ECONNREFUSED', CONFIGURED_CLOUD);
    expect(withOffer.userMessage).toMatch(/online AI/i);

    const withoutOffer = classifyError('Ollama error', 'ECONNREFUSED', {} as any);
    expect(withoutOffer.userMessage).not.toMatch(/online AI/i);
  });
});
