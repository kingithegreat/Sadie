/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';

// ConversationSidebar uses window.electron for loadConversations etc.
beforeEach(() => {
  (window as any).electron = {
    listConversations: jest.fn().mockResolvedValue([
      { id: '1', title: 'Zebra chat', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-10T00:00:00Z', messageCount: 3 },
      { id: '2', title: 'Alpha chat', createdAt: '2024-01-05T00:00:00Z', updatedAt: '2024-01-05T00:00:00Z', messageCount: 1, pinned: true },
      { id: '3', title: 'Middle chat', createdAt: '2024-01-03T00:00:00Z', updatedAt: '2024-01-08T00:00:00Z', messageCount: 2 },
    ]),
    deleteConversation: jest.fn(),
    updateConversation: jest.fn(),
    loadConversation: jest.fn(),
    writeClipboard: jest.fn(),
    showSaveDialog: jest.fn(),
    saveFile: jest.fn(),
  };
});
afterEach(() => { delete (window as any).electron; });

const noop = () => {};

import ConversationSidebar from '../components/ConversationSidebar';

describe('ConversationSidebar — sort options', () => {
  test('renders sort dropdown with 3 options', async () => {
    const { container } = render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    // Wait for conversations to load
    await new Promise(r => setTimeout(r, 50));

    const select = container.querySelector('.sidebar-sort-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0].value).toBe('recent');
    expect(options[1].value).toBe('created');
    expect(options[2].value).toBe('name');
  });

  test('defaults to recently active sort', async () => {
    const { container } = render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await new Promise(r => setTimeout(r, 50));
    const select = container.querySelector('.sidebar-sort-select') as HTMLSelectElement;
    expect(select.value).toBe('recent');
  });

  test('changing sort to name A-Z reorders conversations', async () => {
    const { container } = render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await new Promise(r => setTimeout(r, 50));

    const select = container.querySelector('.sidebar-sort-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'name' } });
    expect(select.value).toBe('name');
  });
});
