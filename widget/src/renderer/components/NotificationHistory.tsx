import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { NotificationRecord } from './ToastContainer';

interface NotificationHistoryProps {
  open: boolean;
  onClose: () => void;
  history: NotificationRecord[];
  onClear: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMs / 3600000);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const typeIcon: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

const NotificationHistory: React.FC<NotificationHistoryProps> = ({ open, onClose, history, onClear }) => {
  // Escape closes. Clicking the backdrop already did, but a panel that fills
  // the window and can only be dismissed with the mouse is unusable by
  // keyboard. This mattered less when the blanket .app-container rule was
  // laying the panel out as an inert page row; now that it genuinely covers
  // everything, it is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  // Portalled to document.body. As a direct child of .app-container this was
  // matched by the blanket rule in chatgpt-theme.css:
  //
  //   .app-container > *:not(.app-header):not(.widget-titlebar)... {
  //     position: relative; z-index: 1; }
  //
  // which is (0,10,0) and beats this overlay's own `position: fixed`. The panel
  // was therefore laid out as a page row instead of covering the window. That
  // rule is a blocklist — it excludes the handful of overlays someone
  // remembered to name, and silently captures every one they did not.
  return createPortal((
    <div className="notification-history-overlay" onClick={onClose}>
      <div className="notification-history-panel" onClick={e => e.stopPropagation()}>
        <div className="notification-history-header">
          <h2>Notifications</h2>
          <div className="notification-history-actions">
            {history.length > 0 && (
              <button className="notif-clear-btn" onClick={onClear}>Clear all</button>
            )}
            <button className="close-btn" onClick={onClose} aria-label="Close notifications">×</button>
          </div>
        </div>
        <div className="notification-history-list">
          {history.length === 0 ? (
            <div className="notif-empty">No notifications yet</div>
          ) : (
            history.map(n => (
              <div key={n.id} className={`notif-item notif-${n.type || 'info'}`}>
                <span className="notif-icon">{typeIcon[n.type || 'info'] || 'ℹ️'}</span>
                <span className="notif-message">{n.message}</span>
                <span className="notif-time">{formatTime(n.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  ), document.body);
};

export default NotificationHistory;
