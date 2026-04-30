import React from 'react';
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
  if (!open) return null;

  return (
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
  );
};

export default NotificationHistory;
