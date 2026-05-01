import React, { useState, useEffect } from 'react';
import { ConnectionStatus, CustomLLMConfig } from '../../shared/types';
import ModelSelector from './ModelSelector';
import sadieLogoUrl from '../assets/SadieLogoNerd.png';

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
  mode?: 'chat' | 'automation' | 'image' | 'web' | 'documents';
  onModeChange?: (mode: 'chat' | 'automation' | 'image' | 'web' | 'documents') => void;
  currentModel?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  onModelChange?: (model: string, useCustom: boolean) => void;
  uncensoredModel?: string;
  vramGB?: number | null;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  connectionStatus,
  onRefresh,
  onSettingsClick,
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
  uncensoredModel = 'dolphin-llama3:8b',
  vramGB
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
    window.dispatchEvent(new CustomEvent('sadie:uncensored-mode-changed', { detail: newValue }));
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
          <img src={sadieLogoUrl} alt="SADIE" className="header-logo" />
          <h1>SADIE</h1>
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
              vramGB={vramGB}
            />
          )}
        </div>

        <div
          className={`uncensored-toggle ${uncensoredMode ? 'active' : ''}`}
          onClick={handleUncensoredToggle}
          title={uncensoredMode ? 'Uncensored Mode ON — no system prompt, no tools' : 'Safe Mode - using selected model'}
        >
          <span className="toggle-icon">{uncensoredMode ? '🔓' : '🔒'}</span>
          <span className="toggle-label">{uncensoredMode ? 'Uncensored' : 'Safe'}</span>
        </div>
      </div>

      {/* ── Center: Mode switcher ── */}
      {onModeChange && (
        <div className="mode-switcher">
          <button className={`mode-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => onModeChange('chat')} title="Chat Mode">💬 Chat</button>
          <button className={`mode-btn ${mode === 'image' ? 'active' : ''}`} onClick={() => onModeChange('image')} title="Image Mode">🎨 Image</button>
          <button className={`mode-btn ${mode === 'documents' ? 'active' : ''}`} onClick={() => onModeChange('documents')} title="Document Viewer">📄 Docs</button>
          <button className={`mode-btn ${mode === 'web' ? 'active' : ''}`} onClick={() => onModeChange('web')} title="Web Services">🌐 Web</button>
        </div>
      )}

      {/* ── Right: Actions ── */}
      <div className="header-actions">
        <button onClick={() => { try { (window as any).sadieCapture?.log('[Renderer] Retry connection (header)'); } catch (e) {} ; onRefresh(); }} className="header-btn" title="Refresh connection" aria-label="Refresh">↻</button>
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

      {/* Backend offline banner — shown below header inline */}
      {connectionStatus.n8n === 'offline' && (
        <div className="backend-badge" title="SADIE backend (n8n) is offline">
          <span className="backend-text">Backend offline</span>
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

      <style>{`
      .backend-badge {
        background: var(--warning-muted, oklch(82% 0.14 85 / 0.12));
        color: var(--warning, oklch(82% 0.14 85));
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 500;
        -webkit-app-region: no-drag;
        display: inline-flex;
        gap: 6px;
        align-items: center;
        border: 1px solid oklch(82% 0.14 85 / 0.2);
        position: absolute;
        bottom: -24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 5;
        white-space: nowrap;
      }
      .backend-detail,
      .backend-retry {
        -webkit-appearance: none;
        border: none;
        background: transparent;
        color: var(--warning, oklch(82% 0.14 85));
        font-size: 14px;
        cursor: pointer;
        padding: 2px 6px;
      }
      .backend-retry:hover,
      .backend-detail:hover {
        opacity: 0.8;
      }

      .uncensored-toggle {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 9999px;
        background: oklch(100% 0 0 / 0.04);
        border: 1px solid oklch(100% 0 0 / 0.06);
        cursor: pointer;
        transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1);
        -webkit-app-region: no-drag;
        font-size: 11px;
        color: oklch(48% 0 0);
        flex-shrink: 0;
      }

      .uncensored-toggle:hover {
        background: oklch(100% 0 0 / 0.06);
        border-color: oklch(100% 0 0 / 0.10);
      }

      .uncensored-toggle.active {
        background: oklch(62% 0.2 25 / 0.10);
        border-color: oklch(62% 0.2 25 / 0.25);
        color: oklch(72% 0.15 25);
      }

      .uncensored-toggle .toggle-icon {
        font-size: 13px;
      }

      .uncensored-toggle .toggle-label {
        font-weight: 500;
      }

      .backend-popover {
        position: fixed;
        top: 60px;
        right: 16px;
        background: oklch(9% 0.005 78 / 0.95);
        -webkit-backdrop-filter: blur(24px);
        backdrop-filter: blur(24px);
        padding: 14px;
        border-radius: 12px;
        border: 1px solid oklch(100% 0 0 / 0.08);
        min-width: 320px;
        max-width: 520px;
        max-height: 40vh;
        overflow: auto;
        z-index: 9999;
        box-shadow: 0 12px 40px oklch(0% 0 0 / 0.5);
      }

      .backend-popover-text {
        font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
        font-size: 11px;
        color: oklch(80% 0 0);
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0 0 8px 0;
      }

      .backend-popover-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding-top: 8px;
        border-top: 1px solid oklch(100% 0 0 / 0.06);
      }
      `}</style>
    </div>
  );
}

export default StatusIndicator;
