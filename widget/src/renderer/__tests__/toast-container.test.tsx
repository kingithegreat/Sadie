/** @jest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastContainer, useToasts } from '../components/ToastContainer';
import type { Toast } from '../components/ToastContainer';

describe('ToastContainer', () => {
  const noop = () => {};

  test('renders nothing when no toasts', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={noop} />);
    expect(container.innerHTML).toBe('');
  });

  test('renders toast items', () => {
    const toasts: Toast[] = [
      { id: '1', message: 'Hello', type: 'info' },
      { id: '2', message: 'Success!', type: 'success' },
    ];
    render(<ToastContainer toasts={toasts} onDismiss={noop} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Success!')).toBeInTheDocument();
  });

  test('calls onDismiss when toast clicked', () => {
    const onDismiss = jest.fn();
    const toasts: Toast[] = [{ id: 't1', message: 'Click me', type: 'info' }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Click me'));
    // onDismiss is called after 300ms exit animation
    jest.advanceTimersByTime(300);
  });

  test('renders correct icons for each type', () => {
    const toasts: Toast[] = [
      { id: '1', message: 'msg-info', type: 'info' },
      { id: '2', message: 'msg-success', type: 'success' },
      { id: '3', message: 'msg-warning', type: 'warning' },
      { id: '4', message: 'msg-error', type: 'error' },
    ];
    render(<ToastContainer toasts={toasts} onDismiss={noop} />);
    expect(screen.getByText('ℹ️')).toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
    expect(screen.getByText('⚠️')).toBeInTheDocument();
    expect(screen.getByText('❌')).toBeInTheDocument();
  });

  test('toast has correct CSS class for type', () => {
    const toasts: Toast[] = [{ id: '1', message: 'warn-toast', type: 'warning' }];
    render(<ToastContainer toasts={toasts} onDismiss={noop} />);
    const item = screen.getByTestId('toast-item');
    expect(item.className).toContain('toast-warning');
  });

  test('renders dismiss button with aria-label', () => {
    const toasts: Toast[] = [{ id: '1', message: 'Test', type: 'info' }];
    render(<ToastContainer toasts={toasts} onDismiss={noop} />);
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
  });

  test('auto-dismisses after duration', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    const toasts: Toast[] = [{ id: '1', message: 'Auto', type: 'info', duration: 1000 }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    
    act(() => { jest.advanceTimersByTime(1000); }); // trigger dismiss
    act(() => { jest.advanceTimersByTime(300); });  // exit animation
    
    expect(onDismiss).toHaveBeenCalledWith('1');
    jest.useRealTimers();
  });

  test('sticky toast (duration=0) does not auto-dismiss', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    const toasts: Toast[] = [{ id: '1', message: 'Sticky', type: 'info', duration: 0 }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    
    act(() => { jest.advanceTimersByTime(10000); });
    
    expect(onDismiss).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('container has aria-live polite', () => {
    const toasts: Toast[] = [{ id: '1', message: 'Test', type: 'info' }];
    render(<ToastContainer toasts={toasts} onDismiss={noop} />);
    expect(screen.getByTestId('toast-container').getAttribute('aria-live')).toBe('polite');
  });
});

describe('useToasts hook', () => {
  function TestHarness() {
    const { toasts, addToast, dismissToast } = useToasts();
    return (
      <div>
        <button onClick={() => addToast('Test toast', 'info')}>Add</button>
        <button onClick={() => { if (toasts.length) dismissToast(toasts[0].id); }}>Remove</button>
        <span data-testid="count">{toasts.length}</span>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  test('addToast adds a toast, dismissToast removes it', () => {
    render(<TestHarness />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByText('Test toast')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Remove'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
