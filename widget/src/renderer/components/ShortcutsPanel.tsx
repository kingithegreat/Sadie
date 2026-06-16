import React, { useEffect } from 'react';

interface ShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutCategory {
  title: string;
  shortcuts: { keys: string; action: string }[];
}

const categories: ShortcutCategory[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: 'Ctrl + Shift + Space', action: 'Toggle HomeBot widget (global)' },
      { keys: 'Ctrl + /', action: 'Show keyboard shortcuts' },
      { keys: 'Escape', action: 'Close current panel / modal' },
    ],
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: 'Enter', action: 'Send message' },
      { keys: 'Shift + Enter', action: 'New line in message' },
      { keys: 'Ctrl + Shift + V', action: 'Toggle voice input' },
      { keys: 'Ctrl + Shift + C', action: 'Copy last response' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl + N', action: 'New conversation' },
      { keys: 'Ctrl + F', action: 'Search conversations' },
      { keys: 'Ctrl + ,', action: 'Open settings' },
      { keys: 'Ctrl + B', action: 'Toggle sidebar' },
    ],
  },
  {
    title: 'Panels',
    shortcuts: [
      { keys: 'Ctrl + 1', action: 'Switch to Chat' },
      { keys: 'Ctrl + 2', action: 'Switch to Image Generator' },
      { keys: 'Ctrl + 3', action: 'Switch to Document Viewer' },
      { keys: 'Ctrl + 4', action: 'Switch to Web Services' },
    ],
  },
];

const ShortcutsPanel: React.FC<ShortcutsPanelProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="shortcuts-overlay" data-testid="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close shortcuts">×</button>
        </div>
        <div className="shortcuts-list">
          {categories.map(cat => (
            <div key={cat.title} className="shortcut-category">
              <h3 className="shortcut-category-title">{cat.title}</h3>
              {cat.shortcuts.map(s => (
                <div key={s.keys} className="shortcut-row">
                  <span className="shortcut-keys">
                    {s.keys.split(' + ').map((k, i) => (
                      <React.Fragment key={k}>
                        {i > 0 && <span className="shortcut-plus">+</span>}
                        <kbd>{k}</kbd>
                      </React.Fragment>
                    ))}
                  </span>
                  <span className="shortcut-action">{s.action}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="shortcuts-footer">
          Press <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
};

export default ShortcutsPanel;
