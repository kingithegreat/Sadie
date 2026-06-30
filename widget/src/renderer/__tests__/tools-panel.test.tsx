/** @jest-environment jsdom */
/**
 * tools-panel.test.tsx
 * Tests for src/renderer/components/ToolsPanel.tsx
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ToolsPanel from '../components/ToolsPanel';

const TOOLS = [
  { name: 'read_file', description: 'Read a file from disk', category: 'filesystem' },
  { name: 'web_search', description: 'Search the web', category: 'web' },
  { name: 'speak', description: 'Text to speech', category: 'voice' },
  { name: 'calculate', description: 'Evaluate a math expression', category: 'utility' },
];

function setupElectron(overrides: Record<string, () => Promise<any>> = {}) {
  (window as any).electron = {
    listTools: jest.fn().mockResolvedValue({ success: true, tools: TOOLS }),
    ...overrides,
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('ToolsPanel — rendering', () => {
  test('renders the panel heading', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByText(/Available Tools/)).toBeInTheDocument();
  });

  test('renders Close button', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByRole('button', { name: /close tools panel/i })).toBeInTheDocument();
  });

  test('calls onClose when Close is clicked', async () => {
    setupElectron();
    const onClose = jest.fn();
    await act(async () => { render(<ToolsPanel onClose={onClose} />); });
    fireEvent.click(screen.getByRole('button', { name: /close tools panel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when Escape key is pressed on the dialog', async () => {
    setupElectron();
    const onClose = jest.fn();
    await act(async () => { render(<ToolsPanel onClose={onClose} />); });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when overlay backdrop is clicked', async () => {
    setupElectron();
    const onClose = jest.fn();
    await act(async () => { render(<ToolsPanel onClose={onClose} />); });
    // The overlay is the role="presentation" div wrapping the dialog
    const overlay = screen.getByRole('presentation');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders search input', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByRole('textbox', { name: /Search tools/i })).toBeInTheDocument();
  });
});

describe('ToolsPanel — loading tools', () => {
  test('renders category headers for each unique category', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByText('Filesystem')).toBeInTheDocument();
    expect(screen.getByText('Web')).toBeInTheDocument();
  });

  test('renders tool names', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();
  });

  test('shows error from result.error when success is false', async () => {
    setupElectron({
      listTools: jest.fn().mockResolvedValue({ success: false, error: 'IPC failed' }),
    });
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByText('IPC failed')).toBeInTheDocument();
  });

  test('shows generic error when listTools throws', async () => {
    setupElectron({
      listTools: jest.fn().mockRejectedValue(new Error('network error')),
    });
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByText('network error')).toBeInTheDocument();
  });

  test('shows category icons', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(document.body.textContent).toContain('📁');
    expect(document.body.textContent).toContain('🌐');
  });

  test('shows tool count in heading', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    expect(screen.getByText(/Available Tools \(4\)/)).toBeInTheDocument();
  });
});

describe('ToolsPanel — search', () => {
  test('filters tools by name', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    fireEvent.change(screen.getByRole('textbox', { name: /Search tools/i }), {
      target: { value: 'read' },
    });
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.queryByText('web_search')).toBeNull();
  });

  test('filters tools by description', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    fireEvent.change(screen.getByRole('textbox', { name: /Search tools/i }), {
      target: { value: 'speech' },
    });
    expect(screen.getByText('speak')).toBeInTheDocument();
    expect(screen.queryByText('read_file')).toBeNull();
  });

  test('filters tools by category', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    fireEvent.change(screen.getByRole('textbox', { name: /Search tools/i }), {
      target: { value: 'voice' },
    });
    expect(screen.getByText('speak')).toBeInTheDocument();
    expect(screen.queryByText('calculate')).toBeNull();
  });

  test('shows "No tools match" when search has no results', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    fireEvent.change(screen.getByRole('textbox', { name: /Search tools/i }), {
      target: { value: 'xxxxnotfound' },
    });
    expect(screen.getByText(/No tools match/)).toBeInTheDocument();
  });
});

describe('ToolsPanel — category collapse/expand', () => {
  test('categories are expanded by default', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    // Tool names are visible without any interaction
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  test('clicking a category header collapses it', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    const fsBtn = screen.getByRole('button', { name: /Filesystem tools/i });
    fireEvent.click(fsBtn);
    expect(screen.queryByText('read_file')).toBeNull();
  });

  test('clicking a collapsed category re-expands it', async () => {
    setupElectron();
    await act(async () => { render(<ToolsPanel onClose={jest.fn()} />); });
    const fsBtn = screen.getByRole('button', { name: /Filesystem tools/i });
    fireEvent.click(fsBtn); // collapse
    fireEvent.click(fsBtn); // re-expand
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });
});
