/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

// Mock clipboard via Electron's preload bridge
const writeClipboard = jest.fn();
beforeAll(() => {
  (window as any).electron = { ...(window as any).electron, writeClipboard };
});

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    streamingState: 'finished',
    ...overrides,
  };
}

const noop = () => {};

describe('MessageBubble markdown renderer', () => {
  beforeEach(() => writeClipboard.mockClear());

  test('renders fenced code block with language label and copy button', () => {
    const content = 'Here is code:\n\n```python\nprint("hello")\n```';
    const { container } = render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    // Language label
    expect(screen.getByText('python')).toBeInTheDocument();
    // Code content (hljs splits into spans, so check via textContent)
    const codeEl = container.querySelector('.code-block-pre code');
    expect(codeEl?.textContent).toContain('print("hello")');
    // Copy buttons present (code block copy + response copy)
    const copyBtns = screen.getAllByText('📋 Copy');
    expect(copyBtns.length).toBeGreaterThanOrEqual(1);
  });

  test('renders fenced code block without language as "code"', () => {
    const content = '```\nsome code\n```';
    const { container } = render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    expect(screen.getByText('code')).toBeInTheDocument();
    const codeEl = container.querySelector('.code-block-pre code');
    expect(codeEl?.textContent).toContain('some code');
  });

  test('code block copy button copies code and shows feedback', async () => {
    const content = '```js\nconst x = 1;\n```';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    // There may be multiple copy buttons (code block + response copy); find the one inside the code block
    const codeBlockCopyBtns = screen.getAllByText('📋 Copy');
    fireEvent.click(codeBlockCopyBtns[0]);

    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith('const x = 1;'));
    expect(screen.getByText('✓ Copied')).toBeInTheDocument();
  });

  test('renders bold text', () => {
    const content = 'This is **bold** text.';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const strong = document.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
  });

  test('renders italic text', () => {
    const content = 'This is *italic* text.';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const em = document.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('italic');
  });

  test('renders inline code', () => {
    const content = 'Use `console.log()` to debug.';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const inlineCode = document.querySelector('.inline-code');
    expect(inlineCode).not.toBeNull();
    expect(inlineCode!.textContent).toBe('console.log()');
  });

  test('renders markdown links', () => {
    const content = 'Visit [Google](https://google.com) for search.';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const link = screen.getByText('Google');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://google.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  test('renders headings', () => {
    const content = '# Title\n## Subtitle\nParagraph text.';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const h1 = document.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('Title');

    const h2 = document.querySelector('h2');
    expect(h2).not.toBeNull();
    expect(h2!.textContent).toBe('Subtitle');
  });

  test('renders unordered lists', () => {
    const content = '- Item A\n- Item B\n- Item C';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Item A');
    expect(items[2].textContent).toBe('Item C');
  });

  test('renders ordered lists', () => {
    const content = '1. First\n2. Second\n3. Third';
    render(<MessageBubble message={makeMsg({ content })} onCancel={noop} onRetry={noop} />);

    const ol = document.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = ol!.querySelectorAll('li');
    expect(items.length).toBe(3);
  });

  test('user messages do NOT render markdown (plain text + links only)', () => {
    const content = '**bold** and `code`';
    render(<MessageBubble message={makeMsg({ content, role: 'user' })} onCancel={noop} onRetry={noop} />);

    // Should NOT have <strong> or .inline-code — user messages use linkifyText
    expect(document.querySelector('strong')).toBeNull();
    expect(document.querySelector('.inline-code')).toBeNull();
  });

  test('user messages linkify bare URLs', () => {
    const content = 'Check https://example.com for details.';
    render(<MessageBubble message={makeMsg({ content, role: 'user' })} onCancel={noop} onRetry={noop} />);

    const link = screen.getByText('https://example.com');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });
});
