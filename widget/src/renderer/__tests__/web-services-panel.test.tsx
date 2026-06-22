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
    openBrowse: jest.fn().mockResolvedValue(undefined),
    grabContent: jest.fn().mockResolvedValue({ success: false }),
    browseStatus: jest.fn().mockResolvedValue({ open: false }),
    status: jest.fn().mockResolvedValue({ chatgpt: false, claude: false, gemini: false }),
  };
}

afterEach(() => {
  delete (window as any).electron;
  delete (window as any)._webServices;
});

describe('WebServicesPanel — URL browser', () => {
  test('renders the URL input and Open button', () => {
    setupElectron();
    render(<WebServicesPanel />);
    expect(screen.getByPlaceholderText(/Enter a URL/i)).toBeInTheDocument();
    const urlOpenBtn = screen.getAllByRole('button', { name: /^Open$/i })[0];
    expect(urlOpenBtn).toBeInTheDocument();
  });

  test('renders Web Browser heading', () => {
    setupElectron();
    render(<WebServicesPanel />);
    expect(screen.getByText('Web Browser')).toBeInTheDocument();
  });

  test('URL Open button is disabled when URL is empty', () => {
    setupElectron();
    render(<WebServicesPanel />);
    const urlOpenBtn = screen.getAllByRole('button', { name: /^Open$/i })[0];
    expect(urlOpenBtn).toBeDisabled();
  });

  test('opens browser on click', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    const urlOpenBtn = screen.getAllByRole('button', { name: /^Open$/i })[0];
    await act(async () => {
      fireEvent.click(urlOpenBtn);
    });

    expect((window as any)._webServices.openBrowse).toHaveBeenCalledWith('https://example.com');
  });

  test('shows Summarize button when browse status is open', async () => {
    setupElectron();
    (window as any)._webServices.browseStatus = jest.fn().mockResolvedValue({ open: true, url: 'https://example.com', title: 'Example' });
    await act(async () => {
      render(<WebServicesPanel />);
    });

    expect(screen.getByRole('button', { name: /Summarize This Page/i })).toBeInTheDocument();
  });

  test('auto-prepends https:// to bare domains', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'example.com' } });

    const urlOpenBtn = screen.getAllByRole('button', { name: /^Open$/i })[0];
    await act(async () => {
      fireEvent.click(urlOpenBtn);
    });

    expect((window as any)._webServices.openBrowse).toHaveBeenCalledWith('https://example.com');
  });

  test('opens browser on Enter key press', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const input = screen.getByPlaceholderText(/Enter a URL/i);
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect((window as any)._webServices.openBrowse).toHaveBeenCalled();
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

  test('clicking service Open calls webServices.open', async () => {
    setupElectron();
    render(<WebServicesPanel />);

    const openButtons = screen.getAllByRole('button', { name: /^Open$/i });
    // First Open is the URL bar button; service launcher Open buttons follow
    const serviceOpenBtn = openButtons[openButtons.length >= 2 ? 1 : 0];
    await act(async () => {
      fireEvent.click(serviceOpenBtn);
    });

    expect((window as any)._webServices.open).toHaveBeenCalledWith('chatgpt');
  });
});
