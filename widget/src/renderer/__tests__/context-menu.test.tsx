/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, useContextMenu } from '../components/ContextMenu';
import type { ContextMenuItem } from '../components/ContextMenu';

describe('ContextMenu', () => {
  const noop = () => {};

  test('renders menu items', () => {
    const items: ContextMenuItem[] = [
      { label: 'Copy', icon: '📋', action: noop },
      { label: 'Delete', icon: '🗑️', action: noop },
    ];
    render(<ContextMenu x={100} y={200} items={items} onClose={noop} />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('renders dividers as separators', () => {
    const items: ContextMenuItem[] = [
      { label: 'Above', action: noop },
      { divider: true, label: '', action: noop },
      { label: 'Below', action: noop },
    ];
    const { container } = render(<ContextMenu x={0} y={0} items={items} onClose={noop} />);
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
  });

  test('calls action and onClose when item clicked', () => {
    const action = jest.fn();
    const onClose = jest.fn();
    const items: ContextMenuItem[] = [{ label: 'Do thing', action }];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByText('Do thing'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not call action when item is disabled', () => {
    const action = jest.fn();
    const onClose = jest.fn();
    const items: ContextMenuItem[] = [{ label: 'Disabled', action, disabled: true }];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByText('Disabled'));
    expect(action).not.toHaveBeenCalled();
  });

  test('closes on Escape key', () => {
    const onClose = jest.fn();
    const items: ContextMenuItem[] = [{ label: 'Item', action: noop }];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('closes on click outside', () => {
    const onClose = jest.fn();
    const items: ContextMenuItem[] = [{ label: 'Item', action: noop }];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.mouseDown(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders icons when provided', () => {
    const items: ContextMenuItem[] = [
      { label: 'Copy', icon: '📋', action: noop },
    ];
    const { container } = render(<ContextMenu x={0} y={0} items={items} onClose={noop} />);
    expect(container.querySelector('.context-menu-icon')).not.toBeNull();
    expect(container.querySelector('.context-menu-icon')?.textContent).toBe('📋');
  });

  test('has correct role attributes', () => {
    const items: ContextMenuItem[] = [{ label: 'Action', action: noop }];
    const { container } = render(<ContextMenu x={0} y={0} items={items} onClose={noop} />);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(container.querySelector('[role="menuitem"]')).not.toBeNull();
  });
});

describe('useContextMenu hook', () => {
  function TestHost() {
    const { menu, showContextMenu, closeContextMenu } = useContextMenu();
    return (
      <div>
        <button
          data-testid="trigger"
          onContextMenu={(e) => showContextMenu(e, [{ label: 'Test', action: () => {} }])}
        >
          Right-click me
        </button>
        {menu && (
          <div data-testid="menu-open">
            <button data-testid="close-btn" onClick={closeContextMenu}>close</button>
          </div>
        )}
      </div>
    );
  }

  test('menu is null initially', () => {
    render(<TestHost />);
    expect(screen.queryByTestId('menu-open')).toBeNull();
  });

  test('showContextMenu opens menu on contextmenu event', () => {
    render(<TestHost />);
    fireEvent.contextMenu(screen.getByTestId('trigger'));
    expect(screen.getByTestId('menu-open')).toBeInTheDocument();
  });

  test('closeContextMenu closes menu', () => {
    render(<TestHost />);
    fireEvent.contextMenu(screen.getByTestId('trigger'));
    expect(screen.getByTestId('menu-open')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(screen.queryByTestId('menu-open')).toBeNull();
  });
});
