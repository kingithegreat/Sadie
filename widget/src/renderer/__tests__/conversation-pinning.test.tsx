/** @jest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ConversationSidebar from '../components/ConversationSidebar';

const NOW = Date.now();

const CONV_NORMAL = {
  id: 'c1',
  title: 'Normal chat',
  createdAt: new Date(NOW - 3600000).toISOString(),
  updatedAt: new Date(NOW - 3600000).toISOString(),
  messageCount: 3,
};

const CONV_PINNED = {
  id: 'c2',
  title: 'Pinned chat',
  createdAt: new Date(NOW - 86400000).toISOString(),
  updatedAt: new Date(NOW - 86400000).toISOString(),
  messageCount: 7,
  pinned: true,
};

const CONV_OLDER = {
  id: 'c3',
  title: 'Old chat',
  createdAt: new Date(NOW - 86400000 * 5).toISOString(),
  updatedAt: new Date(NOW - 86400000 * 5).toISOString(),
  messageCount: 1,
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

beforeAll(() => {
  window.confirm = jest.fn(() => true);
});

describe('ConversationSidebar — pinning', () => {
  test('pinned conversations appear before unpinned', async () => {
    setupElectron({ c1: CONV_NORMAL, c2: CONV_PINNED, c3: CONV_OLDER });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const items = document.querySelectorAll('.conversation-item');
    // Pinned chat (c2) should be first even though it's older
    expect(items[0].textContent).toContain('Pinned chat');
    expect(items[1].textContent).toContain('Normal chat');
  });

  test('pinned conversation has .pinned class', async () => {
    setupElectron({ c1: CONV_NORMAL, c2: CONV_PINNED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const pinned = document.querySelector('.conversation-item.pinned');
    expect(pinned).not.toBeNull();
    expect(pinned?.textContent).toContain('Pinned chat');
  });

  test('pin button shows 📌 for pinned and 📍 for unpinned', async () => {
    setupElectron({ c1: CONV_NORMAL, c2: CONV_PINNED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const pinButtons = document.querySelectorAll('.pin-btn');
    // Should have pin buttons for both conversations
    expect(pinButtons.length).toBeGreaterThanOrEqual(2);

    // Find the pinned one
    const pinnedBtn = document.querySelector('.pin-btn.pinned');
    expect(pinnedBtn?.textContent?.trim()).toBe('📌');

    // Find unpinned
    const unpinnedBtns = document.querySelectorAll('.pin-btn:not(.pinned)');
    expect(unpinnedBtns.length).toBeGreaterThanOrEqual(1);
    expect(unpinnedBtns[0]?.textContent?.trim()).toBe('📍');
  });

  test('clicking pin button calls saveConversation with pinned=true', async () => {
    setupElectron({ c1: CONV_NORMAL });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const pinBtn = document.querySelector('.pin-btn') as HTMLElement;
    expect(pinBtn).not.toBeNull();

    await act(async () => { fireEvent.click(pinBtn); });
    expect((window as any).electron.saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', pinned: true })
    );
  });

  test('clicking pin button on pinned conv calls saveConversation with pinned=false', async () => {
    setupElectron({ c2: CONV_PINNED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const pinBtn = document.querySelector('.pin-btn.pinned') as HTMLElement;
    expect(pinBtn).not.toBeNull();

    await act(async () => { fireEvent.click(pinBtn); });
    expect((window as any).electron.saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', pinned: false })
    );
  });

  test('right-click on conversation shows context menu', async () => {
    setupElectron({ c1: CONV_NORMAL });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const item = document.querySelector('.conversation-item') as HTMLElement;
    fireEvent.contextMenu(item);

    // Context menu should appear with Pin, Rename, Export, Archive, Delete options
    expect(screen.getByText('Pin')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Export Markdown')).toBeInTheDocument();
    expect(screen.getByText('Export JSON')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('right-click on pinned conversation shows Unpin option', async () => {
    setupElectron({ c2: CONV_PINNED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const item = document.querySelector('.conversation-item.pinned') as HTMLElement;
    fireEvent.contextMenu(item);
    expect(screen.getByText('Unpin')).toBeInTheDocument();
  });
});
