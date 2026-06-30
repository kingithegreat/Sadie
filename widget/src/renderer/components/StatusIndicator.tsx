import React, { useState, useEffect } from 'react';
import { ConnectionStatus, CustomLLMConfig } from '../../shared/types';
import ModelSelector from './ModelSelector';

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  onRefresh: () => void;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
  onExportChat?: () => void;
  onToolsClick?: () => void;
  onRagClick?: () => void;
  onAnalyticsClick?: () => void;
  onNotificationsClick?: () => void;
  notificationCount?: number;
  backendDiagnostic?: string | null;
  onCopyDiagnostic?: (text: string) => void;
  onDismissDiagnostic?: () => void;
<<<<<<< HEAD
  mode?: 'chat' | 'automation';
  onModeChange?: (mode: 'chat' | 'automation') => void;
=======
  mode?: 'chat' | 'automation' | 'image' | 'web' | 'documents' | 'quiz' | 'dashboard';
  onModeChange?: (mode: 'chat' | 'automation' | 'image' | 'web' | 'documents' | 'quiz' | 'dashboard') => void;
  currentModel?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  onModelChange?: (model: string, useCustom: boolean) => void;
  uncensoredModel?: string;
  vramGB?: number | null;
>>>>>>> origin/main
}

interface UncensoredToggleProps {
  uncensoredMode: boolean;
  onToggle: () => void;
}

interface BackendBadgeProps {
  backendDiagnostic?: string | null;
  detailOpen: boolean;
  onCopyDiagnostic?: (text: string) => void;
  onDismissDiagnostic?: () => void;
  onRefresh: () => void;
  onToggleDetail: (open: boolean) => void;
}

interface HeaderConnectionProps {
  connectionStatus: ConnectionStatus;
}

interface HeaderModelProps {
  currentModel: string;
  customLLM?: CustomLLMConfig;
  onModelChange?: (model: string, useCustom: boolean) => void;
  onSettingsClick: () => void;
  uncensoredMode: boolean;
  uncensoredModel: string;
  useCustomLLM: boolean;
  vramGB?: number | null;
}

interface ModeSwitcherProps {
  mode: 'chat' | 'automation' | 'image' | 'web' | 'documents' | 'quiz' | 'dashboard';
  onModeChange?: (mode: 'chat' | 'automation' | 'image' | 'web' | 'documents' | 'quiz' | 'dashboard') => void;
}

interface HeaderActionsProps {
  notificationCount: number;
  onAnalyticsClick?: () => void;
  onNotificationsClick?: () => void;
  onRagClick?: () => void;
  onRefresh: () => void;
  onSettingsClick: () => void;
  onToolsClick?: () => void;
}

const UncensoredToggle: React.FC<UncensoredToggleProps> = ({ uncensoredMode, onToggle }) => (
  <button
    type="button"
    className={`uncensored-toggle ${uncensoredMode ? 'active' : ''}`}
    onClick={onToggle}
    title={uncensoredMode ? 'Uncensored Mode ON — no system prompt, no tools' : 'Safe Mode - using selected model'}
    aria-pressed={uncensoredMode}
  >
    <span className="toggle-icon">{uncensoredMode ? '🔓' : '🔒'}</span>
    <span className="toggle-label">{uncensoredMode ? 'Uncensored' : 'Safe'}</span>
  </button>
);

const BackendBadge: React.FC<BackendBadgeProps> = ({
  backendDiagnostic,
  detailOpen,
  onCopyDiagnostic,
  onDismissDiagnostic,
  onRefresh,
  onToggleDetail
}) => (
  <div className="backend-badge" title="HomeBot backend (n8n) is offline">
    <span className="backend-text">Backend offline</span>
    <button
      type="button"
      className="backend-retry"
      onClick={() => {
        try { (window as any).homebotCapture?.log('[Renderer] Retry connection (backend badge)'); } catch (e) {}
        onRefresh();
      }}
      aria-label="Retry connection"
    >
      ↻
    </button>
    {backendDiagnostic && (
      <>
        <button
          type="button"
          className="backend-detail"
          onClick={() => onToggleDetail(true)}
          title="Details"
        >
          ⋯
        </button>
        {detailOpen && (
          <div className="backend-popover" role="dialog" aria-label="HomeBot backend diagnostic">
            <pre className="backend-popover-text">{backendDiagnostic}</pre>
            <div className="backend-popover-actions">
              <button
                type="button"
                onClick={() => {
                  onCopyDiagnostic?.(backendDiagnostic);
                  onToggleDetail(false);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  onToggleDetail(false);
                  onDismissDiagnostic?.();
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </>
    )}
  </div>
);

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

const HeaderConnection: React.FC<HeaderConnectionProps> = ({ connectionStatus }) => (
  <div className="header-connection">
    <div className="status-bar-inline">
      <div className="status-item" aria-label={`Ollama: ${connectionStatus.ollama}`}>
        <span className={`status-dot ${getStatusClass(connectionStatus.ollama)}`} role="status" />
        <span>Ollama</span>
      </div>
      <div className="status-item" aria-label={`n8n: ${connectionStatus.n8n}`}>
        <span className={`status-dot ${getStatusClass(connectionStatus.n8n)}`} role="status" />
        <span>n8n</span>
      </div>
    </div>
  </div>
);

const UNCENSORED_MODEL_LABELS: Record<string, string> = {
  'dolphin:7b': 'Dolphin 7B',
  'dolphin-mistral:7b': 'Dolphin 7B',
  'dolphin-llama3:8b': 'Dolphin Llama3',
};

const HeaderModel: React.FC<HeaderModelProps> = ({
  currentModel,
  customLLM,
  onModelChange,
  onSettingsClick,
  uncensoredMode,
  uncensoredModel,
  useCustomLLM,
  vramGB
}) => (
  <div className="header-model">
    {uncensoredMode ? (
      <div className="model-selector locked">
        <div className="model-selector-row">
          <button type="button" className="model-nav-btn" disabled title="Previous model" aria-label="Previous model">◀</button>
          <button className="model-selector-button" type="button" title="Turn off Uncensored Mode to switch models">
            <div className="model-selector-current">
              <span className="model-icon">🦙</span>
              <span className="model-name-display">
                {UNCENSORED_MODEL_LABELS[uncensoredModel] || uncensoredModel.split(':')[0].charAt(0).toUpperCase() + uncensoredModel.split(':')[0].slice(1) + ' ' + (uncensoredModel.split(':')[1] || '')}
              </span>
              <span className="model-lock-badge">🔒</span>
              <span className="dropdown-arrow">▼</span>
            </div>
          </button>
          <button type="button" className="model-nav-btn" disabled title="Next model" aria-label="Next model">▶</button>
        </div>
        <div className="model-lock-hint">Turn off 🔓 Uncensored Mode to switch models</div>
      </div>
    ) : onModelChange ? (
      <ModelSelector
        currentModel={currentModel}
        customLLM={customLLM}
        useCustomLLM={useCustomLLM}
        onModelChange={onModelChange}
        onConfigureCustom={onSettingsClick}
        locked={false}
        vramGB={vramGB}
      />
    ) : null}
  </div>
);

const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ mode, onModeChange }) => {
  if (!onModeChange) {
    return null;
  }

  return (
    <div className="mode-switcher">
      <button className={`mode-btn ${mode === 'dashboard' ? 'active' : ''}`} onClick={() => onModeChange('dashboard')} title="Dashboard">📊 Home</button>
      <button className={`mode-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => onModeChange('chat')} title="Chat Mode">💬 Chat</button>
      <button className={`mode-btn ${mode === 'automation' ? 'active' : ''}`} onClick={() => onModeChange('automation')} title="Automation Mode">🛠 Automation</button>
      <button className={`mode-btn ${mode === 'image' ? 'active' : ''}`} onClick={() => onModeChange('image')} title="Image Mode">🎨 Image</button>
      <button className={`mode-btn ${mode === 'documents' ? 'active' : ''}`} onClick={() => onModeChange('documents')} title="Document Viewer">📄 Docs</button>
      <button className={`mode-btn ${mode === 'web' ? 'active' : ''}`} onClick={() => onModeChange('web')} title="Web Services">🌐 Web</button>
      <button className={`mode-btn ${mode === 'quiz' ? 'active' : ''}`} onClick={() => onModeChange('quiz')} title="Learn to Code">🧠 Quiz</button>
    </div>
  );
};

const HeaderActions: React.FC<HeaderActionsProps> = ({
  notificationCount,
  onAnalyticsClick,
  onNotificationsClick,
  onRagClick,
  onRefresh,
  onSettingsClick,
  onToolsClick
}) => (
  <div className="header-actions">
    <button
      onClick={() => {
        try { (window as any).homebotCapture?.log('[Renderer] Retry connection (header)'); } catch (e) {}
        onRefresh();
      }}
      className="header-btn"
      title="Refresh connection"
      aria-label="Refresh"
    >
      ↻
    </button>
    {onRagClick && <button onClick={onRagClick} className="header-btn" title="RAG index" aria-label="RAG index">📚</button>}
    {onToolsClick && <button onClick={onToolsClick} className="header-btn" title="Available tools" aria-label="View tools">🔧</button>}
    {onAnalyticsClick && <button onClick={onAnalyticsClick} className="header-btn" title="Analytics" aria-label="Analytics">📊</button>}
    {onNotificationsClick && (
      <button onClick={onNotificationsClick} className="header-btn notif-bell-btn" title="Notifications" aria-label="Notifications">
        🔔
        {notificationCount > 0 && <span className="notif-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
      </button>
    )}
    <button onClick={onSettingsClick} className="header-btn" title="Settings" aria-label="Settings">⚙️</button>
  </div>
);

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  connectionStatus,
  onRefresh,
  onSettingsClick,
<<<<<<< HEAD
  onMenuClick
  , backendDiagnostic, onCopyDiagnostic, onDismissDiagnostic,
  mode = 'chat',
  onModeChange
=======
  onMenuClick,
  onExportChat: _onExportChat,
  onToolsClick,
  onRagClick,
  onAnalyticsClick,
  onNotificationsClick,
  notificationCount = 0,
  backendDiagnostic,
  onCopyDiagnostic,
  onDismissDiagnostic,
  mode = 'chat',
  onModeChange,
  currentModel = 'qwen2.5:7b',
  customLLM,
  useCustomLLM = false,
  onModelChange,
  uncensoredModel = 'dolphin:7b',
  vramGB
>>>>>>> origin/main
}) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const [uncensoredMode, setUncensoredMode] = useState(true);

  // Load uncensored mode state on mount + listen for external changes
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
    const onExternalChange = (e: Event) => {
      setUncensoredMode((e as CustomEvent).detail);
    };
    window.addEventListener('homebot:uncensored-mode-changed', onExternalChange);
    return () => window.removeEventListener('homebot:uncensored-mode-changed', onExternalChange);
  }, []);

  const handleUncensoredToggle = async () => {
    const newValue = !uncensoredMode;
    setUncensoredMode(newValue);
    await (window as any).electron?.setUncensoredMode?.(newValue);
    window.dispatchEvent(new CustomEvent('homebot:uncensored-mode-changed', { detail: newValue }));
  };

  return (
    <div className="app-header">
      {/* ── Left: Brand + Status + Model ── */}
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
          <h1>HomeBot</h1>
        </div>

        <HeaderConnection connectionStatus={connectionStatus} />

        <HeaderModel
          currentModel={currentModel}
          customLLM={customLLM}
          onModelChange={onModelChange}
          onSettingsClick={onSettingsClick}
          uncensoredMode={uncensoredMode}
          uncensoredModel={uncensoredModel}
          useCustomLLM={useCustomLLM}
          vramGB={vramGB}
        />

        <UncensoredToggle uncensoredMode={uncensoredMode} onToggle={handleUncensoredToggle} />
      </div>

      <ModeSwitcher mode={mode} onModeChange={onModeChange} />

      <HeaderActions
        notificationCount={notificationCount}
        onAnalyticsClick={onAnalyticsClick}
        onNotificationsClick={onNotificationsClick}
        onRagClick={onRagClick}
        onRefresh={onRefresh}
        onSettingsClick={onSettingsClick}
        onToolsClick={onToolsClick}
      />

      {/* Backend offline banner — shown below header inline */}
      {connectionStatus.n8n === 'offline' && (
        <BackendBadge
          backendDiagnostic={backendDiagnostic}
          detailOpen={detailOpen}
          onCopyDiagnostic={onCopyDiagnostic}
          onDismissDiagnostic={onDismissDiagnostic}
          onRefresh={onRefresh}
          onToggleDetail={setDetailOpen}
        />
      )}
<<<<<<< HEAD
      <h1>✨ SADIE</h1>
      
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

        {/* Mode Switcher */}
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
          </div>
        )}
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

        .mode-switcher {
          display: flex;
          gap: 4px;
          background: #2A2A2A;
          border-radius: 6px;
          padding: 2px;
        }

        .mode-btn {
          background: transparent;
          border: none;
          color: #B4B4B4;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: all 150ms ease;
        }

        .mode-btn:hover {
          background: #333333;
          color: #ECECEC;
        }

        .mode-btn.active {
          background: #007ACC;
          color: #FFFFFF;
        }
      `}</style>
=======
>>>>>>> origin/main
    </div>
  );
}

export default StatusIndicator;
