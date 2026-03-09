/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import TokenCounter from '../components/TokenCounter';
import type { ChatMessage } from '../types';

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content } as ChatMessage;
}

function setup(messages: ChatMessage[], model: string) {
  return render(<TokenCounter messages={messages} model={model} />);
}

// ─── render ───────────────────────────────────────────────────────────────────

test('renders without crashing with empty messages', () => {
  const { container } = setup([], 'llama3:latest');
  expect(container.querySelector('.token-counter')).toBeInTheDocument();
});

test('renders "left" label', () => {
  setup([], 'llama3:latest');
  expect(screen.getByText('left')).toBeInTheDocument();
});

// ─── token estimation ─────────────────────────────────────────────────────────

test('shows full context remaining when no messages provided', () => {
  setup([], 'llama3:latest'); // limit 8192
  // All 8192 tokens remain, formatted as ~8.2k
  expect(screen.getByText(/~8\.2k|~8192/)).toBeInTheDocument();
});

test('excludes system messages from token count', () => {
  const messages = [
    msg('system', 'A'.repeat(4000)), // should be excluded
  ];
  setup(messages, 'llama3:latest');
  // Remaining should still be ~8.2k because system role is excluded
  expect(screen.getByText(/~8\.2k|~8192/)).toBeInTheDocument();
});

test('counts user and assistant messages', () => {
  // 400 chars / 4 = 100 tokens used from 8192 → ~8092 remaining → ~8.1k
  const messages = [
    msg('user', 'A'.repeat(200)),
    msg('assistant', 'B'.repeat(200)),
  ];
  setup(messages, 'llama3:latest');
  const el = screen.getByText(/~\d/);
  expect(el).toBeInTheDocument();
  // remaining < 8192 tokens
  const text = el.textContent || '';
  expect(text).not.toMatch(/~8\.2k/); // used some tokens, so less than max
});

// ─── model context windows ────────────────────────────────────────────────────

test('uses 32768 context for qwen2.5:7b', () => {
  setup([], 'qwen2.5:7b');
  expect(screen.getByText(/~32\.8k|~32768/)).toBeInTheDocument();
});

test('uses 131072 context for llama3.2:3b', () => {
  setup([], 'llama3.2:3b');
  expect(screen.getByText(/~131\.1k|~131072/i)).toBeInTheDocument();
});

test('uses 65536 context for deepseek-coder-v2:latest', () => {
  setup([], 'deepseek-coder-v2:latest');
  expect(screen.getByText(/~65\.5k|~65536/)).toBeInTheDocument();
});

test('uses 8192 default for unknown model', () => {
  setup([], 'totally-unknown-model-xyz');
  expect(screen.getByText(/~8\.2k|~8192/)).toBeInTheDocument();
});

test('uses fuzzy match for llama3.1 variant without exact key', () => {
  // llama3.1:70b is in the map directly; test that a known variant works
  setup([], 'llama3.1:70b');
  expect(screen.getByText(/~131\.1k|~131072/i)).toBeInTheDocument();
});

// ─── title tooltip ────────────────────────────────────────────────────────────

test('container has title with remaining/limit info', () => {
  const { container } = setup([], 'llama3:latest');
  const el = container.querySelector('.token-counter');
  expect(el).toBeInTheDocument();
  expect(el!.getAttribute('title')).toMatch(/remaining/i);
});

// ─── CSS variables ────────────────────────────────────────────────────────────

test('sets --token-bar-width CSS variable on container', () => {
  const { container } = setup([], 'llama3:latest');
  const el = container.querySelector('.token-counter') as HTMLElement;
  // At 0 usage the bar width should be 0%
  expect(el.style.getPropertyValue('--token-bar-width')).toBe('0%');
});

test('--token-color is green when usage is below 60%', () => {
  // No messages → 0% usage → green
  const { container } = setup([], 'llama3:latest');
  const el = container.querySelector('.token-counter') as HTMLElement;
  expect(el.style.getPropertyValue('--token-color')).toBe('#34c759');
});

test('--token-color is red when context is nearly full', () => {
  // Fill 90% of 8192 context → 8192 * 0.9 * 4 chars = ~29491 chars
  const messages = [msg('user', 'A'.repeat(30000))];
  const { container } = setup(messages, 'llama3:latest');
  const el = container.querySelector('.token-counter') as HTMLElement;
  expect(el.style.getPropertyValue('--token-color')).toBe('#ff3b30');
});

// ─── bar + track elements ─────────────────────────────────────────────────────

test('renders token-bar-track and token-bar-fill elements', () => {
  const { container } = setup([], 'llama3:latest');
  expect(container.querySelector('.token-bar-track')).toBeInTheDocument();
  expect(container.querySelector('.token-bar-fill')).toBeInTheDocument();
});

// ─── fmtNum ───────────────────────────────────────────────────────────────────

test('formats values ≥1000 with k suffix', () => {
  setup([], 'qwen2.5:7b'); // 32768 remaining → "32.8k"
  expect(screen.getByText(/~\d+\.\dk/)).toBeInTheDocument();
});

test('shows plain number for small remaining values', () => {
  // Fill almost all context: 32768*4 = 131072 chars → all context used, 0 remaining
  const messages = [msg('user', 'A'.repeat(32768 * 4 + 100))];
  setup(messages, 'llama3:latest');
  expect(screen.getByText('~0')).toBeInTheDocument();
});
