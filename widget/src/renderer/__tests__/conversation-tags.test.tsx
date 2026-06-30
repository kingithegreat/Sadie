/** @jest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ConversationSidebar from '../components/ConversationSidebar';

const NOW = Date.now();

const CONV_TAGGED = {
  id: 'c1',
  title: 'Tagged chat',
  createdAt: new Date(NOW - 3600000).toISOString(),
  updatedAt: new Date(NOW - 3600000).toISOString(),
  messageCount: 5,
  tags: ['Work', 'Important'],
};

const CONV_UNTAGGED = {
  id: 'c2',
  title: 'Plain chat',
  createdAt: new Date(NOW - 7200000).toISOString(),
  updatedAt: new Date(NOW - 7200000).toISOString(),
  messageCount: 2,
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

describe('ConversationSidebar — tags', () => {
  test('displays tag pills on tagged conversation', async () => {
    setupElectron({ c1: CONV_TAGGED, c2: CONV_UNTAGGED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const tags = document.querySelectorAll('.conv-tag');
    expect(tags.length).toBe(2);
    expect(tags[0].textContent).toBe('Work');
    expect(tags[1].textContent).toBe('Important');
  });

  test('untagged conversation has no tag pills', async () => {
    setupElectron({ c2: CONV_UNTAGGED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const tags = document.querySelectorAll('.conv-tag');
    expect(tags.length).toBe(0);
  });

  test('context menu has tag options', async () => {
    setupElectron({ c1: CONV_TAGGED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const item = document.querySelector('.conversation-item')!;
    fireEvent.contextMenu(item);

    // Should have tag labels in context menu
    expect(screen.getByText('✓ Work')).toBeDefined();
    expect(screen.getByText('✓ Important')).toBeDefined();
    expect(screen.getByText('Personal')).toBeDefined();
    expect(screen.getByText('Research')).toBeDefined();
    expect(screen.getByText('Fun')).toBeDefined();
  });

  test('clicking a tag in context menu calls saveConversation', async () => {
    setupElectron({ c2: CONV_UNTAGGED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const item = document.querySelector('.conversation-item')!;
    fireEvent.contextMenu(item);

    const workOption = screen.getByText('Work');
    await act(async () => { fireEvent.click(workOption); });

    expect((window as any).electron.saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', tags: ['Work'] })
    );
  });
});
