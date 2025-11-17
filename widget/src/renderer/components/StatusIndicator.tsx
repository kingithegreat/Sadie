import React from 'react';
import { ConnectionStatus } from '../../shared/types';

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  onRefresh: () => void;
  onSettingsClick: () => void;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  connectionStatus,
  onRefresh,
  onSettingsClick
}) => {
  const getStatusColor = (status: 'online' | 'offline' | 'checking') => {
    switch (status) {
      case 'online':
        return '#34c759';
      case 'offline':
        return '#ff3b30';
      case 'checking':
        return '#ff9500';
      default:
        return '#8e8e93';
    }
  };

  const getStatusText = (status: 'online' | 'offline' | 'checking') => {
    switch (status) {
      case 'online':
        return 'Online';
      case 'offline':
        return 'Offline';
      case 'checking':
        return 'Checking...';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="status-indicator">
      <div className="status-badges">
        <div className="status-badge">
          <span 
            className="status-dot"
            style={{ backgroundColor: getStatusColor(connectionStatus.n8n) }}
          />
          <span className="status-label">n8n: {getStatusText(connectionStatus.n8n)}</span>
        </div>
        
        <div className="status-badge">
          <span 
            className="status-dot"
            style={{ backgroundColor: getStatusColor(connectionStatus.ollama) }}
          />
          <span className="status-label">Ollama: {getStatusText(connectionStatus.ollama)}</span>
        </div>
      </div>

      <div className="status-actions">
        <button
          onClick={onRefresh}
          className="icon-button"
          title="Refresh connection status"
          aria-label="Refresh"
        >
          ↻
        </button>
        <button
          onClick={onSettingsClick}
          className="icon-button"
          title="Open settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>

      <style jsx>{`
        .status-indicator {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--bg-alt);
          border-bottom: 1px solid var(--border);
        }

        .status-badges {
          display: flex;
          gap: var(--spacing-md);
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          font-size: 12px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .status-label {
          color: var(--text);
          font-weight: 500;
        }

        .status-actions {
          display: flex;
          gap: var(--spacing-xs);
        }

        .icon-button {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 16px;
          color: var(--text);
          transition: all 0.2s ease;
        }

        .icon-button:hover {
          background: var(--bg);
          border-color: var(--primary);
        }

        .icon-button:focus {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
};

export default StatusIndicator;
