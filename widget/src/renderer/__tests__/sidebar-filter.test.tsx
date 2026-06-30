/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConversationSidebar from '../components/ConversationSidebar';

// Mock ConversationSearch to avoid pulling its dependencies
jest.mock('../components/ConversationSearch', () => {
  return function MockSearch() { return <div data-testid="mock-search" />; };
});

const noop = () => {};

// Mock electron API
const mockConversations = [
  { id: 'c1', title: 'React Discussion', createdAt: '2025-01-01T10:00:00Z', updatedAt: '2025-06-01T12:00:00Z', messageCount: 5 },
  { id: 'c2', title: 'Python Scripts', createdAt: '2025-01-02T10:00:00Z', updatedAt: '2025-06-02T12:00:00Z', messageCount: 3 },
  { id: 'c3', title: 'Recipe Ideas', createdAt: '2025-01-03T10:00:00Z', updatedAt: '2025-06-03T12:00:00Z', messageCount: 8 },
];

beforeEach(() => {
  (window as any).electron = {
    ...(window as any).electron,
    loadConversations: jest.fn().mockResolvedValue({
      success: true,
      data: { conversations: Object.fromEntries(mockConversations.map(c => [c.id, c])) },
    }),
    saveConversation: jest.fn().mockResolvedValue({ success: true }),
    exportConversation: jest.fn().mockResolvedValue({ success: true }),
  };
});

describe('ConversationSidebar quick filter', () => {
  test('renders filter input when sidebar is open', async () => {
    render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await waitFor(() => expect(screen.getByPlaceholderText('Filter by title…')).toBeInTheDocument());
  });

  test('filters conversations by title', async () => {
    render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await waitFor(() => expect(screen.getByText('React Discussion')).toBeInTheDocument());

    const filterInput = screen.getByPlaceholderText('Filter by title…');
    fireEvent.change(filterInput, { target: { value: 'python' } });

    expect(screen.getByText('Python Scripts')).toBeInTheDocument();
    expect(screen.queryByText('React Discussion')).toBeNull();
    expect(screen.queryByText('Recipe Ideas')).toBeNull();
  });

  test('shows "No matches" when filter has no results', async () => {
    render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await waitFor(() => expect(screen.getByText('React Discussion')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Filter by title…'), { target: { value: 'zzzzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  test('clear button resets filter', async () => {
    render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await waitFor(() => expect(screen.getByText('React Discussion')).toBeInTheDocument());

    const filterInput = screen.getByPlaceholderText('Filter by title…');
    fireEvent.change(filterInput, { target: { value: 'python' } });
    expect(screen.queryByText('React Discussion')).toBeNull();

    // Click clear button
    fireEvent.click(screen.getByLabelText('Clear filter'));
    expect(screen.getByText('React Discussion')).toBeInTheDocument();
    expect(screen.getByText('Python Scripts')).toBeInTheDocument();
    expect(screen.getByText('Recipe Ideas')).toBeInTheDocument();
  });

  test('filter is case-insensitive', async () => {
    render(
      <ConversationSidebar
        isOpen={true}
        onClose={noop}
        currentConversationId={null}
        onSelectConversation={noop}
        onNewConversation={noop}
        onDeleteConversation={noop}
      />
    );
    await waitFor(() => expect(screen.getByText('Recipe Ideas')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Filter by title…'), { target: { value: 'RECIPE' } });
    expect(screen.getByText('Recipe Ideas')).toBeInTheDocument();
  });
});
