/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

beforeEach(() => {
  (window as any).electron = {
    writeClipboard: jest.fn(),
    ttsSpeak: jest.fn().mockResolvedValue(undefined),
    ttsStop: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => { delete (window as any).electron; });

const noop = () => {};

function makeFinishedAssistantMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'Hello world!',
    createdAt: Date.now(),
    streamingState: 'finished',
    ...overrides,
  };
}

describe('MessageBubble — reactions', () => {
  test('reaction add button is rendered when onReact provided', () => {
    const { container } = render(
      <MessageBubble message={makeFinishedAssistantMsg()} onCancel={noop} onRetry={noop} onReact={noop} />
    );
    expect(container.querySelector('.reaction-add-btn')).not.toBeNull();
  });

  test('reaction add button is NOT rendered when onReact is omitted', () => {
    const { container } = render(
      <MessageBubble message={makeFinishedAssistantMsg()} onCancel={noop} onRetry={noop} />
    );
    expect(container.querySelector('.reaction-add-btn')).toBeNull();
  });

  test('clicking + shows the reaction picker', () => {
    const { container } = render(
      <MessageBubble message={makeFinishedAssistantMsg()} onCancel={noop} onRetry={noop} onReact={noop} />
    );
    const addBtn = container.querySelector('.reaction-add-btn')!;
    fireEvent.click(addBtn);
    const picker = container.querySelector('.reaction-picker');
    expect(picker).not.toBeNull();
    expect(picker!.querySelectorAll('.reaction-option').length).toBe(6);
  });

  test('clicking an emoji calls onReact and hides picker', () => {
    const onReact = jest.fn();
    const { container } = render(
      <MessageBubble message={makeFinishedAssistantMsg()} onCancel={noop} onRetry={noop} onReact={onReact} />
    );
    fireEvent.click(container.querySelector('.reaction-add-btn')!);
    const options = container.querySelectorAll('.reaction-option');
    fireEvent.click(options[0]); // first emoji 👍
    expect(onReact).toHaveBeenCalledWith('a1', '👍');
    expect(container.querySelector('.reaction-picker')).toBeNull();
  });

  test('existing reactions display as pills', () => {
    const msg = makeFinishedAssistantMsg({ reactions: { '👍': 1, '❤️': 1 } });
    const { container } = render(
      <MessageBubble message={msg} onCancel={noop} onRetry={noop} onReact={noop} />
    );
    const pills = container.querySelectorAll('.reaction-pill.active');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toContain('👍');
    expect(pills[1].textContent).toContain('❤️');
  });

  test('clicking existing reaction pill calls onReact to toggle off', () => {
    const onReact = jest.fn();
    const msg = makeFinishedAssistantMsg({ reactions: { '👍': 1 } });
    const { container } = render(
      <MessageBubble message={msg} onCancel={noop} onRetry={noop} onReact={onReact} />
    );
    const pill = container.querySelector('.reaction-pill.active')!;
    fireEvent.click(pill);
    expect(onReact).toHaveBeenCalledWith('a1', '👍');
  });
});

describe('MessageBubble — reading time', () => {
  test('shows reading time on finished assistant message', () => {
    const longContent = Array(200).fill('word').join(' '); // 200 words ~ 1 min
    const msg = makeFinishedAssistantMsg({ content: longContent });
    const { container } = render(
      <MessageBubble message={msg} onCancel={noop} onRetry={noop} />
    );
    const readingTime = container.querySelector('.reading-time');
    expect(readingTime).not.toBeNull();
    expect(readingTime!.textContent).toContain('1 min read');
  });

  test('shows 1 min read for short messages', () => {
    const msg = makeFinishedAssistantMsg({ content: 'Short reply' });
    const { container } = render(
      <MessageBubble message={msg} onCancel={noop} onRetry={noop} />
    );
    const readingTime = container.querySelector('.reading-time');
    expect(readingTime).not.toBeNull();
    expect(readingTime!.textContent).toContain('1 min read');
  });

  test('shows 3 min read for ~600 word message', () => {
    const longContent = Array(600).fill('word').join(' ');
    const msg = makeFinishedAssistantMsg({ content: longContent });
    const { container } = render(
      <MessageBubble message={msg} onCancel={noop} onRetry={noop} />
    );
    const readingTime = container.querySelector('.reading-time');
    expect(readingTime!.textContent).toContain('3 min read');
  });

  test('does not show reading time on streaming messages', () => {
    const msg: ChatMessage = {
      id: 'a2',
      role: 'assistant',
      content: 'Still generating...',
      createdAt: Date.now(),
      streamingState: 'streaming',
    };
    const { container } = render(
      <MessageBubble message={msg} onCancel={noop} onRetry={noop} />
    );
    expect(container.querySelector('.reading-time')).toBeNull();
  });
});
