/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

// Mock clipboard via Electron's preload bridge.
// `writeClipboard` bridges to `homebot:clipboard-write` in the main process and
// resolves `{ success }` — the app window is sandboxed, so the preload cannot
// reach Electron's `clipboard` module directly. It resolves rather than
// throwing, so callers can drive their feedback off the real result.
const writeClipboard = jest.fn().mockResolvedValue({ success: true });
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
    expect(copyBtn.textContent).toContain('Copy');
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

    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
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

  // The reported bug: clicking Copy did nothing at all. The preload's
  // `clipboard.writeText` call threw inside a sandboxed preload, and the throw
  // skipped the "Copied" feedback — a dead button that looked like a live one.
  // These two tests pin both halves: the write is attempted, and the label
  // tells the truth about whether it succeeded.
  test('reports failure instead of claiming Copied when the write fails', async () => {
    writeClipboard.mockResolvedValueOnce({ success: false, error: 'clipboard is locked' });
    render(<MessageBubble message={makeFinishedMsg('Test')} onCancel={noop} onRetry={noop} />);

    fireEvent.click(screen.getByRole('button', { name: /copy response/i }));

    await waitFor(() => expect(screen.getByText('Copy failed')).toBeInTheDocument());
    expect(screen.queryByText('Copied')).toBeNull();
  });

  test('reports failure when the preload bridge is missing entirely', async () => {
    const original = (window as any).electron;
    (window as any).electron = { ...original, writeClipboard: undefined };
    try {
      render(<MessageBubble message={makeFinishedMsg('Test')} onCancel={noop} onRetry={noop} />);

      fireEvent.click(screen.getByRole('button', { name: /copy response/i }));

      await waitFor(() => expect(screen.getByText('Copy failed')).toBeInTheDocument());
    } finally {
      (window as any).electron = original;
    }
  });

  test('code block copy button writes the block contents, not the whole message', async () => {
    const content = 'Intro text\n\n```js\nconst x = 1;\n```\n\nOutro text';
    const { container } = render(<MessageBubble message={makeFinishedMsg(content)} onCancel={noop} onRetry={noop} />);

    const codeCopyBtn = container.querySelector('.code-copy-btn') as HTMLButtonElement;
    expect(codeCopyBtn).not.toBeNull();

    fireEvent.click(codeCopyBtn);

    // Measured: the fence contents arrive without the trailing newline. Assert
    // on the real payload rather than a guess, and pin the thing that matters —
    // the block boundary is respected, so the surrounding prose is excluded.
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith('const x = 1;'));
    const [copiedText] = writeClipboard.mock.calls[0];
    expect(copiedText).not.toContain('Intro text');
    expect(copiedText).not.toContain('Outro text');
  });
});
