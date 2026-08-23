import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import UpdateBanner from './components/UpdateBanner';
import { debug as logDebug } from '../shared/logger';
import { chatIdeaToJobInput } from '../shared/chat-idea';
import ChatInterface from "./components/ChatInterface";
import StatusIndicator from "./components/StatusIndicator";
import ActionConfirmation from "./components/ActionConfirmation";
import PermissionModal from './components/PermissionModal';
import { ToastContainer, useToasts } from './components/ToastContainer';
import ModelSelector from './components/ModelSelector';
import Logo from './components/Logo';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-load panels that aren't visible on first render
const ToolsPanel = lazy(() => import("./components/ToolsPanel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const FirstRunModal = lazy(() => import('./components/FirstRunModal'));
const ConversationSidebar = lazy(() => import("./components/ConversationSidebar"));
const AutomationCenter = lazy(() => import("./components/AutomationCenter").then(m => ({ default: m.AutomationCenter })));
const ImageGenerator = lazy(() => import("./components/ImageGenerator"));
const DocumentViewer = lazy(() => import("./components/DocumentViewer"));
const QuizPanel = lazy(() => import("./components/QuizPanel"));
const MediaStudioPanel = lazy(() => import("./components/MediaStudioPanel"));
const BrowserPanel = lazy(() => import("./components/workspace/BrowserPanel"));
const TokenCounter = lazy(() => import("./components/TokenCounter"));
const RagPanel = lazy(() => import("./components/RagPanel"));
const TerminalPanel = lazy(() => import("./components/TerminalPanel"));
const WorkspaceShell = lazy(() => import("./components/workspace/WorkspaceShell"));
const TelemetryDashboard = lazy(() => import("./components/TelemetryDashboard"));
const ShortcutsPanel = lazy(() => import("./components/ShortcutsPanel"));
const NotificationHistory = lazy(() => import("./components/NotificationHistory"));
const DashboardPanel = lazy(() => import("./components/DashboardPanel"));
const VoiceConversation = lazy(() => import("./components/VoiceConversation"));
import type {
  ChatMessage,
  StreamingState
} from "./types";
import type {
  Message as SharedMessage,
  ConnectionStatus,
  ImageAttachment,
  DocumentAttachment,
  HomeBotRequestWithImages,
  Settings as SharedSettings
} from '../shared/types';
import { recommendLocalModelForTask } from '../shared/model-advisor';
import { resolveTheme, followsSystem, systemPrefersDark } from '../shared/theme';
import type { ResolvedTheme } from '../shared/theme';
import type { ModelRecommendation } from '../shared/model-advisor';

// Types
type Status = ConnectionStatus;
// The mode list lives in shared/modes.ts so main can validate against the same
// one. It was written to be the single source of truth and this file had been
// restating it, which is how the two could have drifted.
import type { AppMode } from '../shared/modes';

interface AppProps {
  /** Optional initial messages for tests */
  initialMessages?: SharedMessage[];
}

interface PendingModelSuggestion {
  text: string;
  messageText: string;
  images?: ImageAttachment[] | null;
  documents?: DocumentAttachment[] | null;
  recommendation: ModelRecommendation;
}

const App: React.FC<AppProps> = ({ initialMessages }) => {
  // small helper to create ids
  const newId = useCallback(() => `id-${Date.now()}-${Math.random().toString(16).slice(2,8)}`, []);

  // Diagnostic log for E2E traces
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      window.electron?.getEnv?.().then(env => console.log('[DIAG] Env from main:', env)).catch(console.error);
    }
    // Capture: renderer started
    try { (window as any).homebotCapture?.log('[Renderer] started'); } catch (e) {}
  }, []);

  // State
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!initialMessages || !initialMessages.length) return [];
    // convert shared messages into renderer ChatMessage shape
    return initialMessages.map((m) => ({
      id: m.id ?? newId(),
      role: m.role as any,
      content: m.content,
      createdAt: Date.parse(m.timestamp) || Date.now(),
      updatedAt: undefined,
      streamId: (m as any).streamId,
      streamingState: (m.streamingState as any) || undefined,
      error: typeof (m as any).error === 'string' ? (m as any).error : ((m as any).error ? 'error' : null),
    }));
  });
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [, setPendingToolCall] = useState<any | null>(null);
  const [pendingConfirmationData, setPendingConfirmationData] = useState<any>(null);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [permissionRequestData, setPermissionRequestData] = useState<{ requestId?: string; missingPermissions?: string[]; reason?: string; streamId?: string; timeoutMs?: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ragPanelOpen, setRagPanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notifHistoryOpen, setNotifHistoryOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [widgetMode, setWidgetMode] = useState(true); // Start in widget mode
  const [uncensoredMode, setUncensoredMode] = useState(true);
  const { toasts, addToast, dismissToast, history: notifHistory, clearHistory: clearNotifHistory } = useToasts();
  const ollamaToastRef = useRef<string | null>(null);

  // Initialise widget mode from main process and listen for changes
  useEffect(() => {
    window.electron?.getWidgetMode?.().then(isWidget => setWidgetMode(isWidget));
    const unsub = window.electron?.onWidgetModeChanged?.(isWidget => setWidgetMode(isWidget));
    return () => { unsub?.(); };
  }, []);

  // Track uncensored mode for widget-mode model selector
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
    const onChanged = (e: Event) => setUncensoredMode((e as CustomEvent).detail);
    window.addEventListener('homebot:uncensored-mode-changed', onChanged);
    return () => window.removeEventListener('homebot:uncensored-mode-changed', onChanged);
  }, []);

  const handleToggleWidgetMode = useCallback(async () => {
    const newMode = await window.electron?.toggleWidgetMode?.();
    if (typeof newMode === 'boolean') setWidgetMode(newMode);
  }, []);

  const newConversationRef = useRef<() => void>(() => {});

  // The shortcut handler below is registered once, with [] deps, so it closes
  // over the first render's empty `messages` forever. A ref is how the other
  // shortcuts in that handler already reach current state.
  const lastAssistantRef = useRef<string>('');
  useEffect(() => {
    lastAssistantRef.current = messages
      .filter(m => m.role === 'assistant' && m.streamingState === 'finished')
      .slice(-1)[0]?.content || '';
  }, [messages]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        newConversationRef.current();
      } else if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSidebarOpen(true);
      } else if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setMode('chat');
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setMode('automation');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setMode('image');
      } else if (e.ctrlKey && e.key === '4') {
        e.preventDefault();
        setMode('documents');
      } else if (e.ctrlKey && e.key === '5') {
        e.preventDefault();
        setMode('quiz');
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        setMode('dashboard');
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        // The Shortcuts panel has advertised "Ctrl + Shift + C — Copy last
        // response" while nothing in the app bound it: pressing it did nothing
        // at all, and left whatever was already on the clipboard in place, so
        // the next paste produced the wrong text.
        //
        // Both cases are tested because Caps Lock changes which one arrives.
        // Plain Ctrl+C is deliberately untouched — that is ordinary text copy.
        e.preventDefault();
        if (lastAssistantRef.current) {
          window.electron?.writeClipboard?.(lastAssistantRef.current);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Track which conversations have had a title generated to avoid duplicates
  const titleGeneratedRef = useRef<Set<string>>(new Set());
  const [settings, setSettings] = useState<SharedSettings>({
    alwaysOnTop: true,
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space'
  });
  const [isHydrated, setIsHydrated] = useState(false);
  // What the ROUTER says would answer right now — the header displays this,
  // never its own derivation. `settings.chatModel` as the header source is
  // how every lying-header bug happened: it shows the local fallback even
  // while cloud routing is active.
  const [activeModel, setActiveModel] = useState<{ source?: 'cloud' | 'local'; model?: string; reason?: string | null }>({});
  const [status, setStatus] = useState<Status>({ n8n: 'checking', ollama: 'checking' });
  const [backendDiagnostic, setBackendDiagnostic] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationSystemPrompt, setConversationSystemPrompt] = useState<string>('');
  const [mode, setMode] = useState<AppMode>('chat');
  // Context handed over when the assistant navigates somewhere — what the user
  // was talking about, so the destination opens ready rather than empty. Held
  // here rather than in each panel so a panel can start consuming it without
  // anything upstream changing.
  const [navContext, setNavContext] = useState<Record<string, unknown> | null>(null);
  const [vramGB, setVramGB] = useState<number | null>(null);

  // Keep the header's model in sync with the router's actual decision.
  // Re-asks after every settings change (all saves flow through setSettings)
  // and whenever uncensored mode flips — so the header can only lie if the
  // router itself does.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await (window as any).electron?.resolveActiveModel?.();
        if (!cancelled && r?.success) {
          setActiveModel({ source: r.source, model: r.model, reason: r.reason ?? null });
        }
      } catch { /* header falls back to settings-derived display */ }
    })();
    return () => { cancelled = true; };
  }, [settings, uncensoredMode]);
  const lastModelTipRef = useRef<string>('');
  const [pendingModelSuggestion, setPendingModelSuggestion] = useState<PendingModelSuggestion | null>(null);

    // active stream subscriptions by streamId (use Map for convenience)
    const streamSubsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    // test-only watchdog timers per stream to avoid hanging 'streaming' state in tests
    const streamWatchersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Resolve the theme SETTING ('dark' | 'light' | 'system') to the theme STATE
  // the UI renders. Held in state so the app root, <html> and <body> all carry
  // the same resolved value — previously the root div got the raw setting, so
  // on 'system' it read data-theme="system", which matches no stylesheet.
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(settings.theme, systemPrefersDark()),
  );

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(settings.theme, systemPrefersDark());
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
      document.body.setAttribute('data-theme', resolved);
    };
    apply();

    // Only when following the OS does the theme need a live listener. Without
    // this the app stayed on whatever the OS was at launch until settings
    // changed, which reads as "dark mode is broken".
    if (!followsSystem(settings.theme)) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // addEventListener is the modern API; addListener is kept as a fallback
    // for older Chromium runtimes, and either way we remove what we added.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    if (typeof (mq as any).addListener === 'function') {
      (mq as any).addListener(apply);
      return () => (mq as any).removeListener(apply);
    }
    return;
  }, [settings.theme]);

  // Load settings and conversation on boot
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Load settings and conversations in parallel for faster boot
        const [loaded, convResult] = await Promise.all([
          window.electron.getSettings(),
          window.electron.loadConversations?.(),
        ]);
        if (mounted && loaded) setSettings(prev => ({ ...prev, ...loaded }));
        // Check connection status on boot
        window.electron.checkConnection?.().then(c => {
          if (mounted && c) setStatus(c);
        }).catch(() => {});
        // Detect GPU VRAM for model size warnings
        window.electron.detectGpuVram?.().then(r => {
          if (mounted && r?.success && r.vramGB) setVramGB(r.vramGB);
        }).catch(() => {});
        if (mounted && convResult?.success && convResult.data) {
          // Always start with a fresh chat — history is accessible via the sidebar
          const newConv = await window.electron.createConversation?.();
          if (newConv?.success && newConv.data) {
            setConversationId(newConv.data.id);
            setConversationSystemPrompt(newConv.data.systemPrompt || '');
            try { await window.electron.setActiveConversation?.(newConv.data.id); } catch (e) {}
          }
        } else {
          // No conversations yet - create first one
          const newConv = await window.electron.createConversation?.();
          if (mounted && newConv?.success && newConv.data) {
            setConversationId(newConv.data.id);
          }
        }
      } catch (err) {
        console.error("Failed to load settings/conversations", err);
        // Fallback to a local-only conversation ID
        setConversationId('default');
      } finally {
        if (mounted) setIsHydrated(true);
      }
    })();
    return () => { mounted = false; };
  }, [newId, initialMessages]);

  // show first-run onboarding modal if enabled
  const [firstRunOpen, setFirstRunOpen] = useState(false);

  // "Skip setup" used to be a one-way door: the wizard never came back, and a
  // person who skipped before understanding what setup does had no path to it
  // except reinstalling. Settings raises this event to reopen it on demand.
  useEffect(() => {
    const reopen = () => setFirstRunOpen(true);
    window.addEventListener('homebot:reopen-first-run', reopen);
    return () => window.removeEventListener('homebot:reopen-first-run', reopen);
  }, []);

  useEffect(() => {
    if (isHydrated && settings?.firstRun) {
      logDebug('[Renderer] Opening first-run modal - isHydrated:', isHydrated, 'firstRun:', settings?.firstRun);
      try { (window as any).homebotCapture?.log('[Renderer] Opening first-run modal'); } catch (e) {}
      setFirstRunOpen(true);
    } else {
      logDebug('[Renderer] Not opening first-run modal - isHydrated:', isHydrated, 'firstRun:', settings?.firstRun);
      try { (window as any).homebotCapture?.log('[Renderer] Not opening first-run modal'); } catch (e) {}
    }
  }, [isHydrated, settings?.firstRun]);

  // Ensure we clean up any remaining stream listeners when the component
  // unmounts to avoid memory leaks.
  useEffect(() => {
    return () => {
      for (const subs of streamSubsRef.current.values()) {
        try { subs.unsubscribe(); } catch (e) {}
      }
      streamSubsRef.current.clear();
    };
  }, []);

  // Listen for confirmation requests from main process (dangerous operations)
  useEffect(() => {
    const unsubscribe = window.electron.onConfirmationRequest?.((data) => {
      setPendingConfirmationData({
        confirmationId: data.confirmationId,
        message: data.message,
        streamId: data.streamId
      });
      setAwaitingConfirmation(true);
    });

    const permUnsub = window.electron.onPermissionRequest?.((data) => {
      setPermissionRequestData({ requestId: data.requestId, missingPermissions: data.missingPermissions, reason: data.reason, streamId: data.streamId, timeoutMs: (data as any).timeoutMs });
      setPermissionModalOpen(true);
    });

    const reminderUnsub = window.electron.onReminderFired?.((data) => {
      setMessages(prev => [...prev, {
        id: `rem-${Date.now()}`,
        role: 'system' as const,
        content: `⏰ **Reminder:** ${data.message}`,
        createdAt: Date.now(),
        error: null,
      }]);
      if (settings.notificationsEnabled !== false) {
        const duration = settings.notificationDuration ?? 8000;
        addToast(`⏰ ${data.message}`, 'warning', duration);
      }
    });

    // Proactive morning briefing — appears as an assistant message on app launch
    const briefingUnsub = window.electron.onProactiveBriefing?.((data) => {
      setMessages(prev => [...prev, {
        id: `briefing-${Date.now()}`,
        role: 'assistant' as const,
        content: data.content,
        createdAt: Date.now(),
        error: null,
      }]);
    });

    // One-time toast when the main process auto-detects VRAM and applies a
    // hardware profile.
    //
    // This is one of the first things a new user ever sees, and it used to read
    // "GPU detected (NVIDIA GeForce RTX 2050): 4 GB VRAM — 4 GB model profile
    // applied automatically." Three pieces of vocabulary (GPU, VRAM, model
    // profile) and no answer to the only question the reader has, which is
    // whether they need to do anything. They do not — so say that.
    const hwUnsub = window.electron.onHardwareProfileApplied?.((data) => {
      const gpu = data.gpuName ? `Found your graphics card (${data.gpuName}). ` : '';
      addToast(
        `${gpu}HomeBot has set itself up to run well on this PC — nothing for you to do. You can change this in Settings.`,
        'info',
        10000
      );
    });

    // One-time toast when the main process finds an existing-but-corrupt
    // settings file and resets it to defaults (a timestamped backup of the
    // original file is kept alongside it for manual recovery).
    const configRecoveredUnsub = window.electron.onConfigRecovered?.((data) => {
      addToast(
        `⚠️ Your settings file was invalid and has been reset to defaults.${data.backupPath ? ' A backup of the original was saved for recovery.' : ''}`,
        'warning',
        0
      );
    });

    // The assistant taking the user to another panel. Chat is meant to be the
    // front door to everything, so when what someone wants lives in a panel the
    // model sends them there rather than describing where the button is.
    //
    // The payload is stashed before the mode changes so the destination renders
    // with context on its first paint rather than opening empty and filling in
    // a frame later.
    const navigateUnsub = window.electron.onNavigate?.((request) => {
      setNavContext(request.payload ?? null);
      setMode(request.mode);
      if (request.reason) {
        addToast(request.reason, 'info', 6000);
      }
    });

    // Subscribe to title updates pushed from main (keeps sidebar title in sync)
    const titleUnsub = window.electron.onTitleUpdated?.((data) => {
      // Dispatch a custom DOM event so ConversationSidebar can patch its local list
      window.dispatchEvent(new CustomEvent('homebot:title-updated', { detail: data }));
    });

    // Ollama health — show a warning banner if Ollama isn't reachable on startup
    const ollamaUnsub = window.electron.onOllamaStatus?.((data) => {
      if (!data.online) {
        if (ollamaToastRef.current) dismissToast(ollamaToastRef.current);
        // Was: "Ollama not running — start Ollama to use local models.
        // (http://...)" — a product name the user never chose, a raw URL they
        // cannot act on, and no way forward. The ▶ Start button already sits in
        // the header (OllamaBadge); point there.
        ollamaToastRef.current = addToast(
          'The AI on this PC isn’t running, so HomeBot can’t answer privately right now. Use the ▶ Start button at the top of the window to launch it.',
          'warning',
          0
        );
      } else if (ollamaToastRef.current) {
        dismissToast(ollamaToastRef.current);
        ollamaToastRef.current = null;
      }
      setStatus(prev => ({ ...prev, ollama: data.online ? 'online' : 'offline' }));
    });

    const modelFbUnsub = window.electron.onModelFallback?.((data) => {
      addToast(
        `Model "${data.from}" not installed — switched to "${data.to}"`,
        'warning',
        8000
      );
      setSettings(prev => ({ ...prev, chatModel: data.to }));
    });

    const compactUnsub = window.electron.onConversationCompacted?.((data) => {
      addToast(
        `Conversation auto-compacted: ${data.originalCount} messages archived down to ${data.compactedCount}`,
        'info',
        6000
      );
    });

    // Re-read settings after subscribing to catch any model fallback that fired before mount
    window.electron.getSettings?.().then(s => {
      if (s?.chatModel) setSettings(prev => ({ ...prev, chatModel: s.chatModel }));
    });

    return () => {
      unsubscribe?.();
      permUnsub?.();
      reminderUnsub?.();
      briefingUnsub?.();
      hwUnsub?.();
      configRecoveredUnsub?.();
      navigateUnsub?.();
      titleUnsub?.();
      ollamaUnsub?.();
      modelFbUnsub?.();
      compactUnsub?.();
    };
  }, []);

  // Removed: a listener for a 'homebot:capture-saved' DOM event that nothing in
  // the codebase has ever dispatched. Its comment said the event came "from
  // header (StatusIndicator)", and StatusIndicator has no such dispatch — the
  // capture-logs feature it belonged to has no UI at any point in the chain, so
  // the log bundle it was meant to announce cannot be produced from the app at
  // all. Deleted rather than wired: the listener alone was telling the next
  // reader that a feature exists, which cost this audit time to disprove.

  // Auto-generate conversation title after the first assistant reply finishes
  useEffect(() => {
    if (!conversationId) return;
    // Already generated for this conversation — skip
    if (titleGeneratedRef.current.has(conversationId)) return;

    const nonSystem = messages.filter(m => m.role !== 'system');
    const userMsgs = nonSystem.filter(m => m.role === 'user');
    const assistantMsgs = nonSystem.filter(m => m.role === 'assistant');

    // Trigger exactly once: first user + first assistant reply that has finished streaming
    if (userMsgs.length !== 1 || assistantMsgs.length !== 1) return;
    const assistant = assistantMsgs[0];
    if (assistant.streamingState && assistant.streamingState !== 'finished') return;
    if (!assistant.content || assistant.content.length < 10) return;

    titleGeneratedRef.current.add(conversationId);

    window.electron.generateTitle?.({
      conversationId,
      userMessage: userMsgs[0].content || '',
      assistantReply: assistant.content,
    }).catch(() => { /* best-effort, silent fail */ });
  }, [messages, conversationId]);

  /**
   * Load user settings from main process
   */
  const updateMessage = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages(prev => prev.map(m => (m.id === id ? fn(m) : m)));
  }, []);

  // Helper to persist a message to the conversation store
  // Accept an optional convIdOverride so callers can persist immediately after
  // creating a new conversation without relying on state propagation.
  const persistMessage = useCallback(async (msg: ChatMessage, convIdOverride?: string) => {
    const convId = convIdOverride || conversationId;
    if (!convId) return;
    try {
      // Map renderer StreamingState to shared type (exclude 'cancelling' which is renderer-only)
      const mappedStreamingState = msg.streamingState === 'cancelling' ? 'cancelled' : msg.streamingState;
      const sharedMsg: SharedMessage = {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.createdAt).toISOString(),
        streamingState: mappedStreamingState as SharedMessage['streamingState'],
        error: !!msg.error,
      };
      // Debug: log persistence attempt and result
      try { (window as any).__HOMEBOT_RENDERER_LOGS = (window as any).__HOMEBOT_RENDERER_LOGS || []; (window as any).__HOMEBOT_RENDERER_LOGS.push(`[Renderer] addMessage conv=${convId} id=${msg.id} len=${String(msg.content).length}`); } catch (e) {}
      const res = await window.electron.addMessage?.(convId, sharedMsg);
      try { (window as any).__HOMEBOT_RENDERER_LOGS.push(`[Renderer] addMessage result=${JSON.stringify(res)}`); } catch (e) {}
    } catch (err) {
      console.error('Failed to persist message:', err);
      try { (window as any).__HOMEBOT_RENDERER_LOGS.push(`[Renderer] addMessage error=${String(err)}`); } catch (e) {}
    }
  }, [conversationId]);

  // Helper to update a persisted message
  const updatePersistedMessage = useCallback(async (messageId: string, updates: Partial<SharedMessage>) => {
    if (!conversationId) return;
    try {
      await window.electron.updateMessage?.(conversationId, messageId, updates);
    } catch (err) {
      console.error('Failed to update persisted message:', err);
    }
  }, [conversationId]);


  /**
   * Save user settings to main process
   */
  const saveSettings = async (newSettings: SharedSettings) => {
    try {
      const updated = await window.electron.saveSettings(newSettings);
      setSettings(prev => ({ ...prev, ...updated }));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  /**
   * Update per-conversation system prompt and persist it
   */
  const updateConversationSystemPrompt = async (prompt: string) => {
    setConversationSystemPrompt(prompt);
    let convId = conversationId;
    if (!convId) {
      // If no active conversation, create one to persist the system prompt
      try {
        const result = await window.electron.createConversation?.();
        if (result?.success && result.data) {
          convId = result.data.id;
          setConversationId(convId);
          setConversationSystemPrompt(prompt); // Ensure local state has the prompt
          // Persist active conversation selection
          try { await window.electron.setActiveConversation?.(convId); } catch (e) {}
        }
      } catch (err) {
        console.error('Failed to create conversation for system prompt:', err);
        return;
      }
    }
    try {
      const conv = await window.electron.getConversation?.(convId!);
      const stored: import('../shared/types').StoredConversation = conv?.data || { id: convId!, title: 'Conversation', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      stored.systemPrompt = prompt;
      await window.electron.saveConversation?.(stored);
    } catch (err) {
      console.error('Failed to persist conversation system prompt:', err);
    }
  };

  /**
   * Handle creating a new conversation
   */
  const handleNewConversation = async () => {
    try {
      const result = await window.electron.createConversation?.();
      if (result?.success && result.data) {
        setConversationId(result.data.id);
        setConversationSystemPrompt(result.data.systemPrompt || '');
        setMessages([]);
        await window.electron.setActiveConversation?.(result.data.id);
        window.dispatchEvent(new CustomEvent('homebot:conversation-created', {
          detail: {
            ...result.data,
            messageCount: result.data.messages?.length || 0,
          }
        }));
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };
  newConversationRef.current = handleNewConversation;

  /**
   * Handle selecting a different conversation
   */
  const handleSelectConversation = async (id: string, scrollToMessageId?: string) => {
    try {
      const convData = await window.electron.getConversation?.(id);
      if (convData?.success && convData.data) {
        setConversationId(id);
        setConversationSystemPrompt(convData.data.systemPrompt || '');
        await window.electron.setActiveConversation?.(id);

        // Convert stored messages to ChatMessage format
        const loadedMsgs: ChatMessage[] = convData.data.messages.map((m: SharedMessage) => ({
          id: m.id ?? newId(),
          role: m.role as any,
          content: m.content,
          createdAt: Date.parse(m.timestamp) || Date.now(),
          streamingState: (m.streamingState as any) || undefined,
          error: typeof (m as any).error === 'string' ? (m as any).error : ((m as any).error ? 'error' : null),
        }));
        setMessages(loadedMsgs);

        // Scroll to the target message after render
        if (scrollToMessageId) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('search-flash');
                setTimeout(() => el.classList.remove('search-flash'), 2000);
              }
            }, 100);
          });
        }
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  /**
   * Handle deleting a conversation
   */
  const handleDeleteConversation = async (id: string) => {
    try {
      await window.electron.deleteConversation?.(id);
      
      // If we deleted the current conversation, create a new one
      if (id === conversationId) {
        await handleNewConversation();
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };


  /**
   * Send message to HomeBot orchestrator
   */
  const unsubscribeStream = useCallback((streamId: string) => {
    const subs = streamSubsRef.current.get(streamId);
    if (subs) {
      try { subs.unsubscribe(); } catch {}
      streamSubsRef.current.delete(streamId);
    }
  }, []);

  const subscribeToStream = useCallback((streamId: string, assistantId: string) => {
    // prevent double subscription
    if (streamSubsRef.current.has(streamId)) return;

    const unsubscribe = window.electron.subscribeToStream?.(streamId, {
      // payload may have an optional streamId coming from the main process listener
      onStreamChunk: (payload: { streamId?: string; chunk: string }) => {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id !== assistantId) return m;
            if (m.streamingState !== "streaming") return m; // ignore late chunks
            // If chunk starts with ___REPLACE___, replace the entire content
            // (used when tool JSON was partially streamed and needs to be cleaned)
            const replaceMarker = '\n___REPLACE___';
            if (payload.chunk.startsWith(replaceMarker)) {
              return {
                ...m,
                content: payload.chunk.slice(replaceMarker.length),
                updatedAt: Date.now(),
              };
            }
            return {
              ...m,
              content: m.content + payload.chunk,
              updatedAt: Date.now(),
            };
          });
        });
      },
      onStreamEnd: (payload: { streamId?: string; cancelled?: boolean; model?: string }) => {
        // Clear any test-only watchdog timer if set
        try {
          const t = streamWatchersRef.current.get(streamId);
          if (t) { clearTimeout(t); streamWatchersRef.current.delete(streamId); }
        } catch (e) {}
        setMessages(prev => {
          const updated = prev.map(m => {
            if (m.id !== assistantId) return m;

            const cancelled = !!payload.cancelled;
            const nextState: StreamingState = cancelled ? "cancelled" : "finished";
            const durationMs = Date.now() - m.createdAt;

            const updatedMsg = {
              ...m,
              streamingState: nextState,
              updatedAt: Date.now(),
              ...(nextState === "finished" ? { durationMs } : {}),
              ...(payload.model ? { model: payload.model } : {}),
            };
            
            // Persist the final message content
            if (conversationId) {
              updatePersistedMessage(assistantId, {
                content: updatedMsg.content,
                streamingState: nextState,
              });
            }
            
            return updatedMsg;
          });
          return updated;
        });
        unsubscribeStream(streamId);
        // E2E: record that stream-end was received
        try {
          (window as any).__e2eEvents = (window as any).__e2eEvents || [];
          (window as any).__e2eEvents.push('homebot:stream-end');
          if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received homebot:stream-end', payload);
        } catch (e) {}
      },
      onStreamError: (payload: { streamId?: string; error?: string; message?: string; recoveryHint?: any }) => {
        // Clear any test-only watchdog timer if set
        try {
          const t = streamWatchersRef.current.get(streamId);
          if (t) { clearTimeout(t); streamWatchersRef.current.delete(streamId); }
        } catch (e) {}
        // If the main process included diagnostics, log them and update status
        try {
          const diag = (payload as any)?.diagnostic;
          if (diag) {
            console.error(`[STREAM ERROR] url=${diag.url} error=${diag.errorText} n8nResponded=${diag.n8nResponded} httpStatus=${diag.httpStatus}`);
            try { (window as any).homebotCapture?.log(`[Renderer] STREAM ERROR url=${diag.url} status=${diag.httpStatus} n8nResponded=${diag.n8nResponded}`); } catch (e) {}
            try {
              setBackendDiagnostic(typeof diag === 'string' ? diag : JSON.stringify(diag, null, 2));
            } catch (e) { setBackendDiagnostic(String(diag)); }
            setStatus(prev => ({ ...prev, n8n: 'offline' }));
          }
        } catch (e) {}

        // Use the human-readable message from classifyError when available.
        //
        // It says "when available" and then did not use it: payload.message is
        // the RAW internal label — 'Upstream error (n8n unavailable)',
        // 'Streaming error' — which is what classifyError takes as INPUT, not
        // what it produces for a reader. Those strings have to keep their
        // product names because the classifier matches on them, so the friendly
        // text has to be preferred here instead.
        const errorText =
          payload.recoveryHint?.userMessage ||
          payload.message ||
          (typeof payload.error === 'string' ? payload.error : undefined) ||
          'Something went wrong.';

        setMessages(prev => {
          return prev.map(m => {
            if (m.id !== assistantId) return m;
            if (m.streamingState === 'finished' || m.streamingState === 'cancelled') return m;
            const updatedMsg = {
              ...m,
              streamingState: "error" as StreamingState,
              error: errorText,
              recoveryHint: payload.recoveryHint || null,
              updatedAt: Date.now(),
            };
            
            // Persist the error state
            if (conversationId) {
              updatePersistedMessage(assistantId, {
                content: updatedMsg.content,
                streamingState: "error",
                error: true,
              });
            }
            
            return updatedMsg;
          });
        });
        unsubscribeStream(streamId);
        // E2E: record that stream-error was received
        try {
          (window as any).__e2eEvents = (window as any).__e2eEvents || [];
          (window as any).__e2eEvents.push('homebot:stream-error');
          if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received homebot:stream-error', payload);
        } catch (e) {}
      },
    });

    streamSubsRef.current.set(streamId, { unsubscribe: (unsubscribe ?? (() => {})) as () => void });
  }, [unsubscribeStream, conversationId, updatePersistedMessage]);

  const dispatchMessage = useCallback(async (
    text: string,
    messageText: string,
    images?: ImageAttachment[] | null,
    documents?: DocumentAttachment[] | null,
    modelOverride?: string,
  ) => {
    if (!text && (!images || images.length === 0) && (!documents || documents.length === 0)) return;

    // Ensure we have an active conversation before persisting messages.
    // If none exists, create one and use its id for immediate persistence.
    let activeConvId = conversationId;
    if (!activeConvId) {
      try {
        const created = await window.electron.createConversation?.();
        if (created?.success && created.data) {
          activeConvId = created.data.id;
          setConversationId(activeConvId);
          setConversationSystemPrompt(created.data.systemPrompt || '');
          // Persist active conversation selection
          try { await window.electron.setActiveConversation?.(activeConvId); } catch (e) {}
        }
      } catch (e) {
        console.error('Failed to create conversation before send:', e);
      }
    }

    // Add user message
    const userId = newId();
    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      content: messageText,
      createdAt: Date.now(),
      ...(images && images.length > 0
        ? { images: images.map(img => ({ url: img.url || img.dataUrl || (img.data ? `data:${img.mimeType || 'image/png'};base64,${img.data}` : ''), filename: img.filename })).filter(i => i.url) }
        : {}),
    };
    setMessages(prev => [...prev, userMsg]);
    await persistMessage(userMsg, activeConvId ?? undefined);

    if (messages.length === 0 && (activeConvId || conversationId) && text) {
      const cleaned = text
        .replace(/^(what('?s| is| are| were)?|who('?s| is| are)?|how('?s| is| are| do| does)?|can you|could you|please|tell me|show me|give me|do you know|i want to know)\s+/i, '')
        .replace(/\bin the nba\b/i, 'NBA')
        .replace(/\btoday\b/i, 'today')
        .trim();
      const titleSource = cleaned || text;
      const autoTitle = titleSource.length > 45 ? titleSource.slice(0, 45).trimEnd() + '…' : titleSource;
      const finalTitle = autoTitle.charAt(0).toUpperCase() + autoTitle.slice(1);
      try {
        const convData = await window.electron.getConversation?.(activeConvId || conversationId || '');
        if (convData?.success && convData.data) {
          await (window as any).electron.saveConversation?.({
            ...convData.data,
            title: finalTitle,
          });
        }
      } catch (err) {
        console.error('Failed to auto-title conversation:', err);
      }
    }

    const assistantId = newId();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streamingState: 'streaming'
    };
    setMessages(prev => [...prev, assistantPlaceholder]);
    persistMessage(assistantPlaceholder, activeConvId ?? undefined);
    subscribeToStream(assistantId, assistantId);

    const streamRequest: (HomeBotRequestWithImages & { streamId?: string }) = {
      user_id: 'desktop_user',
      conversation_id: activeConvId || conversationId || 'default',
      message: messageText,
      timestamp: new Date().toISOString(),
      conversationPrompt: conversationSystemPrompt || undefined,
      modelOverride,
    };
    if (images && images.length > 0) {
      streamRequest.images = images;
      if (images.length === 1) streamRequest.image = images[0];
    }
    if (documents && documents.length > 0) {
      streamRequest.documents = documents;
    }

    try {
      logDebug('[Renderer] Sending stream request', { streamId: assistantId, payload: streamRequest });
      try { (window as any).homebotCapture?.log(`[Renderer] Sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ ...streamRequest, streamId: assistantId });
      if (process.env.NODE_ENV === 'test') {
        const timeoutMs = Number(process.env.HOMEBOT_E2E_PROBE_TIMEOUT_MS) || 6000;
        try {
          const t = setTimeout(() => {
            try { (window as any).__homebot_error_received = true; (window as any).__homebot_error_event = { error: 'probe_timeout', streamId: assistantId }; } catch (e) {}
            updateMessage(assistantId, m => ({ ...m, streamingState: 'error' as StreamingState, error: 'Upstream error (probe timeout)' }));
            unsubscribeStream(assistantId);
          }, timeoutMs);
          streamWatchersRef.current.set(assistantId, t);
        } catch (e) {}
      }
    } catch (err: any) {
      console.error(err);
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: 'error',
        error: err?.message ?? 'Failed to send',
      }));
      if (process.env.NODE_ENV === 'test') {
        try { (window as any).__homebot_error_received = true; (window as any).__homebot_error_event = err; } catch (e) {}
      }
      unsubscribeStream(assistantId);
    }
  }, [conversationId, conversationSystemPrompt, messages.length, newId, persistMessage, subscribeToStream, unsubscribeStream, updateMessage]);

  const handleSendMessage = useCallback(async (content: string, images?: ImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = content?.trim() ?? '';
    if (!text && (!images || images.length === 0) && (!documents || documents.length === 0)) return;

    let messageText = text;
    if (documents && documents.length > 0) {
      const docInfo = documents.map(d => `[Document attached: ${d.filename}]`).join('\n');
      messageText = docInfo + (text ? '\n\n' + text : '\n\nPlease analyze this document.');
    }

    let modelOverride: string | undefined;
    if (!settings.useCustomLLM) {
      try {
        const res = await window.electron?.listOllamaModels?.();
        if (res?.success) {
          const modelRoutingMode = settings.modelRoutingMode || 'prompt';
          const recommendation = recommendLocalModelForTask({
            message: text || messageText,
            installedModels: (res.models || []).map((model: { name: string }) => model.name),
            chatModel: settings.chatModel,
            codeModel: settings.codeModel,
            visionModel: settings.visionModel,
            hasImages: !!images?.length,
            hasDocuments: !!documents?.length,
          });
          if (recommendation && modelRoutingMode !== 'off') {
            if (modelRoutingMode === 'auto') {
              modelOverride = recommendation.recommendedModel;
            } else if (modelRoutingMode === 'prompt') {
              setPendingModelSuggestion({
                text,
                messageText,
                images,
                documents,
                recommendation,
              });
              return;
            }

            const tipKey = `${recommendation.task}:${recommendation.currentModel}:${recommendation.recommendedModel}`;
            if (lastModelTipRef.current !== tipKey) {
              lastModelTipRef.current = tipKey;
              addToast(
                modelRoutingMode === 'auto'
                  ? `Auto-switching this ${recommendation.task} request to ${recommendation.recommendedModel} instead of ${recommendation.currentModel}. ${recommendation.reason}`
                  : `Suggested for this ${recommendation.task} request: ${recommendation.recommendedModel} instead of ${recommendation.currentModel}. ${recommendation.reason}`,
                'info',
                8000,
              );
            }
          }
        }
      } catch {
        // Keep the request moving even if model inventory lookup fails.
      }
    }
    await dispatchMessage(text, messageText, images, documents, modelOverride);
  }, [addToast, dispatchMessage, settings.chatModel, settings.codeModel, settings.modelRoutingMode, settings.useCustomLLM, settings.visionModel]);


  /**
   * Handle confirmation approval
   */
  const handleConfirmAction = () => {
    // Send confirmation response to main process
    if (pendingConfirmationData?.confirmationId) {
      window.electron.sendConfirmationResponse?.(pendingConfirmationData.confirmationId, true);
    }

    // Clear confirmation state
    setAwaitingConfirmation(false);
    setPendingToolCall(null);
    setPendingConfirmationData(null);
  };

  const handleConfirmModelSuggestion = useCallback(async () => {
    if (!pendingModelSuggestion) return;
    const pending = pendingModelSuggestion;
    setPendingModelSuggestion(null);
    const newModel = pending.recommendation.recommendedModel;
    const newSettings = { ...settings, chatModel: newModel, useCustomLLM: false };
    setSettings(newSettings);
    saveSettings(newSettings);
    await dispatchMessage(
      pending.text,
      pending.messageText,
      pending.images,
      pending.documents,
      newModel,
    );
  }, [dispatchMessage, pendingModelSuggestion, settings, saveSettings]);

  const retryMessage = useCallback(async (assistantId: string) => {
    const idx = messages.findIndex(m => m.id === assistantId);
    if (idx <= 0) return;
    const prevUser = messages[idx - 1];
    if (!prevUser || prevUser.role !== "user") return;
    const hasDocumentAttachmentMarker = /\[document attached:/i.test(prevUser.content);

    // reset assistant bubble
    updateMessage(assistantId, m => ({
      ...m,
      content: "",
      error: null,
      streamingState: "streaming",
      createdAt: Date.now(),
      durationMs: undefined,
    }));

    if (hasDocumentAttachmentMarker) {
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: "error",
        error: "Document attachments are not preserved for retries. Please reattach the document and send the request again.",
        recoveryHint: {
          service: 'unknown',
          userMessage: 'This request included a document attachment. Please reattach the document and send it again.',
          action: 'reattach-document',
          actionLabel: 'Reattach document',
        },
      }));
      return;
    }

    subscribeToStream(assistantId, assistantId);

    try {
      logDebug('[Renderer] Retry sending stream request', { streamId: assistantId, message: prevUser.content });
      try { (window as any).homebotCapture?.log(`[Renderer] Retry sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ streamId: assistantId, user_id: 'desktop_user', conversation_id: conversationId || 'default', message: prevUser.content, timestamp: new Date().toISOString(), images: undefined, retry: true });
    } catch (err: any) {
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: "error",
        error: err?.message ?? "Retry failed",
      }));
      unsubscribeStream(assistantId);
    }
  }, [messages, subscribeToStream, unsubscribeStream, updateMessage, conversationId]);

  // Optimistic cancellation requested by the user in the UI.
  const handleUserCancel = (id: string) => {
    // Optimistically mark message cancelled in UI
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streamingState: 'cancelled' } : m));

    // Also tear down our local subscription for this stream immediately so
    // in-flight chunks that still arrive won't be appended to the message.
    const subs = streamSubsRef.current.get(id);
    if (subs) {
      try { subs.unsubscribe(); } catch (e) {}
    }
    streamSubsRef.current.delete(id);
    // Tell main process to cancel the stream as well (best-effort)
    try { window.electron.cancelStream?.(id); } catch(e) { /* ignore */ }
  };

  // Toggle bookmark on a message
  const handleBookmark = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, bookmarked: !m.bookmarked } : m
    ));
  }, []);

  // Toggle reaction on a message
  const handleReact = useCallback((messageId: string, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      const reactions = { ...(m.reactions || {}) };
      reactions[emoji] = reactions[emoji] ? 0 : 1;
      return { ...m, reactions };
    }));
  }, []);

  // Edit a user message
  const handleEdit = useCallback((messageId: string, newContent: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: newContent, edited: true, updatedAt: Date.now() } : m
    ));
    // Persist the edit
    updatePersistedMessage(messageId, { content: newContent });
  }, [updatePersistedMessage]);

  // An idea brainstormed in chat becomes a Media Studio job, and the app
  // switches there so the creation is visible where the work will happen.
  const handleSendToMediaStudio = useCallback(async (message: ChatMessage) => {
    try {
      const input = chatIdeaToJobInput({ content: message.content || '', createdAt: message.createdAt });
      const res = await (window as any).electron?.mediaCreate?.(input);
      if (res && res.ok === false) {
        // A refusal the user cannot see is a click that did nothing.
        addToast(`Media Studio refused: ${res.error || 'unknown reason'}`, 'error');
        return;
      }
      setMode('media');
    } catch (e: any) {
      addToast('Could not create the video job.', 'error');
    }
  }, [addToast]);

  /**
   * Handle confirmation rejection
   */
  const handleRejectAction = () => {
    // Send rejection response to main process
    if (pendingConfirmationData?.confirmationId) {
      window.electron.sendConfirmationResponse?.(pendingConfirmationData.confirmationId, false);
    }

    setMessages(prev => [...prev, {
      id: newId(),
      role: 'system',
      content: 'Action cancelled by user.',
      createdAt: Date.now(),
      error: null
    }]);

    setAwaitingConfirmation(false);
    setPendingToolCall(null);
    setPendingConfirmationData(null);
  };

  const handleRejectModelSuggestion = useCallback(async () => {
    if (!pendingModelSuggestion) return;
    const pending = pendingModelSuggestion;
    setPendingModelSuggestion(null);
    await dispatchMessage(
      pending.text,
      pending.messageText,
      pending.images,
      pending.documents,
      undefined,
    );
  }, [dispatchMessage, pendingModelSuggestion]);

  // canSend is handled by child InputBox; the renderer only needs to know hydration state

  const modeClasses = [
    'app-container',
    widgetMode ? 'widget-mode' : 'expanded-mode',
  ].filter(Boolean).join(' ');

  return (
    <div className={modeClasses} data-testid="homebot-app-root" data-hydrated={isHydrated ? "true" : undefined} data-theme={resolvedTheme} data-density={settings.messageDensity || 'comfortable'}>
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Custom frameless titlebar — shown in widget mode */}
      {widgetMode && (
        <div className="widget-titlebar">
          <div className="widget-titlebar-brand">
            <Logo className="header-logo" size={22} />
            <span className={`widget-status-dot${status.ollama === 'offline' ? ' disconnected' : ''}`} />
            <h1>HomeBot</h1>
          </div>
          <div className="widget-model-selector">
            <ModelSelector
              currentModel={activeModel.model || settings.chatModel || 'qwen2.5:7b'}
              customLLM={settings.customLLM}
              useCustomLLM={settings.useCustomLLM}
              onModelChange={async (model: string, useCustom: boolean, provider?: string) => {
                // Cloud picks must carry their provider. Saving only the id left configs
                // like { provider: 'google-ai-studio', model: 'opus' } — Gemini's endpoint
                // asked for a Claude model, which fails and silently drops to local.
                // chatModel stays a LOCAL model for the same reason: it is the fallback,
                // and overwriting it with a cloud id leaves nothing valid to fall back to.
                const newSettings = {
                  ...settings,
                  ...(useCustom ? {} : { chatModel: model }),
                  useCustomLLM: useCustom,
                  // The switch must be SYMMETRIC. A cloud pick sets enabled: true; a local
                  // pick must set it back to false, because the router treats a still-
                  // enabled cloud config as 'use cloud' regardless of useCustomLLM. Without
                  // this, once any cloud model was ever picked, choosing Qwen in the header
                  // changed the label and nothing else — opus kept answering.
                  ...(settings.customLLM ? {
                    customLLM: useCustom
                      ? {
                          ...settings.customLLM,
                          model,
                          provider: (provider as typeof settings.customLLM.provider) || settings.customLLM.provider,
                          enabled: true,
                        }
                      : { ...settings.customLLM, enabled: false }
                  } : {}),
                };
                setSettings(newSettings);
                await saveSettings(newSettings);
                setMessages(prev => [...prev, {
                  id: newId(), role: 'system',
                  content: `Switched to ${useCustom ? `☁️ ${model}` : `🦙 ${model}`}`,
                  createdAt: Date.now(), error: null
                }]);
              }}
              onConfigureCustom={() => setSettingsOpen(true)}
              locked={uncensoredMode}
              lockedModelId={settings.uncensoredModel || 'dolphin-mistral:7b'}
              lockReason="Turn off 🔓 Uncensored Mode to switch models"
              vramGB={vramGB}
            />
          </div>
          <div className="widget-titlebar-controls">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >&#x2699;</button>
            <button
              type="button"
              onClick={() => window.electron?.minimizeWindow?.()}
              title="Minimize"
              aria-label="Minimize"
            >&#x2013;</button>
            <button
              type="button"
              className="expand-btn"
              onClick={handleToggleWidgetMode}
              title="Expand to full window"
              aria-label="Expand"
            >&#x26F6;</button>
            <button
              type="button"
              className="close-btn"
              onClick={() => window.electron?.closeWindow?.()}
              title="Close"
              aria-label="Close"
            >&#x2715;</button>
          </div>
        </div>
      )}

      {/* Expanded mode: custom titlebar with collapse button */}
      {!widgetMode && (
        <div className="widget-titlebar expanded-titlebar">
          <div className="widget-titlebar-brand">
            <Logo className="header-logo" size={22} />
            <span className={`widget-status-dot${status.ollama === 'offline' ? ' disconnected' : ''}`} />
            <h1>HomeBot</h1>
          </div>
          <div className="widget-titlebar-controls">
            <button
              type="button"
              className="expand-btn"
              onClick={handleToggleWidgetMode}
              title="Collapse to widget"
              aria-label="Collapse to widget"
            >&#x25A3;</button>
            <button
              type="button"
              onClick={() => window.electron?.minimizeWindow?.()}
              title="Minimize"
              aria-label="Minimize"
            >&#x2013;</button>
            <button
              type="button"
              onClick={() => window.electron?.maximizeWindow?.()}
              title="Maximize"
              aria-label="Maximize"
            >&#x25A1;</button>
            <button
              type="button"
              className="close-btn"
              onClick={() => window.electron?.closeWindow?.()}
              title="Close"
              aria-label="Close"
            >&#x2715;</button>
          </div>
        </div>
      )}

      {/* Conversation Sidebar */}
      <ErrorBoundary zone="Sidebar">
        <Suspense fallback={null}>
          <ConversationSidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            currentConversationId={conversationId}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
          />
        </Suspense>
      </ErrorBoundary>

      {/* Status Indicator / Header */}
      {/* Update notice — mounted above the header so it never covers chat. */}
      <UpdateBanner />

      <StatusIndicator 
        connectionStatus={status} 
        onRefresh={async () => { try { const c = await window.electron.checkConnection?.(); if (c) { setStatus(c); if (c.n8n === 'online') setBackendDiagnostic(null); } } catch (e) { /* ignore */ } }} 
        onSettingsClick={() => setSettingsOpen(true)}
        onToolsClick={() => setToolsOpen(true)}
        onRagClick={() => setRagPanelOpen(true)}
        onTerminalClick={() => setTerminalOpen(true)}
        onWorkspaceClick={() => setWorkspaceOpen(true)}
        onAnalyticsClick={() => setAnalyticsOpen(true)}
        onNotificationsClick={() => setNotifHistoryOpen(true)}
        notificationCount={notifHistory.length}
        onMenuClick={() => setSidebarOpen(true)}
        onExportChat={async () => {
          const lines: string[] = [`# HomeBot Chat Export\n_Exported: ${new Date().toLocaleString()}_\n`];
          for (const m of messages) {
            if (m.role === 'system') continue;
            const label = m.role === 'user' ? '**You**' : '**HomeBot**';
            const ts = new Date(m.createdAt).toLocaleTimeString();
            lines.push(`### ${label} — ${ts}\n${m.content}\n`);
          }
          const markdown = lines.join('\n---\n\n');
          const result = await window.electron.exportChat?.(markdown);
          setMessages(prev => [...prev, {
            id: newId(), role: 'system',
            content: result?.success ? `Chat exported to Desktop: ${result.path?.split(/[\\/]/).pop()}` : `Export failed: ${result?.error}`,
            createdAt: Date.now(), error: null
          }]);
        }}
        backendDiagnostic={backendDiagnostic}
        onCopyDiagnostic={(text: string) => {
          try {
            window.electron?.writeClipboard?.(text);
            setMessages(prev => [...prev, { id: newId(), role: 'system', content: 'Diagnostic copied to clipboard', createdAt: Date.now(), error: null }]);
          } catch (e) {
            console.error('Failed to copy diagnostic to clipboard:', e);
          }
        }}
        onDismissDiagnostic={() => setBackendDiagnostic(null)}
        mode={mode}
        onModeChange={setMode}
        currentModel={activeModel.model || settings.chatModel || 'qwen2.5:7b'}
        customLLM={settings.customLLM}
        useCustomLLM={settings.useCustomLLM}
        uncensoredModel={settings.uncensoredModel || 'dolphin-mistral:7b'}
        vramGB={vramGB}
        onModelChange={async (model: string, useCustom: boolean, provider?: string) => {
          // Cloud picks must carry their provider. Saving only the id left configs
          // like { provider: 'google-ai-studio', model: 'opus' } — Gemini's endpoint
          // asked for a Claude model, which fails and silently drops to local.
          // chatModel stays a LOCAL model for the same reason: it is the fallback,
          // and overwriting it with a cloud id leaves nothing valid to fall back to.
          const newSettings = {
            ...settings,
            ...(useCustom ? {} : { chatModel: model }),
            useCustomLLM: useCustom,
            // The switch must be SYMMETRIC. A cloud pick sets enabled: true; a local
            // pick must set it back to false, because the router treats a still-
            // enabled cloud config as 'use cloud' regardless of useCustomLLM. Without
            // this, once any cloud model was ever picked, choosing Qwen in the header
            // changed the label and nothing else — opus kept answering.
            ...(settings.customLLM ? {
              customLLM: useCustom
                ? {
                    ...settings.customLLM,
                    model,
                    provider: (provider as typeof settings.customLLM.provider) || settings.customLLM.provider,
                    enabled: true,
                  }
                : { ...settings.customLLM, enabled: false }
            } : {}),
          };
          setSettings(newSettings);
          await saveSettings(newSettings);
          setMessages(prev => [...prev, {
            id: newId(),
            role: 'system',
            content: `Switched to ${useCustom ? `☁️ ${model}` : `🦙 ${model}`}`,
            createdAt: Date.now(),
            error: null
          }]);
        }}
      />

      {/* Token counter — shown in chat mode */}
      {mode === 'chat' && (
        <div className="token-counter-bar">
          <Suspense fallback={null}>
            <TokenCounter messages={messages} model={settings.chatModel || 'qwen2.5:7b'} />
          </Suspense>
        </div>
      )}

      {/* Main Content Area */}
      {mode === 'dashboard' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <DashboardPanel
            onModeChange={(m: string) => setMode(m as AppMode)}
            onNewConversation={handleNewConversation}
          />
        </Suspense>
      ) : mode === 'chat' ? (
        <ErrorBoundary zone="Chat">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            onUserCancel={handleUserCancel}
            onRetry={retryMessage}
            onBookmark={handleBookmark}
            onReact={handleReact}
            onEdit={handleEdit}
            onSendToMediaStudio={handleSendToMediaStudio}
            systemPrompt={conversationSystemPrompt}
            onUpdateSystemPrompt={updateConversationSystemPrompt}
          />
        </ErrorBoundary>
      ) : mode === 'automation' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <AutomationCenter navContext={navContext} />
        </Suspense>
      ) : mode === 'image' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <ImageGenerator />
        </Suspense>
      ) : mode === 'documents' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <DocumentViewer onSendToChat={(filePath, content) => {
            try {
              const fileName = filePath.split(/[\\/]/).pop() || 'document';
              const ext = fileName.split('.').pop()?.toLowerCase() || 'txt';
              const mimeMap: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', json: 'application/json', md: 'text/markdown' };
              const bytes = new TextEncoder().encode(content);
              const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
              const doc: DocumentAttachment = {
                id: `doc-${Date.now()}`,
                filename: fileName,
                mimeType: mimeMap[ext] || 'text/plain',
                size: bytes.length,
                data: btoa(binary),
              };
              setMode('chat');
              setTimeout(() => {
                handleSendMessage(`I've attached "${fileName}". Please review this document.`, undefined, [doc]);
              }, 100);
            } catch (err) {
              console.error('[DocViewer] Failed to send to chat:', err);
            }
          }} />
        </Suspense>
      ) : mode === 'media' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <MediaStudioPanel />
        </Suspense>
      ) : mode === 'browser' ? (
        // The same panel the Workspace uses. It was reachable only by opening
        // the Workspace and finding an icon in its activity bar — two levels
        // deep, with nothing on the main screen suggesting a browser existed.
        // Closing it returns to chat rather than leaving a blank mode.
        // Wrapped: .browser-panel is styled for the Workspace GRID (grid-row: 1,
        // width clamped to ~34vw), so dropped into a mode it renders as a narrow
        // column in the corner. The wrapper gives it a full-size context.
        <div className="browser-mode">
          <Suspense fallback={<div className="mode-loading">Loading...</div>}>
            <BrowserPanel onClose={() => setMode('chat')} />
          </Suspense>
        </div>
      ) : (
        // Quiz is the final branch now. The Web Services panel used to be the
        // catch-all `else`, which meant any unrecognised mode silently rendered
        // it; quiz being terminal keeps the chain total without that surprise.
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <QuizPanel />
        </Suspense>
      )}

      {/* Action Confirmation Modal */}
      {awaitingConfirmation && pendingConfirmationData && (
        <ActionConfirmation
          actionSummary={pendingConfirmationData.message || 'Confirm this action?'}
          warnings={pendingConfirmationData.warnings || []}
          onConfirm={handleConfirmAction}
          onReject={handleRejectAction}
        />
      )}

      {pendingModelSuggestion && (
        <ActionConfirmation
          title="Suggest Better Model"
          message="HomeBot found a stronger local model for this one request."
          actionSummary={`Use ${pendingModelSuggestion.recommendation.recommendedModel} instead of ${pendingModelSuggestion.recommendation.currentModel} for this ${pendingModelSuggestion.recommendation.task} request?`}
          warnings={[pendingModelSuggestion.recommendation.reason]}
          confirmLabel="Use suggested model"
          rejectLabel="Keep current model"
          onConfirm={handleConfirmModelSuggestion}
          onReject={handleRejectModelSuggestion}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <ErrorBoundary zone="Settings">
          <Suspense fallback={null}>
            <SettingsPanel
              settings={settings}
              onSave={saveSettings}
              onClose={() => setSettingsOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Tools Panel */}
      {toolsOpen && <Suspense fallback={null}><ToolsPanel onClose={() => setToolsOpen(false)} /></Suspense>}

      {/* RAG Index Panel */}
      <Suspense fallback={null}>
        <RagPanel isOpen={ragPanelOpen} onClose={() => setRagPanelOpen(false)} />
      </Suspense>

      {/* Workspace — VS Code-shaped IDE: Explorer, tabbed editor, docked terminal */}
      {workspaceOpen && (
        <Suspense fallback={null}>
          <WorkspaceShell open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
        </Suspense>
      )}

      {/* Terminal — runs in the configured project folder, sandboxed to home */}
      {terminalOpen && (
        <Suspense fallback={null}>
          {/* onSendToChat is intentionally not wired yet: the chat input lives
              inside InputBox/ChatInterface, not App, so routing an excerpt into
              it needs a small lift of that state. The button hides itself until
              then rather than pretending to work. */}
          <TerminalPanel
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
            projectPath={settings?.projectPath}
          />
        </Suspense>
      )}

      {/* Analytics Dashboard */}
      {analyticsOpen && (
        <Suspense fallback={null}>
          <TelemetryDashboard open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />
        </Suspense>
      )}

      {/* Permission Modal (appears when main requests permission escalation) */}
      <PermissionModal open={permissionModalOpen} missingPermissions={permissionRequestData?.missingPermissions || []} reason={permissionRequestData?.reason} requestId={permissionRequestData?.requestId} timeoutMs={permissionRequestData?.timeoutMs} onClose={() => { setPermissionModalOpen(false); setPermissionRequestData(null); }} />

      {/* Keyboard Shortcuts Panel */}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}

      {/* Notification History */}
      {notifHistoryOpen && (
        <Suspense fallback={null}>
          <NotificationHistory open={notifHistoryOpen} onClose={() => setNotifHistoryOpen(false)} history={notifHistory} onClear={clearNotifHistory} />
        </Suspense>
      )}

      {/* Voice Conversation + Screen Capture floating buttons */}
      <div className="floating-feature-buttons">
        <button
          type="button"
          className="fab-btn fab-voice"
          onClick={() => setVoiceOpen(true)}
          title="Voice Conversation"
          aria-label="Voice conversation"
        >🎙</button>
        <button
          type="button"
          className="fab-btn fab-capture"
          onClick={async () => {
            try {
              const result = await window.electron.captureScreen?.();
              if (result?.success && result.dataUrl) {
                const img: import('../shared/types').ImageAttachment = {
                  filename: 'screenshot.png',
                  dataUrl: result.dataUrl,
                  url: result.dataUrl,
                  mimeType: 'image/png',
                };
                setMode('chat');
                handleSendMessage('What do you see on my screen? Describe and help with anything visible.', [img]);
              } else {
                addToast(result?.error || 'Screen capture failed', 'warning', 5000);
              }
            } catch (e: any) {
              addToast('Screen capture not available', 'warning', 5000);
            }
          }}
          title="Capture Screen"
          aria-label="Capture screen"
        >📸</button>
      </div>

      {/* Voice Conversation Panel */}
      <Suspense fallback={null}>
        <VoiceConversation
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onSendMessage={(text: string) => {
            setMode('chat');
            handleSendMessage(text);
          }}
          lastAssistantMessage={
            messages.filter(m => m.role === 'assistant' && m.streamingState === 'finished').slice(-1)[0]?.content
          }
        />
      </Suspense>

      {firstRunOpen && (
        <Suspense fallback={<div className="first-run-overlay"><div className="first-run-modal first-run-loading">Loading...</div></div>}>
          <FirstRunModal
            open={firstRunOpen}
            settings={settings as any}
            onSave={(s) => saveSettings(s as any)}
            onClose={() => setFirstRunOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
