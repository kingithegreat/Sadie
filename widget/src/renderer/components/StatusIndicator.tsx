import React, { useState, useEffect } from 'react';
import { ConnectionStatus } from '../../shared/types';

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  onRefresh: () => void;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
  backendDiagnostic?: string | null;
  onCopyDiagnostic?: (text: string) => void;
  onDismissDiagnostic?: () => void;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  connectionStatus,
  onRefresh,
  onSettingsClick,
  onMenuClick
  , backendDiagnostic, onCopyDiagnostic, onDismissDiagnostic
}) => {
  const [detailOpen, setDetailOpen] = useState(false);
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
      <div className="app-title">
        <img src={require('../assets/SadieLogo.png')} alt="SADIE" className="app-logo" />
        <h1>SADIE</h1>
      </div>
      
      <div className="status-bar-inline">
        <div className="status-item">
          <span className={`status-dot ${getStatusClass(connectionStatus.ollama)}`} />
          <span>Ollama</span>
        </div>

        <div className="status-item">
          <span className={`status-dot ${getStatusClass(connectionStatus.n8n)}`} />
          <span>n8n</span>
        </div>

        {/* Soft backend badge when n8n is offline */}
        {connectionStatus.n8n === 'offline' && (
          <div className="backend-badge" title="SADIE backend (n8n) is offline. Start n8n to restore functionality.">
            <span className="backend-text">SADIE backend offline</span>
            <button className="backend-retry" onClick={() => { try { (window as any).sadieCapture?.log('[Renderer] Retry connection (backend badge)'); } catch (e) {} ; onRefresh(); }} aria-label="Retry connection">↻</button>
            {backendDiagnostic && (
              <>
                <button className="backend-detail" onClick={() => setDetailOpen(true)} title="Details">⋯</button>
                {detailOpen && (
                  <div className="backend-popover" role="dialog" aria-label="SADIE backend diagnostic">
                    <pre className="backend-popover-text">{backendDiagnostic}</pre>
                    <div className="backend-popover-actions">
                      <button onClick={() => { onCopyDiagnostic?.(backendDiagnostic); setDetailOpen(false); }}>Copy</button>
                      <button onClick={() => { setDetailOpen(false); onDismissDiagnostic?.(); }}>Dismiss</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        
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
          onClick={() => { try { (window as any).sadieCapture?.log('[Renderer] Retry connection (header)'); } catch (e) {} ; onRefresh(); }}
          className="header-btn"
          title="Refresh connection"
          aria-label="Refresh"
        >
          ↻
        </button>
        <button
          onClick={async () => {
            try { (window as any).sadieCapture?.log('[Renderer] Capture logs requested (header)'); } catch (e) {}
            const r = await (window as any).electron?.captureLogs?.();
            if (r?.success && r.path) {
              try { (window as any).sadieCapture?.log(`[Renderer] Capture saved ${r.path}`); } catch (e) {}
              // Show a quick system chat message to notify user
              const event = new CustomEvent('sadie:capture-saved', { detail: { path: r.path } });
              window.dispatchEvent(event);
            } else {
              try { (window as any).sadieCapture?.log(`[Renderer] Capture failed: ${r?.error}`); } catch (e) {}
            }
          }}
          className="header-btn"
          title="Capture logs"
          aria-label="Capture logs"
        >
          📁
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

        .app-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .app-logo {
          width: 28px;
          height: 28px;
          border-radius: 6px;
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

        .backend-badge {
          background: rgba(255,213,85,0.18);
          color: #ffd555;
          padding: 6px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          margin-left: 8px;
          -webkit-app-region: no-drag;
          display: inline-flex;
          gap: 8px;
          align-items: center;
          border: 1px solid rgba(255,213,85,0.4);
        }
        .backend-detail {
          appearance: none;
          border: none;
          background: transparent;
          color: #ffd555;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }

        .backend-retry {
          appearance: none;
          border: none;
          background: transparent;
          color: #ffd555;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
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

        .backend-popover {
          position: absolute;
          top: 48px;
          right: 16px;
          background: #121212;
          padding: 12px;
          border-radius: 8px;
          border: 1px solid rgba(255,213,85,0.12);
          min-width: 320px;
          max-width: 520px;
          max-height: 40vh;
          overflow: auto;
          z-index: 9999;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        }

        .backend-popover-text {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Segoe UI Mono', monospace;
          font-size: 12px;
          color: #EAEAEA;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0 0 6px 0;
        }

        .backend-popover-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          padding-top: 6px;
        }
      `}</style>
    </div>
  );
};

export default StatusIndicator;
