import React, { useEffect } from 'react';

interface ShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: 'Ctrl + Shift + Space', action: 'Toggle SADIE widget' },
  { keys: 'Ctrl + /', action: 'Show keyboard shortcuts' },
  { keys: 'Enter', action: 'Send message' },
  { keys: 'Shift + Enter', action: 'New line in message' },
  { keys: 'Ctrl + Shift + V', action: 'Toggle voice input' },
  { keys: 'Escape', action: 'Close current panel' },
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
          {shortcuts.map(s => (
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
        <div className="shortcuts-footer">
          Press <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
};

export default ShortcutsPanel;
