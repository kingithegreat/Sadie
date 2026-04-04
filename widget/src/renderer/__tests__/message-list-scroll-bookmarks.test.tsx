/** @jest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react';
import MessageList from '../components/MessageList';
import type { ChatMessage } from '../types';

// Mock electron for MessageBubble sub-components
beforeEach(() => {
  (window as any).electron = {
    writeClipboard: jest.fn(),
    ttsSpeak: jest.fn().mockResolvedValue(undefined),
    ttsStop: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => { delete (window as any).electron; });

const noop = () => {};
const NOW = Date.now();

function makeMsg(id: string, role: 'user' | 'assistant', content: string, opts: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: NOW - 10000,
    streamingState: role === 'assistant' ? 'finished' : undefined,
    ...opts,
  };
}

describe('MessageList — auto-scroll', () => {
  test('shows scroll-to-bottom button when scrolled up', () => {
    const messages = [
      makeMsg('u1', 'user', 'Hello'),
      makeMsg('a1', 'assistant', 'Hi there'),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const list = container.querySelector('.message-list')!;

    // Simulate scroll event where user is NOT at bottom
    Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 200, configurable: true });
    fireEvent.scroll(list);

    expect(container.querySelector('.scroll-to-bottom-btn')).not.toBeNull();
  });

  test('hides scroll-to-bottom when at bottom', () => {
    const messages = [makeMsg('u1', 'user', 'Hello')];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const list = container.querySelector('.message-list')!;

    // Simulate being at bottom
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(list);

    expect(container.querySelector('.scroll-to-bottom-btn')).toBeNull();
  });

  test('clicking scroll-to-bottom button hides it', () => {
    const messages = [makeMsg('u1', 'user', 'Hello')];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} />
    );
    const list = container.querySelector('.message-list')!;

    // Show button
    Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 200, configurable: true });
    fireEvent.scroll(list);

    const btn = container.querySelector('.scroll-to-bottom-btn')!;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);

    // After clicking, button should be hidden
    expect(container.querySelector('.scroll-to-bottom-btn')).toBeNull();
  });
});

describe('MessageList — bookmarks filter', () => {
  test('shows bookmarks filter when bookmarked messages exist', () => {
    const messages = [
      makeMsg('u1', 'user', 'Hello', { bookmarked: true }),
      makeMsg('a1', 'assistant', 'World'),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    expect(container.querySelector('.bookmarks-filter-btn')).not.toBeNull();
    expect(screen.getByText(/Bookmarks \(1\)/)).toBeInTheDocument();
  });

  test('does not show bookmarks filter when no bookmarked messages', () => {
    const messages = [
      makeMsg('u1', 'user', 'Hello'),
      makeMsg('a1', 'assistant', 'World'),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    expect(container.querySelector('.bookmarks-filter-btn')).toBeNull();
  });

  test('clicking filter shows only bookmarked messages', () => {
    const messages = [
      makeMsg('u1', 'user', 'Bookmarked msg', { bookmarked: true }),
      makeMsg('a1', 'assistant', 'Not bookmarked'),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );

    // Before filter — both visible
    expect(screen.getByText('Bookmarked msg')).toBeInTheDocument();
    expect(screen.getByText('Not bookmarked')).toBeInTheDocument();

    // Click filter
    fireEvent.click(container.querySelector('.bookmarks-filter-btn')!);

    // After filter — only bookmarked visible
    expect(screen.getByText('Bookmarked msg')).toBeInTheDocument();
    expect(screen.queryByText('Not bookmarked')).toBeNull();
    expect(screen.getByText(/Show all/)).toBeInTheDocument();
  });

  test('clicking filter again shows all messages', () => {
    const messages = [
      makeMsg('u1', 'user', 'Bookmarked msg', { bookmarked: true }),
      makeMsg('a1', 'assistant', 'Not bookmarked'),
    ];
    const { container } = render(
      <MessageList messages={messages} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );

    // Toggle on then off
    fireEvent.click(container.querySelector('.bookmarks-filter-btn')!);
    fireEvent.click(container.querySelector('.bookmarks-filter-btn')!);

    expect(screen.getByText('Bookmarked msg')).toBeInTheDocument();
    expect(screen.getByText('Not bookmarked')).toBeInTheDocument();
  });

  test('shows welcome message when no messages', () => {
    render(
      <MessageList messages={[]} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    expect(screen.getByText("Hello! I'm SADIE")).toBeInTheDocument();
  });
});
