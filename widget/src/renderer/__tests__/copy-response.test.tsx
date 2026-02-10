/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

// Mock clipboard via Electron's preload bridge
const writeClipboard = jest.fn();
beforeAll(() => {
  (window as any).electron = { ...(window as any).electron, writeClipboard };
});

const noop = () => {};

function makeFinishedMsg(content: string): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content,
    createdAt: Date.now(),
    streamingState: 'finished',
  };
}

describe('copy full response button', () => {
  beforeEach(() => writeClipboard.mockClear());

  test('shows Copy button when assistant message is finished', () => {
    render(<MessageBubble message={makeFinishedMsg('Hello world')} onCancel={noop} onRetry={noop} />);

    // The footer should contain a Copy button
    const copyBtn = screen.getByRole('button', { name: /copy response/i });
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn.textContent).toContain('📋 Copy');
  });

  test('does NOT show Copy button when streaming', () => {
    const msg: ChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'partial',
      createdAt: Date.now(),
      streamingState: 'streaming',
    };
    render(<MessageBubble message={msg} onCancel={noop} onRetry={noop} />);

    expect(screen.queryByRole('button', { name: /copy response/i })).toBeNull();
  });

  test('clicking Copy calls writeClipboard with full content', async () => {
    const content = 'This is a full response with\nmultiple lines.';
    render(<MessageBubble message={makeFinishedMsg(content)} onCancel={noop} onRetry={noop} />);

    const copyBtn = screen.getByRole('button', { name: /copy response/i });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(content));
  });

  test('shows "✓ Copied" feedback after clicking', async () => {
    render(<MessageBubble message={makeFinishedMsg('Test')} onCancel={noop} onRetry={noop} />);

    const copyBtn = screen.getByRole('button', { name: /copy response/i });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(screen.getByText('✓ Copied')).toBeInTheDocument());
  });

  test('does NOT show Copy button for user messages', () => {
    const msg: ChatMessage = {
      id: 'msg-3',
      role: 'user',
      content: 'User text',
      createdAt: Date.now(),
    };
    render(<MessageBubble message={msg} onCancel={noop} onRetry={noop} />);

    expect(screen.queryByRole('button', { name: /copy response/i })).toBeNull();
  });
});
