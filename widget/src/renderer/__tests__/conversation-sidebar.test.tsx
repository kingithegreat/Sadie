/** @jest-environment jsdom */
/**
 * conversation-sidebar.test.tsx
 * Tests for src/renderer/components/ConversationSidebar.tsx
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ConversationSidebar from '../components/ConversationSidebar';

const CONV_A = {
  id: 'c1',
  title: 'Chat about TypeScript',
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date(Date.now() - 3600000).toISOString(),
  messageCount: 5,
};
const CONV_B = {
  id: 'c2',
  title: 'Python help',
  createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  messageCount: 12,
};

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  currentConversationId: null,
  onSelectConversation: jest.fn(),
  onNewConversation: jest.fn(),
  onDeleteConversation: jest.fn(),
};

function setupElectron(convMap: Record<string, any> = {}) {
  (window as any).electron = {
    loadConversations: jest.fn().mockResolvedValue({
      success: true,
      data: { conversations: convMap },
    }),
    saveConversation: jest.fn().mockResolvedValue({}),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  delete (window as any).electron;
});

// Override window.confirm globally
beforeAll(() => {
  window.confirm = jest.fn(() => true);
});

describe('ConversationSidebar — open/closed', () => {
  test('renders nothing when isOpen=false', () => {
    setupElectron();
    const { container } = render(<ConversationSidebar {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders heading when isOpen=true', async () => {
    setupElectron();
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    expect(screen.getByText('Conversations')).toBeInTheDocument();
  });

  test('renders New Chat button', async () => {
    setupElectron();
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    expect(screen.getByText('New Chat')).toBeInTheDocument();
  });

  test('calls onNewConversation when New Chat is clicked', async () => {
    setupElectron();
    const onNewConversation = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onNewConversation={onNewConversation} />);
    });
    fireEvent.click(screen.getByText('New Chat'));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when × close button is clicked', async () => {
    setupElectron();
    const onClose = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onClose={onClose} />);
    });
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when backdrop is clicked', async () => {
    setupElectron();
    const onClose = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onClose={onClose} />);
    });
    fireEvent.click(document.querySelector('.sidebar-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ConversationSidebar — conversation list', () => {
  test('shows conversation titles', async () => {
    setupElectron({ c1: CONV_A, c2: CONV_B });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    expect(screen.getByText('Chat about TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Python help')).toBeInTheDocument();
  });

  test('shows "No conversations yet" when list is empty', async () => {
    setupElectron({});
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  test('clicking a conversation calls onSelectConversation with its id', async () => {
    setupElectron({ c1: CONV_A });
    const onSelectConversation = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onSelectConversation={onSelectConversation} />);
    });
    fireEvent.click(screen.getByText('Chat about TypeScript'));
    expect(onSelectConversation).toHaveBeenCalledWith('c1');
  });

  test('clicking a conversation calls onClose', async () => {
    setupElectron({ c1: CONV_A });
    const onClose = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onClose={onClose} />);
    });
    fireEvent.click(screen.getByText('Chat about TypeScript'));
    expect(onClose).toHaveBeenCalled();
  });

  test('active conversation has active class', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} currentConversationId="c1" />);
    });
    const item = document.querySelector('.conversation-item.active');
    expect(item).not.toBeNull();
  });

  test('shows message count', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

describe('ConversationSidebar — delete', () => {
  // Deleting used to go through the browser's native confirm() — a blocking OS
  // dialog that says only "Delete this conversation?" and never mentions that
  // the messages go with it. It now uses the app's own dialog, which names the
  // conversation and counts what is lost.
  test('asks first, naming the conversation and what goes with it', async () => {
    setupElectron({ c1: CONV_A });
    const onDeleteConversation = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onDeleteConversation={onDeleteConversation} />);
    });
    await act(async () => { fireEvent.click(screen.getByTitle('Delete')); });

    expect(onDeleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Delete it')); });
    expect(onDeleteConversation).toHaveBeenCalledWith('c1');
  });

  test('removes conversation from list once confirmed', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    await act(async () => { fireEvent.click(screen.getByTitle('Delete')); });
    await act(async () => { fireEvent.click(screen.getByText('Delete it')); });
    expect(screen.queryByText('Chat about TypeScript')).toBeNull();
  });

  test('does NOT delete when cancelled', async () => {
    setupElectron({ c1: CONV_A });
    const onDeleteConversation = jest.fn();
    await act(async () => {
      render(<ConversationSidebar {...defaultProps} onDeleteConversation={onDeleteConversation} />);
    });
    await act(async () => { fireEvent.click(screen.getByTitle('Delete')); });
    // Must actually click Cancel. Without this the test passes merely because
    // the click no longer deletes immediately, which is not what it claims.
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });

    expect(onDeleteConversation).not.toHaveBeenCalled();
    expect(screen.getByText('Chat about TypeScript')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('ConversationSidebar — rename (edit title)', () => {
  test('shows edit input when rename button is clicked', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    fireEvent.click(screen.getByTitle('Rename'));
    expect(screen.getByRole('textbox', { name: /Edit conversation title/i })).toBeInTheDocument();
  });

  test('saves new title on Enter', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    fireEvent.click(screen.getByTitle('Rename'));
    const input = screen.getByRole('textbox', { name: /Edit conversation title/i });
    fireEvent.change(input, { target: { value: 'New Title' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText('New Title')).toBeInTheDocument();
  });

  test('cancels edit on Escape without saving', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    fireEvent.click(screen.getByTitle('Rename'));
    const input = screen.getByRole('textbox', { name: /Edit conversation title/i });
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // Edit input should close; original title stays
    expect(screen.queryByText('Discarded')).toBeNull();
    expect(screen.getByText('Chat about TypeScript')).toBeInTheDocument();
  });

  test('saves title on blur', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    fireEvent.click(screen.getByTitle('Rename'));
    const input = screen.getByRole('textbox', { name: /Edit conversation title/i });
    fireEvent.change(input, { target: { value: 'Blur Title' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(screen.getByText('Blur Title')).toBeInTheDocument();
  });
});

describe('ConversationSidebar — homebot:title-updated event', () => {
  test('patches title when homebot:title-updated event fires', async () => {
    setupElectron({ c1: CONV_A });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('homebot:title-updated', {
        detail: { conversationId: 'c1', title: 'Auto-Generated Title' },
      }));
    });
    expect(screen.getByText('Auto-Generated Title')).toBeInTheDocument();
  });
});
