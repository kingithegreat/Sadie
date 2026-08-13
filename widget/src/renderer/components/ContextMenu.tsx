import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, handleKeyDown]);

  // Adjust position so menu doesn't overflow viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 4;
      const maxY = window.innerHeight - rect.height - 4;
      if (x > maxX) menuRef.current.style.left = `${maxX}px`;
      if (y > maxY) menuRef.current.style.top = `${maxY}px`;
    }
  }, [x, y]);

  // Portalled to document.body, and it must be. As a child of .app-container it
  // was matched by the blanket rule in chatgpt-theme.css:
  //
  //   .app-container > *:not(.app-header):not(.widget-titlebar)... {
  //     position: relative; z-index: 1; }
  //
  // which is (0,9,0) and so beat this menu's own (0,1,0) `position: fixed`. The
  // menu was therefore laid out as a GRID ROW of the app container: measured at
  // 1202x556 and 117px away from the click, instead of a small panel under the
  // cursor. That rule is a blocklist — every overlay has to remember to add
  // itself to the :not() chain, and this one never did. Leaving the tree
  // entirely is the fix that cannot be forgotten next time.
  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ position: 'fixed', top: y, left: x }}
      role="menu"
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="context-menu-divider" role="separator" />
        ) : (
          <button
            key={i}
            className="context-menu-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Hook to manage context menu state */
export function useContextMenu() {
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const showContextMenu = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setMenu(null), []);

  return { menu, showContextMenu, closeContextMenu };
}
