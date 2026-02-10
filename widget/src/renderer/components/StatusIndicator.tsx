import React, { useState, useEffect } from 'react';
import { ConnectionStatus, CustomLLMConfig } from '../../shared/types';
import ModelSelector from './ModelSelector';

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  onRefresh: () => void;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
  backendDiagnostic?: string | null;
  onCopyDiagnostic?: (text: string) => void;
  onDismissDiagnostic?: () => void;
  mode?: 'chat' | 'automation' | 'image';
  onModeChange?: (mode: 'chat' | 'automation' | 'image') => void;
  currentModel?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  onModelChange?: (model: string, useCustom: boolean) => void;
  uncensoredModel?: string;
} 

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  connectionStatus,
  onRefresh,
  onSettingsClick,
  onMenuClick,
  backendDiagnostic,
  onCopyDiagnostic,
  onDismissDiagnostic,
  mode = 'chat',
  onModeChange,
  currentModel = 'llama3.2:3b',
  customLLM,
  useCustomLLM = false,
  onModelChange,
  uncensoredModel = 'dolphin-llama3:8b'
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

  return (
    <div className="app-header">
      <div className="header-left-group">
        <div className="header-brand">
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
        </div>

        <div className="header-connection">
          <div className="status-bar-inline">
            <div className="status-item">
              <span className={`status-dot ${getStatusClass(connectionStatus.ollama)}`} />
              <span>Ollama</span>
            </div>

            <div className="status-item">
              <span className={`status-dot ${getStatusClass(connectionStatus.n8n)}`} />
              <span>n8n</span>
            </div>
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
        </div>

        <div className="header-model">
          {onModelChange && (
            <ModelSelector
              currentModel={currentModel}
              customLLM={customLLM}
              useCustomLLM={useCustomLLM}
              onModelChange={onModelChange}
              onConfigureCustom={onSettingsClick}
              locked={uncensoredMode}
              lockedModelId={uncensoredModel}
              lockReason="Turn off 🔓 Uncensored Mode to switch models"
            />
          )}
        </div>

        {/* Uncensored Mode Toggle */}
        <div 
          className={`uncensored-toggle ${uncensoredMode ? 'active' : ''}`}
          onClick={handleUncensoredToggle}
          title={uncensoredMode ? 'Uncensored Mode ON (dolphin-llama3:8b)' : 'Safe Mode - using selected model'}
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

        {onModeChange && (
          <div className="mode-switcher">
            <button
              className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
              onClick={() => onModeChange('chat')}
              title="Chat Mode"
            >
              💬 Chat
            </button>
            <button
              className={`mode-btn ${mode === 'automation' ? 'active' : ''}`}
              onClick={() => onModeChange('automation')}
              title="Automation Control Center"
            >
              ⚙️ Automation
            </button>
            <button
              className={`mode-btn ${mode === 'image' ? 'active' : ''}`}
              onClick={() => onModeChange('image')}
              title="Image Mode"
            >
              🎨 Image
            </button>
          </div>
        )}
        <style>{`
        .backend-badge {
          backgroundColor: rgba(255,213,85,0.18);
          color: #ffd555;
          padding: 6px 10px;
          borderRadius: 12px;
          fontSize: 12px;
          fontWeight: 600;
          marginLeft: 8px;
          WebkitAppRegion: no-drag;
          display: inline-flex;
          gap: 8px;
          alignItems: center;
          border: 1px solid rgba(255,213,85,0.4);
        }
        .backend-detail {
          WebkitAppearance: none;
          border: none;
          background: transparent;
          color: #ffd555;
          fontSize: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }

        .backend-retry {
          WebkitAppearance: none;
          border: none;
          background: transparent;
          color: #ffd555;
          fontSize: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }

        .uncensored-toggle {
          display: flex;
          alignItems: center;
          gap: 6px;
          padding: 4px 10px;
          borderRadius: 12px;
          background: #2a2a2a;
          border: 1px solid #444;
          cursor: pointer;
          transition: all 150ms ease;
          WebkitAppRegion: no-drag;
          fontSize: 11px;
          color: #888;
        }

        .uncensored-toggle:hover {
          background: #333;
          borderColor: #555;
        }

        .uncensored-toggle.active {
          background: linear-gradient(135deg, #4a1a1a, #1a1a4a);
          borderColor: #f59e0b;
          color: #f59e0b;
        }

        .uncensored-toggle .toggle-icon {
          fontSize: 14px;
        }

        .uncensored-toggle .toggle-label {
          fontWeight: 500;
        }

        .header-actions {
          display: flex;
          gap: 8px;
          WebkitAppRegion: no-drag;
        }

        .header-btn {
          width: 32px;
          height: 32px;
          border: none;
          borderRadius: 8px;
          background: transparent;
          color: #B4B4B4;
          cursor: pointer;
          display: flex;
          alignItems: center;
          justifyContent: center;
          transition: 150ms ease;
          fontSize: 16px;
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
          borderRadius: 8px;
          border: 1px solid rgba(255,213,85,0.12);
          minWidth: 320px;
          maxWidth: 520px;
          maxHeight: 40vh;
          overflow: auto;
          zIndex: 9999;
          boxShadow: 0 8px 24px rgba(0,0,0,0.6);
        }

        .backend-popover-text {
          fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Segoe UI Mono', monospace;
          fontSize: 12px;
          color: #EAEAEA;
          whiteSpace: pre-wrap;
          wordBreak: break-word;
          margin: 0 0 6px 0;
        }

        .backend-popover-actions {
          display: flex;
          gap: 8px;
          justifyContent: flex-end;
          paddingTop: 6px;
        }
        `}</style>
      </div>
    </div>
  );
}

export default StatusIndicator;
