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
    expect(hint.userMessage).toContain('ollama serve');
  });

  test('detects Ollama ECONNRESET', () => {
    const hint = classifyError('Ollama error', 'socket hang up ECONNRESET');
    expect(hint.service).toBe('ollama');
    expect(hint.action).toBe('start-ollama');
  });

  test('detects both services unavailable', () => {
    const hint = classifyError('Both n8n and Ollama unavailable', 'ECONNREFUSED');
    expect(hint.service).toBe('ollama');
    expect(hint.userMessage).toContain('Ollama');
    expect(hint.action).toBe('start-ollama');
  });

  test('detects model not found with model name', () => {
    const hint = classifyError('Ollama error', 'model "qwen2.5:7b" not found');
    expect(hint.service).toBe('model');
    expect(hint.action).toBe('pull-model');
    expect(hint.model).toBe('qwen2.5:7b');
    expect(hint.actionLabel).toContain('Pull');
    expect(hint.userMessage).toContain('ollama pull');
  });

  test('detects model not found without specific model name', () => {
    const hint = classifyError('Ollama error', 'not found');
    expect(hint.service).toBe('model');
  });

  test('detects n8n upstream error', () => {
    const hint = classifyError('Upstream error (n8n unavailable)', 'probe:502');
    expect(hint.service).toBe('n8n');
    expect(hint.userMessage).toContain('n8n');
    expect(hint.action).toBe('retry');
  });

  test('detects timeout', () => {
    const hint = classifyError('Request timed out', 'ETIMEDOUT');
    expect(hint.service).toBe('unknown');
    expect(hint.action).toBe('retry');
    expect(hint.userMessage).toContain('timed out');
  });

  test('detects cloud rate limit errors', () => {
    const hint = classifyError('Cloud API error (OPENAI gpt-4o): Request failed with status code 429');
    expect(hint.service).toBe('unknown');
    expect(hint.action).toBe('check-settings');
    expect(hint.actionLabel).toBe('Settings');
    expect(hint.userMessage).toContain('cloud provider');
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
