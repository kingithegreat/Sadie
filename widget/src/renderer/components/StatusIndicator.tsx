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
  mode?: 'chat' | 'automation' | 'image' | 'web' | 'documents' | 'quiz' | 'dashboard';
  onModeChange?: (mode: 'chat' | 'automation' | 'image' | 'web' | 'documents' | 'quiz' | 'dashboard') => void;
  currentModel?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  onModelChange?: (model: string, useCustom: boolean) => void;
  uncensoredModel?: string;
  vramGB?: number | null;
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
        try { (window as any).sadieCapture?.log('[Renderer] Retry connection (backend badge)'); } catch (e) {}
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
);

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
        try { (window as any).sadieCapture?.log('[Renderer] Retry connection (header)'); } catch (e) {}
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
  uncensoredModel = 'qwen2.5:7b',
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
          <img src={sadieLogoUrl} alt="HomeBot" className="header-logo" />
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
    </div>
  );
}

export default StatusIndicator;
