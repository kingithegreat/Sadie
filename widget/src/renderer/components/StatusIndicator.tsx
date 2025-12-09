import React, { useState, useEffect } from 'react';
import { ConnectionStatus } from '../../shared/types';

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  onRefresh: () => void;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  connectionStatus,
  onRefresh,
  onSettingsClick,
  onMenuClick
}) => {
  const [uncensoredMode, setUncensoredMode] = useState(false);

  // Load uncensored mode state on mount
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
  }, []);

  const handleUncensoredToggle = async () => {
    const newValue = !uncensoredMode;
    setUncensoredMode(newValue);
    await (window as any).electron?.setUncensoredMode?.(newValue);
  };

  const getStatusClass = (status: 'online' | 'offline' | 'checking') => {
    switch (status) {
      case 'online':
        return 'connected';
      case 'checking':
        return 'checking';
      default:
        return 'disconnected';
    }
  };

  const getStatusText = (status: 'online' | 'offline' | 'checking') => {
    switch (status) {
      case 'online':
        return 'Connected';
      case 'offline':
        return 'Offline';
      case 'checking':
        return 'Checking...';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="app-header">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="menu-btn"
          title="Conversations"
          aria-label="Open conversations"
        >
          ☰
        </button>
      )}
      <h1>✨ SADIE</h1>
      
      <div className="status-bar-inline">
        <div className="status-item">
          <span className={`status-dot ${getStatusClass(connectionStatus.ollama)}`} />
          <span>Ollama</span>
        </div>
        
        {/* Uncensored Mode Toggle */}
        <div 
          className={`uncensored-toggle ${uncensoredMode ? 'active' : ''}`}
          onClick={handleUncensoredToggle}
          title={uncensoredMode ? 'Uncensored Mode ON (dolphin-llama3:8b)' : 'Uncensored Mode OFF (llama3.2:3b)'}
        >
          <span className="toggle-icon">{uncensoredMode ? '🔓' : '🔒'}</span>
          <span className="toggle-label">{uncensoredMode ? 'Uncensored' : 'Safe'}</span>
        </div>
      </div>

      <div className="header-actions">
        <button
          onClick={onRefresh}
          className="header-btn"
          title="Refresh connection"
          aria-label="Refresh"
        >
          ↻
        </button>
        <button
          onClick={onSettingsClick}
          className="header-btn"
          title="Settings"
          aria-label="Settings"
        >
          ⚙️
        </button>
      </div>

      <style>{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: #1A1A1A;
          border-bottom: 1px solid #333333;
          -webkit-app-region: drag;
          min-height: 48px;
        }

        .app-header h1 {
          font-size: 16px;
          font-weight: 600;
          color: #ECECEC;
          letter-spacing: -0.3px;
          margin: 0;
        }

        .status-bar-inline {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .status-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #B4B4B4;
        }

        .uncensored-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          background: #2a2a2a;
          border: 1px solid #444;
          cursor: pointer;
          transition: all 150ms ease;
          -webkit-app-region: no-drag;
          font-size: 11px;
          color: #888;
        }

        .uncensored-toggle:hover {
          background: #333;
          border-color: #555;
        }

        .uncensored-toggle.active {
          background: linear-gradient(135deg, #4a1a1a, #1a1a4a);
          border-color: #f59e0b;
          color: #f59e0b;
        }

        .uncensored-toggle .toggle-icon {
          font-size: 14px;
        }

        .uncensored-toggle .toggle-label {
          font-weight: 500;
        }

        .header-actions {
          display: flex;
          gap: 8px;
          -webkit-app-region: no-drag;
        }

        .header-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: #B4B4B4;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: 150ms ease;
          font-size: 16px;
        }

        .header-btn:hover {
          background: #333333;
          color: #ECECEC;
        }
      `}</style>
    </div>
  );
};

export default StatusIndicator;
