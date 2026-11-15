/** @jest-environment jsdom */

import { render } from '@testing-library/react';
import MessageList from '../components/MessageList';
import type { ChatMessage } from '../types';

// Pin the wall clock to local mid-day so "Today"/"Yesterday" grouping cannot
// straddle midnight. Without this, the "one separator per day group" case fails
// whenever the suite runs in the first minute after local midnight (CI runs in
// UTC, so just after 00:00 UTC), because now - 60s falls on the previous day.
const FIXED_NOW = new Date(2026, 5, 15, 12, 0, 0); // 15 Jun 2026, 12:00 local time

beforeEach(() => {
  jest.useFakeTimers({ now: FIXED_NOW, advanceTimers: true });
  (window as any).electron = {
    writeClipboard: jest.fn(),
    ttsSpeak: jest.fn().mockResolvedValue(undefined),
    ttsStop: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => {
  delete (window as any).electron;
  jest.useRealTimers();
});

const noop = () => {};

function makeMsg(id: string, role: 'user' | 'assistant', content: string, createdAt: number): ChatMessage {
  return { id, role, content, createdAt, streamingState: role === 'assistant' ? 'finished' : undefined };
}

describe('MessageList — date separators', () => {
  test('renders a "Today" separator for messages from today', () => {
    const now = Date.now();
    const messages = [makeMsg('u1', 'user', 'Hello', now)];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const labels = container.querySelectorAll('.date-separator-label');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe('Today');
  });

  test('renders a "Yesterday" separator for messages from yesterday', () => {
    const yesterday = Date.now() - 86400000;
    const messages = [makeMsg('u1', 'user', 'Old msg', yesterday)];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const labels = container.querySelectorAll('.date-separator-label');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe('Yesterday');
  });

  test('shows one separator per day group, not per message', () => {
    const now = Date.now();
    const messages = [
      makeMsg('u1', 'user', 'First', now - 60000),
      makeMsg('a1', 'assistant', 'Reply', now - 30000),
      makeMsg('u2', 'user', 'Follow-up', now),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const labels = container.querySelectorAll('.date-separator-label');
    // All three messages are today → only 1 separator
    expect(labels.length).toBe(1);
  });

  test('shows separate separators for different days', () => {
    const now = Date.now();
    const yesterday = now - 86400000;
    const twoDaysAgo = now - 86400000 * 2;
    const messages = [
      makeMsg('u1', 'user', 'Old', twoDaysAgo),
      makeMsg('u2', 'user', 'Mid', yesterday),
      makeMsg('u3', 'user', 'New', now),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const labels = container.querySelectorAll('.date-separator-label');
    expect(labels.length).toBe(3);
    // Last one should be "Today"
    expect(labels[labels.length - 1].textContent).toBe('Today');
    expect(labels[labels.length - 2].textContent).toBe('Yesterday');
  });
});
