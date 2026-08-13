import Icon from './Icon';
import React, { useState, useEffect, useRef } from 'react';
import { OverlayPortal, anchoredStyle, useAnchoredPosition, useDismissOnOutside } from './anchoredOverlay';
import Tooltip from './Tooltip';
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
  onTerminalClick?: () => void;
  onWorkspaceClick?: () => void;
  onAnalyticsClick?: () => void;
  onNotificationsClick?: () => void;
  notificationCount?: number;
  backendDiagnostic?: string | null;
  onCopyDiagnostic?: (text: string) => void;
  onDismissDiagnostic?: () => void;
  mode?: 'chat' | 'automation' | 'image' | 'documents' | 'quiz' | 'dashboard' | 'media' | 'browser';
  onModeChange?: (mode: 'chat' | 'automation' | 'image' | 'documents' | 'quiz' | 'dashboard' | 'media' | 'browser') => void;
  currentModel?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  onModelChange?: (model: string, useCustom: boolean, provider?: string) => void;
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
  onModelChange?: (model: string, useCustom: boolean, provider?: string) => void;
  onSettingsClick: () => void;
  uncensoredMode: boolean;
  uncensoredModel: string;
  useCustomLLM: boolean;
  vramGB?: number | null;
}

interface ModeSwitcherProps {
  mode: 'chat' | 'automation' | 'image' | 'documents' | 'quiz' | 'dashboard' | 'media' | 'browser';
  onModeChange?: (mode: 'chat' | 'automation' | 'image' | 'documents' | 'quiz' | 'dashboard' | 'media' | 'browser') => void;
}

interface HeaderActionsProps {
  notificationCount: number;
  onAnalyticsClick?: () => void;
  onNotificationsClick?: () => void;
  onRagClick?: () => void;
  onTerminalClick?: () => void;
  onWorkspaceClick?: () => void;
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
}) => {
  // The diagnostic panel is portalled out of the header. It has to be: the
  // badge sits at `bottom: -24px` inside .app-header, which is overflow:hidden,
  // and the panel was another 60px below that — measured at 320x55 with 0px
  // visible. Nobody could ever read it. That is the worst possible place for
  // this bug, since this panel only appears when something is already broken.
  const detailRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const pos = useAnchoredPosition(detailRef, popRef, detailOpen, 'bottom', [backendDiagnostic]);
  useDismissOnOutside(detailOpen, () => onToggleDetail(false), [popRef, detailRef]);

  return (
    <div className="backend-badge" title="Automations are offline — HomeBot will answer on this PC instead">
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
            ref={detailRef}
            type="button"
            className="backend-detail"
            onClick={() => onToggleDetail(!detailOpen)}
            aria-expanded={detailOpen}
            aria-label="Show technical details"
          >
            ⋯
          </button>
          {detailOpen && (
            <OverlayPortal>
              <div
                ref={popRef}
                className="backend-popover"
                role="dialog"
                aria-label="HomeBot backend diagnostic"
                style={anchoredStyle(pos)}
              >
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
            </OverlayPortal>
          )}
        </>
      )}
    </div>
  );
};

interface OllamaBadgeProps {
  onRefresh: () => void;
}

/**
 * Persistent header badge shown when Ollama drops mid-session. Mirrors the n8n
 * BackendBadge but adds an inline "Start Ollama" action (via the existing
 * homebot:start-ollama IPC) so an idle disconnect is recoverable in-place
 * instead of only surfacing after the next message fails.
 */
const OllamaBadge: React.FC<OllamaBadgeProps> = ({ onRefresh }) => {
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<'idle' | 'done' | 'failed'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const handleStart = async () => {
    setStarting(true);
    setResult('idle');
    setErrMsg('');
    try {
      const res = await (window as any).electron?.startOllama?.();
      if (res?.success) {
        setResult('done');
        onRefresh();
      } else {
        setResult('failed');
        setErrMsg(res?.error || 'Failed to start Ollama');
      }
    } catch (e: any) {
      setResult('failed');
      setErrMsg(e?.message || 'Failed to start Ollama');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="backend-badge ollama-badge" role="alert" title="The AI on this PC is not running">
      <span className="backend-text">{result === 'done' ? 'Ollama starting…' : 'Ollama offline'}</span>
      <button
        type="button"
        className="backend-detail ollama-start"
        onClick={handleStart}
        disabled={starting || result === 'done'}
        aria-label="Start Ollama"
      >
        {starting ? 'Starting…' : '▶ Start'}
      </button>
      <button
        type="button"
        className="backend-retry"
        onClick={() => {
          try { (window as any).homebotCapture?.log('[Renderer] Retry connection (ollama badge)'); } catch (e) {}
          onRefresh();
        }}
        aria-label="Retry connection"
      >
        ↻
      </button>
      {result === 'failed' && errMsg && (
        <span className="ollama-badge-error" role="status">{errMsg}</span>
      )}
    </div>
  );
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
      <Tooltip content="Overview of what HomeBot can do right now" placement="bottom">
        <button className={`mode-btn ${mode === 'dashboard' ? 'active' : ''}`} onClick={() => onModeChange('dashboard')}>📊 Home</button>
      </Tooltip>
      <Tooltip content="Talk to the AI" placement="bottom">
        <button className={`mode-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => onModeChange('chat')}>💬 Chat</button>
      </Tooltip>
      <Tooltip content="Build tasks HomeBot can repeat for you" placement="bottom">
        <button className={`mode-btn ${mode === 'automation' ? 'active' : ''}`} onClick={() => onModeChange('automation')}>🛠 Automation</button>
      </Tooltip>
      <Tooltip content="Generate pictures from a description" placement="bottom">
        <button className={`mode-btn ${mode === 'image' ? 'active' : ''}`} onClick={() => onModeChange('image')}>🎨 Image</button>
      </Tooltip>
      <Tooltip content="Read your files and ask questions about them" placement="bottom">
        <button className={`mode-btn ${mode === 'documents' ? 'active' : ''}`} onClick={() => onModeChange('documents')}>📄 Docs</button>
      </Tooltip>
      <Tooltip content="Practise coding with questions generated for you" placement="bottom">
        <button className={`mode-btn ${mode === 'quiz' ? 'active' : ''}`} onClick={() => onModeChange('quiz')}>🧠 Quiz</button>
      </Tooltip>
      <Tooltip content="Turn a script into a narrated video" placement="bottom">
        <button className={`mode-btn ${mode === 'media' ? 'active' : ''}`} onClick={() => onModeChange('media')}>🎬 Studio</button>
      </Tooltip>
      <Tooltip content="Browse the web inside HomeBot" placement="bottom">
        <button className={`mode-btn ${mode === 'browser' ? 'active' : ''}`} onClick={() => onModeChange('browser')}>🌐 Browser</button>
      </Tooltip>
    </div>
  );
};

const HeaderActions: React.FC<HeaderActionsProps> = ({
  notificationCount,
  onAnalyticsClick,
  onNotificationsClick,
  onRagClick,
  onTerminalClick,
  onWorkspaceClick,
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
      <Icon name="refresh" />
    </button>
    {onRagClick && <button onClick={onRagClick} className="header-btn" title="RAG index" aria-label="RAG index"><Icon name="library" /></button>}
    {onToolsClick && <button onClick={onToolsClick} className="header-btn" title="Available tools" aria-label="View tools"><Icon name="tools" /></button>}
    {onWorkspaceClick && <button onClick={onWorkspaceClick} className="header-btn" title="Workspace — files, editor and terminal" aria-label="Workspace"><Icon name="dashboard" /></button>}
    {onTerminalClick && <button onClick={onTerminalClick} className="header-btn" title="Terminal" aria-label="Terminal"><Icon name="terminal" /></button>}
    {onAnalyticsClick && <button onClick={onAnalyticsClick} className="header-btn" title="Analytics" aria-label="Analytics"><Icon name="analytics" /></button>}
    {onNotificationsClick && (
      <button onClick={onNotificationsClick} className="header-btn notif-bell-btn" title="Notifications" aria-label="Notifications">
        <Icon name="bell" />
        {notificationCount > 0 && <span className="notif-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
      </button>
    )}
    <button onClick={onSettingsClick} className="header-btn" title="Settings" aria-label="Settings"><Icon name="settings" /></button>
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
  onTerminalClick,
  onWorkspaceClick,
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
        onTerminalClick={onTerminalClick}
        onWorkspaceClick={onWorkspaceClick}
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

      {/* Ollama offline banner — proactive inline restart for mid-session drops */}
      {connectionStatus.ollama === 'offline' && <OllamaBadge onRefresh={onRefresh} />}
    </div>
  );
}

export default StatusIndicator;
