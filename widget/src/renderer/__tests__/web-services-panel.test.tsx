/** @jest-environment jsdom */
/**
 * web-services-panel.test.tsx
 * Tests for WebServicesPanel with URL browser, summarize-to-chat, and service launchers
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import WebServicesPanel from '../components/WebServicesPanel';

function setupElectron(overrides: Record<string, any> = {}) {
  (window as any).electron = {
    fetchPageContent: jest.fn().mockResolvedValue({
      success: true,
      result: { url: 'https://example.com', content: 'Example page content here.', length: 27, truncated: false },
    }),
    ragIndex: jest.fn().mockResolvedValue({ success: true, result: { chunks_indexed: 3 } }),
    ...overrides,
  };
  (window as any)._webServices = {
    open: jest.fn().mockResolvedValue(undefined),
    status: jest.fn().mockResolvedValue({ chatgpt: false, claude: false, gemini: false }),
  };
}

afterEach(() => {
  delete (window as any).electron;
  delete (window as any)._webServices;
});

describe('WebServicesPanel — URL browser', () => {
  test('renders the URL input and Fetch button', () => {
    setupElectron();
    render(<WebServicesPanel />);
    expect(screen.getByPlaceholderText(/Enter a URL/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fetch/i })).toBeInTheDocument();
  });

  test('renders Web Browser heading', () => {
    setupElectron();
    render(<WebServicesPanel />);
    expect(screen.getByText('Web Browser')).toBeInTheDocument();
  });

  test('Fetch button is disabled when URL is empty', () => {
    setupElectron();
    render(<WebServicesPanel />);
    const fetchBtn = screen.getByRole('button', { name: /Fetch/i });
    expect(fetchBtn).toBeDisabled();
  });

  test('fetches page content on click', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Fetch/i }));
    });

    expect((window as any).electron.fetchPageContent).toHaveBeenCalledWith('https://example.com');
    expect(screen.getByText(/Example page content/)).toBeInTheDocument();
  });

  test('shows Summarize in Chat and Add to RAG after fetch', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Fetch/i }));
    });

    expect(screen.getByRole('button', { name: /Summarize in Chat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add to RAG/i })).toBeInTheDocument();
  });

  test('calls onSendToChat when Summarize is clicked', async () => {
    setupElectron();
    const onSendToChat = jest.fn();
    render(<WebServicesPanel onSendToChat={onSendToChat} />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Fetch/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Summarize in Chat/i }));
    });

    expect(onSendToChat).toHaveBeenCalledWith('https://example.com', 'Example page content here.');
  });

  test('shows error when fetch fails', async () => {
    setupElectron({
      fetchPageContent: jest.fn().mockResolvedValue({ success: false, error: 'Connection refused' }),
    });
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://down.example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Fetch/i }));
    });

    expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
  });

  test('auto-prepends https:// to bare domains', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Fetch/i }));
    });

    expect((window as any).electron.fetchPageContent).toHaveBeenCalledWith('https://example.com');
  });

  test('fetches on Enter key press', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect((window as any).electron.fetchPageContent).toHaveBeenCalled();
  });

  test('shows fetched character count in status message', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Fetch/i }));
    });

    expect(screen.getByText(/Fetched 27 characters/)).toBeInTheDocument();
  });
});

describe('WebServicesPanel — service launchers', () => {
  test('renders ChatGPT, Claude, and Gemini cards', () => {
    setupElectron();
    render(<WebServicesPanel />);
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Gemini')).toBeInTheDocument();
  });

  test('renders Web Services heading', () => {
    setupElectron();
    render(<WebServicesPanel />);
    expect(screen.getByText('Web Services')).toBeInTheDocument();
  });

  test('clicking Open calls webServices.open', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const openButtons = screen.getAllByRole('button', { name: /Open/i });
    await act(async () => {
      fireEvent.click(openButtons[0]);
    });

    expect((window as any)._webServices.open).toHaveBeenCalledWith('chatgpt');
  });
});
