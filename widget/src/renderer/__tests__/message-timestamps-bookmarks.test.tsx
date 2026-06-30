/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';

// Mock electron
beforeEach(() => {
  (window as any).electron = {
    writeClipboard: jest.fn(),
    ttsSpeak: jest.fn().mockResolvedValue(undefined),
    ttsStop: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => { delete (window as any).electron; });

const NOW = Date.now();

const userMsg = {
  id: 'u1',
  role: 'user' as const,
  content: 'Hello world',
  createdAt: NOW - 60000,
};

const assistantMsg = {
  id: 'a1',
  role: 'assistant' as const,
  content: 'Hi there!',
  createdAt: NOW - 30000,
  streamingState: 'finished' as const,
};

const noop = () => {};

describe('MessageBubble — timestamps', () => {
  test('renders timestamp for user message', () => {
    const { container } = render(
      <MessageBubble message={userMsg} onCancel={noop} onRetry={noop} />
    );
    const ts = container.querySelector('.message-timestamp');
    expect(ts).not.toBeNull();
    expect(ts?.textContent).toBeTruthy();
  });

  test('renders timestamp for assistant message', () => {
    const { container } = render(
      <MessageBubble message={assistantMsg} onCancel={noop} onRetry={noop} />
    );
    const ts = container.querySelector('.message-timestamp');
    expect(ts).not.toBeNull();
  });

  test('timestamp is hidden (opacity 0) by default via CSS class', () => {
    const { container } = render(
      <MessageBubble message={userMsg} onCancel={noop} onRetry={noop} />
    );
    const ts = container.querySelector('.message-timestamp');
    expect(ts).not.toBeNull();
    // Opacity controlled by CSS, just verify the class exists
    expect(ts?.className).toBe('message-timestamp');
  });
});

describe('MessageBubble — bookmarks', () => {
  test('renders bookmark button when onBookmark provided', () => {
    const { container } = render(
      <MessageBubble message={userMsg} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    const btn = container.querySelector('.bookmark-btn');
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe('☆');
  });

  test('does not render bookmark button when onBookmark not provided', () => {
    const { container } = render(
      <MessageBubble message={userMsg} onCancel={noop} onRetry={noop} />
    );
    expect(container.querySelector('.bookmark-btn')).toBeNull();
  });

  test('shows filled star for bookmarked message', () => {
    const bookmarkedMsg = { ...userMsg, bookmarked: true };
    const { container } = render(
      <MessageBubble message={bookmarkedMsg} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    const btn = container.querySelector('.bookmark-btn');
    expect(btn?.textContent?.trim()).toBe('★');
    expect(btn?.className).toContain('active');
  });

  test('calls onBookmark with messageId when clicked', () => {
    const onBookmark = jest.fn();
    const { container } = render(
      <MessageBubble message={userMsg} onCancel={noop} onRetry={noop} onBookmark={onBookmark} />
    );
    fireEvent.click(container.querySelector('.bookmark-btn')!);
    expect(onBookmark).toHaveBeenCalledWith('u1');
  });

  test('message wrapper has bookmarked class when bookmarked', () => {
    const bookmarkedMsg = { ...userMsg, bookmarked: true };
    const { container } = render(
      <MessageBubble message={bookmarkedMsg} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    expect(container.querySelector('.message-wrapper.bookmarked')).not.toBeNull();
  });

  test('bookmark appears in context menu', () => {
    const { container } = render(
      <MessageBubble message={userMsg} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    const wrapper = container.querySelector('.message-wrapper')!;
    fireEvent.contextMenu(wrapper);
    expect(screen.getByText('Bookmark')).toBeInTheDocument();
  });

  test('context menu shows "Remove bookmark" for bookmarked message', () => {
    const bookmarkedMsg = { ...userMsg, bookmarked: true };
    const { container } = render(
      <MessageBubble message={bookmarkedMsg} onCancel={noop} onRetry={noop} onBookmark={noop} />
    );
    const wrapper = container.querySelector('.message-wrapper')!;
    fireEvent.contextMenu(wrapper);
    expect(screen.getByText('Remove bookmark')).toBeInTheDocument();
  });
});
