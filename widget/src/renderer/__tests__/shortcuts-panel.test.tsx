/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';
import ShortcutsPanel from '../components/ShortcutsPanel';

const noop = () => {};

describe('ShortcutsPanel', () => {
  test('renders nothing when closed', () => {
    const { container } = render(<ShortcutsPanel open={false} onClose={noop} />);
    expect(container.innerHTML).toBe('');
  });

  test('renders overlay when open', () => {
    render(<ShortcutsPanel open={true} onClose={noop} />);
    expect(screen.getByTestId('shortcuts-overlay')).toBeInTheDocument();
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  test('lists shortcuts from all categories', () => {
    render(<ShortcutsPanel open={true} onClose={noop} />);
    expect(screen.getByText(/Toggle SADIE widget/)).toBeInTheDocument();
    expect(screen.getByText('Send message')).toBeInTheDocument();
    expect(screen.getByText('Toggle voice input')).toBeInTheDocument();
    expect(screen.getByText(/Close current panel/)).toBeInTheDocument();
    expect(screen.getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('New line in message')).toBeInTheDocument();
    expect(screen.getByText('New conversation')).toBeInTheDocument();
    expect(screen.getByText('Toggle sidebar')).toBeInTheDocument();
  });

  test('renders category headings', () => {
    render(<ShortcutsPanel open={true} onClose={noop} />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Panels')).toBeInTheDocument();
  });

  test('renders kbd elements for key combos', () => {
    render(<ShortcutsPanel open={true} onClose={noop} />);
    const kbds = screen.getAllByText('Ctrl', { selector: 'kbd' });
    expect(kbds.length).toBeGreaterThanOrEqual(2);
  });

  test('calls onClose when close button clicked', () => {
    const onClose = jest.fn();
    render(<ShortcutsPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close shortcuts'));
    expect(onClose).toHaveBeenCalled();
  });

  test('calls onClose when overlay backdrop clicked', () => {
    const onClose = jest.fn();
    render(<ShortcutsPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('shortcuts-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  test('calls onClose on Escape key', () => {
    const onClose = jest.fn();
    render(<ShortcutsPanel open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('does not close on non-Escape key', () => {
    const onClose = jest.fn();
    render(<ShortcutsPanel open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
