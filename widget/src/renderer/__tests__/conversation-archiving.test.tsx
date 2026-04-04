/** @jest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ConversationSidebar from '../components/ConversationSidebar';

const NOW = Date.now();

const CONV_ACTIVE = {
  id: 'c1',
  title: 'Active chat',
  createdAt: new Date(NOW - 3600000).toISOString(),
  updatedAt: new Date(NOW - 3600000).toISOString(),
  messageCount: 3,
};

const CONV_ARCHIVED = {
  id: 'c2',
  title: 'Archived chat',
  createdAt: new Date(NOW - 86400000).toISOString(),
  updatedAt: new Date(NOW - 86400000).toISOString(),
  messageCount: 5,
  archived: true,
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

describe('ConversationSidebar — archiving', () => {
  test('archived conversations are hidden by default', async () => {
    setupElectron({ c1: CONV_ACTIVE, c2: CONV_ARCHIVED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    expect(screen.getByText('Active chat')).toBeDefined();
    expect(screen.queryByText('Archived chat')).toBeNull();
  });

  test('clicking archive toggle shows archived conversations', async () => {
    setupElectron({ c1: CONV_ACTIVE, c2: CONV_ARCHIVED });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const toggleBtn = document.querySelector('.archive-toggle-btn')!;
    await act(async () => { fireEvent.click(toggleBtn); });

    expect(screen.getByText('Archived chat')).toBeDefined();
    expect(screen.queryByText('Active chat')).toBeNull();
  });

  test('archive button calls saveConversation with archived: true', async () => {
    setupElectron({ c1: CONV_ACTIVE });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const archiveBtn = document.querySelector('.archive-btn')!;
    await act(async () => { fireEvent.click(archiveBtn); });

    expect((window as any).electron.saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', archived: true })
    );
  });

  test('archive toggle button text switches between Active and Archived', async () => {
    setupElectron({ c1: CONV_ACTIVE });
    await act(async () => { render(<ConversationSidebar {...defaultProps} />); });

    const toggleBtn = document.querySelector('.archive-toggle-btn')!;
    expect(toggleBtn.textContent).toContain('Active');

    await act(async () => { fireEvent.click(toggleBtn); });
    expect(toggleBtn.textContent).toContain('Archived');
  });
});
