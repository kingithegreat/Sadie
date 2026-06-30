/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import ConversationSearch from '../components/ConversationSearch';

const mockSearchConversations = jest.fn();
const mockExportConversation = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (window as any).electron = {
    searchConversations: mockSearchConversations,
    exportConversation: mockExportConversation,
  };
});

afterEach(() => {
  jest.useRealTimers();
  delete (window as any).electron;
});

const SAMPLE_RESULTS = {
  success: true,
  data: [
    { conversationId: 'c1', conversationTitle: 'NBA Chat', messageId: 'm1', role: 'user', snippet: 'What are the NBA scores today?', updatedAt: '2025-01-01' },
    { conversationId: 'c1', conversationTitle: 'NBA Chat', messageId: 'm2', role: 'assistant', snippet: 'The Lakers won 112-108 against the Celtics.', updatedAt: '2025-01-01' },
    { conversationId: 'c2', conversationTitle: 'Weather', messageId: 'm3', role: 'user', snippet: 'How is the weather in NBA city?', updatedAt: '2025-01-02' },
  ],
};

describe('ConversationSearch', () => {
  test('renders search input with placeholder', () => {
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByPlaceholderText(/search all messages/i)).toBeInTheDocument();
  });

  test('shows hint text before any search', () => {
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText(/start typing/i)).toBeInTheDocument();
  });

  test('calls searchConversations after debounce', async () => {
    mockSearchConversations.mockResolvedValue(SAMPLE_RESULTS);
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'NBA' } });

    // Advance past the 300ms debounce
    await act(async () => { jest.advanceTimersByTime(350); });

    expect(mockSearchConversations).toHaveBeenCalledWith('NBA', 50);
  });

  test('groups results by conversation', async () => {
    mockSearchConversations.mockResolvedValue(SAMPLE_RESULTS);
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'NBA' } });
    await act(async () => { jest.advanceTimersByTime(350); });

    // NBA Chat group should show "2 matches"
    expect(screen.getByText(/2 matches/)).toBeInTheDocument();
    // Weather group should show "1 match" (singular)
    expect(screen.getByText(/1 match\b/)).toBeInTheDocument();
  });

  test('shows no-results message for zero matches', async () => {
    mockSearchConversations.mockResolvedValue({ success: true, data: [] });
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'xyznoexist' } });
    await act(async () => { jest.advanceTimersByTime(350); });

    expect(screen.getByText(/no messages matched/i)).toBeInTheDocument();
  });

  test('clicking a result calls onSelectConversation and onClose', async () => {
    mockSearchConversations.mockResolvedValue(SAMPLE_RESULTS);
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(<ConversationSearch onSelectConversation={onSelect} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'NBA' } });
    await act(async () => { jest.advanceTimersByTime(350); });

    // Click the conversation group header button
    const openBtns = screen.getAllByRole('button', { name: /open conversation/i });
    fireEvent.click(openBtns[0]);
    expect(onSelect).toHaveBeenCalledWith('c1', 'm1');
    expect(onClose).toHaveBeenCalled();
  });

  test('close button calls onClose', () => {
    const onClose = jest.fn();
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close search/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not search on empty input', async () => {
    render(<ConversationSearch onSelectConversation={jest.fn()} onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: '   ' } });
    await act(async () => { jest.advanceTimersByTime(350); });
    expect(mockSearchConversations).not.toHaveBeenCalled();
  });
});
