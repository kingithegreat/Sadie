/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

beforeAll(() => {
  (window as any).electron = { ...(window as any).electron, writeClipboard: jest.fn() };
});

const noop = () => {};

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello world',
    createdAt: Date.now() - 3500,
    streamingState: 'finished',
    ...overrides,
  };
}

describe('response time badge', () => {
  test('shows response time when durationMs is set on finished message', () => {
    render(
      <MessageBubble message={makeMsg({ durationMs: 3500 })} onCancel={noop} onRetry={noop} />
    );
    expect(screen.getByText(/⏱ 3\.5s/)).toBeInTheDocument();
  });

  test('does not show response time when durationMs is undefined', () => {
    render(
      <MessageBubble message={makeMsg({ durationMs: undefined })} onCancel={noop} onRetry={noop} />
    );
    expect(screen.queryByText(/⏱/)).toBeNull();
  });

  test('does not show response time when durationMs is 0', () => {
    render(
      <MessageBubble message={makeMsg({ durationMs: 0 })} onCancel={noop} onRetry={noop} />
    );
    expect(screen.queryByText(/⏱/)).toBeNull();
  });

  test('does not show response time when still streaming', () => {
    render(
      <MessageBubble
        message={makeMsg({ streamingState: 'streaming', durationMs: 1000 })}
        onCancel={noop}
        onRetry={noop}
      />
    );
    expect(screen.queryByText(/⏱/)).toBeNull();
  });

  test('formats sub-second durations correctly', () => {
    render(
      <MessageBubble message={makeMsg({ durationMs: 450 })} onCancel={noop} onRetry={noop} />
    );
    expect(screen.getByText(/⏱ 0\.5s/)).toBeInTheDocument();
  });

  test('formats long durations correctly', () => {
    render(
      <MessageBubble message={makeMsg({ durationMs: 15200 })} onCancel={noop} onRetry={noop} />
    );
    expect(screen.getByText(/⏱ 15\.2s/)).toBeInTheDocument();
  });

  test('response time badge has correct CSS class', () => {
    render(
      <MessageBubble message={makeMsg({ durationMs: 2000 })} onCancel={noop} onRetry={noop} />
    );
    const badge = screen.getByText(/⏱ 2\.0s/);
    expect(badge).toHaveClass('response-time');
  });

  test('user messages do not show response time', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'user', durationMs: 1000, streamingState: undefined })}
        onCancel={noop}
        onRetry={noop}
      />
    );
    expect(screen.queryByText(/⏱/)).toBeNull();
  });
});
