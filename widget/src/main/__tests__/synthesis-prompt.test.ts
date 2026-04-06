/**
 * synthesis-prompt.test.ts
 *
 * Unit tests for makeSynthesisPrompt — the function that wraps pre-fetched
 * search results into a structured LLM prompt.
 *
 * Key invariants we're locking down:
 *  1. [SEARCH RESULTS] / [/SEARCH RESULTS] block present
 *  2. The user question is included at the end
 *  3. Explicit prohibition of "unable to fetch / access / retrieve" hedging
 *  4. Explicit prohibition of redirecting the user to external sources
 *  5. "Answer directly" instruction present
 */

// Heavy Electron / IPC deps — not needed, prevent import errors
jest.mock('electron', () => ({
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));
jest.mock('axios');

import { makeSynthesisPrompt, makeSynthesisPromptCompact } from '../message-router';

const MOCK_CONTEXT = 'Title: Iran War Update\nURL: https://example.com/iran\nContent: US forces attacked Iranian positions on Day 4.';
const MOCK_QUESTION = 'current war in iran';

describe('makeSynthesisPrompt', () => {
  let prompt: string;

  beforeAll(() => {
    prompt = makeSynthesisPrompt(MOCK_CONTEXT, MOCK_QUESTION);
  });

  test('wraps context in [SEARCH RESULTS] block', () => {
    expect(prompt).toContain('[SEARCH RESULTS]');
    expect(prompt).toContain('[/SEARCH RESULTS]');
    expect(prompt.indexOf('[SEARCH RESULTS]')).toBeLessThan(prompt.indexOf(MOCK_CONTEXT));
    expect(prompt.indexOf(MOCK_CONTEXT)).toBeLessThan(prompt.indexOf('[/SEARCH RESULTS]'));
  });

  test('includes the user question', () => {
    expect(prompt).toContain(MOCK_QUESTION);
  });

  test('prohibits "unable to fetch" hedging language', () => {
    // The prohibition must appear so the model cannot claim it cannot fetch
    expect(prompt.toLowerCase()).toContain('do not say you are unable to fetch');
  });

  test('prohibits "I cannot access" and similar disclaimers', () => {
    expect(prompt.toLowerCase()).toContain("do not start your response with any disclaimer");
  });

  test('instructs the model to answer directly and immediately', () => {
    expect(prompt.toLowerCase()).toContain('answer directly and immediately');
  });

  test('tells model NOT to redirect user to external sources', () => {
    expect(prompt.toLowerCase()).toContain('do not suggest the user');
  });

  test('includes citation instruction', () => {
    expect(prompt).toContain('According to');
  });

  test('injects search context verbatim', () => {
    expect(prompt).toContain(MOCK_CONTEXT);
  });

  test('prompt text instructs model not to start with hedging disclaimers', () => {
    // The prohibition instruction names the exact phrases to avoid
    expect(prompt.toLowerCase()).toContain('do not start your response with any disclaimer');
    // And lists at least one concrete example phrase
    expect(prompt.toLowerCase()).toContain('unable to fetch');
  });
  test('Question label appears at the end', () => {
    const idx = prompt.lastIndexOf('Question:');
    expect(idx).toBeGreaterThan(-1);
    // Question section should be in the last 200 chars of the prompt
    expect(prompt.length - idx).toBeLessThan(200);
  });

  test('includes anti-hallucination directive for sports data', () => {
    expect(prompt.toLowerCase()).toContain('do not fabricate');
    expect(prompt.toLowerCase()).toContain('do not guess');
    expect(prompt.toLowerCase()).toContain('pre-game');
  });
});

// ── makeSynthesisPromptCompact (small-model variant) ──────────────────────

describe('makeSynthesisPromptCompact', () => {
  const LONG_CONTEXT = 'x'.repeat(3000);

  test('truncates context to 1500 chars', () => {
    const prompt = makeSynthesisPromptCompact(LONG_CONTEXT, MOCK_QUESTION);
    // The full 3000-char context should NOT appear
    expect(prompt).not.toContain(LONG_CONTEXT);
    // But the first 1500 chars should
    expect(prompt).toContain('x'.repeat(1500));
  });

  test('wraps context in [SEARCH RESULTS] block', () => {
    const prompt = makeSynthesisPromptCompact(MOCK_CONTEXT, MOCK_QUESTION);
    expect(prompt).toContain('[SEARCH RESULTS]');
    expect(prompt).toContain('[/SEARCH RESULTS]');
  });

  test('includes the question', () => {
    const prompt = makeSynthesisPromptCompact(MOCK_CONTEXT, MOCK_QUESTION);
    expect(prompt).toContain(MOCK_QUESTION);
  });

  test('is shorter than the full synthesis prompt', () => {
    const full = makeSynthesisPrompt(MOCK_CONTEXT, MOCK_QUESTION);
    const compact = makeSynthesisPromptCompact(MOCK_CONTEXT, MOCK_QUESTION);
    expect(compact.length).toBeLessThan(full.length);
  });

  test('includes anti-hallucination instruction', () => {
    const prompt = makeSynthesisPromptCompact(MOCK_CONTEXT, MOCK_QUESTION);
    expect(prompt.toLowerCase()).toContain('do not invent facts');
  });
});
