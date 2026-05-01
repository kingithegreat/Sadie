import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { debug as logDebug } from '../shared/logger';
import ChatInterface from "./components/ChatInterface";
import StatusIndicator from "./components/StatusIndicator";
import ActionConfirmation from "./components/ActionConfirmation";
import PermissionModal from './components/PermissionModal';
import { ToastContainer, useToasts } from './components/ToastContainer';
import ModelSelector from './components/ModelSelector';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-load panels that aren't visible on first render
const ToolsPanel = lazy(() => import("./components/ToolsPanel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const FirstRunModal = lazy(() => import('./components/FirstRunModal'));
const ConversationSidebar = lazy(() => import("./components/ConversationSidebar"));
const AutomationCenter = lazy(() => import("./components/AutomationCenter").then(m => ({ default: m.AutomationCenter })));
const ImageGenerator = lazy(() => import("./components/ImageGenerator"));
const WebServicesPanel = lazy(() => import("./components/WebServicesPanel"));
const DocumentViewer = lazy(() => import("./components/DocumentViewer"));
const TokenCounter = lazy(() => import("./components/TokenCounter"));
const RagPanel = lazy(() => import("./components/RagPanel"));
const TelemetryDashboard = lazy(() => import("./components/TelemetryDashboard"));
const ShortcutsPanel = lazy(() => import("./components/ShortcutsPanel"));
const NotificationHistory = lazy(() => import("./components/NotificationHistory"));
import type {
  ChatMessage,
  StreamingState
} from "./types";
import type {
  Message as SharedMessage,
  ConnectionStatus,
  ImageAttachment,
  DocumentAttachment,
  SadieRequestWithImages,
  Settings as SharedSettings
} from '../shared/types';
import { recommendLocalModelForTask } from '../shared/model-advisor';
import type { ModelRecommendation } from '../shared/model-advisor';

// Types
type Status = ConnectionStatus;
type AppMode = 'chat' | 'automation' | 'image' | 'web' | 'documents';

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
    try { (window as any).sadieCapture?.log('[Renderer] started'); } catch (e) {}
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
  const [permissionRequestData, setPermissionRequestData] = useState<{ requestId?: string; missingPermissions?: string[]; reason?: string; streamId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ragPanelOpen, setRagPanelOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notifHistoryOpen, setNotifHistoryOpen] = useState(false);
  const [widgetMode, setWidgetMode] = useState(true); // Start in widget mode
  const { toasts, addToast, dismissToast, history: notifHistory, clearHistory: clearNotifHistory } = useToasts();

  // Initialise widget mode from main process and listen for changes
  useEffect(() => {
    window.electron?.getWidgetMode?.().then(isWidget => setWidgetMode(isWidget));
    const unsub = window.electron?.onWidgetModeChanged?.(isWidget => setWidgetMode(isWidget));
    return () => { unsub?.(); };
  }, []);

  const handleToggleWidgetMode = useCallback(async () => {
    const newMode = await window.electron?.toggleWidgetMode?.();
    if (typeof newMode === 'boolean') setWidgetMode(newMode);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleNewConversation();
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
        setMode('image');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setMode('documents');
      } else if (e.ctrlKey && e.key === '4') {
        e.preventDefault();
        setMode('web');
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
  const [status, setStatus] = useState<Status>({ n8n: 'checking', ollama: 'checking' });
  const [backendDiagnostic, setBackendDiagnostic] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationSystemPrompt, setConversationSystemPrompt] = useState<string>('');
  const [mode, setMode] = useState<AppMode>('chat');
  const [vramGB, setVramGB] = useState<number | null>(null);
  const lastModelTipRef = useRef<string>('');
  const [pendingModelSuggestion, setPendingModelSuggestion] = useState<PendingModelSuggestion | null>(null);

    // active stream subscriptions by streamId (use Map for convenience)
    const streamSubsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    // test-only watchdog timers per stream to avoid hanging 'streaming' state in tests
    const streamWatchersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
        // Detect GPU VRAM for model size warnings
        window.electron.detectGpuVram?.().then(r => {
          if (mounted && r?.success && r.vramGB) setVramGB(r.vramGB);
        }).catch(() => {});
        if (mounted && convResult?.success && convResult.data) {
          const store = convResult.data;
          
          // If there's an active conversation, load it
          if (store.activeConversationId) {
            const convData = await window.electron.getConversation?.(store.activeConversationId);
            if (convData?.success && convData.data) {
              setConversationId(store.activeConversationId);
              // Hydrate the LLM's in-memory context so the first message after
              // a restart has full conversation history (not just the UI).
              try { await window.electron.setActiveConversation?.(store.activeConversationId); } catch (e) {}
              // Load per-conversation system prompt (if any)
              setConversationSystemPrompt(convData.data.systemPrompt || '');
              // Convert stored messages to ChatMessage format
              const loadedMsgs: ChatMessage[] = convData.data.messages.map((m: SharedMessage) => ({
                id: m.id ?? newId(),
                role: m.role as any,
                content: m.content,
                createdAt: Date.parse(m.timestamp) || Date.now(),
                streamingState: (m.streamingState as any) || undefined,
                error: typeof (m as any).error === 'string' ? (m as any).error : ((m as any).error ? 'error' : null),
              }));
              if (!initialMessages || initialMessages.length === 0) {
                setMessages(loadedMsgs);
              }
            }
          } else {
            // No active conversation - create a new one
            const newConv = await window.electron.createConversation?.();
            if (newConv?.success && newConv.data) {
              setConversationId(newConv.data.id);
              setConversationSystemPrompt(newConv.data.systemPrompt || '');
            }
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

  useEffect(() => {
    if (isHydrated && settings?.firstRun) {
      logDebug('[Renderer] Opening first-run modal - isHydrated:', isHydrated, 'firstRun:', settings?.firstRun);
      try { (window as any).sadieCapture?.log('[Renderer] Opening first-run modal'); } catch (e) {}
      setFirstRunOpen(true);
    } else {
      logDebug('[Renderer] Not opening first-run modal - isHydrated:', isHydrated, 'firstRun:', settings?.firstRun);
      try { (window as any).sadieCapture?.log('[Renderer] Not opening first-run modal'); } catch (e) {}
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
      setPermissionRequestData({ requestId: data.requestId, missingPermissions: data.missingPermissions, reason: data.reason, streamId: data.streamId });
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

    // One-time toast when the main process auto-detects VRAM and applies a hardware profile
    const hwUnsub = window.electron.onHardwareProfileApplied?.((data) => {
      const label = data.profile === '4gb' ? '4 GB' : data.profile === '8gb' ? '8 GB' : '16 GB+';
      const gpu = data.gpuName ? ` (${data.gpuName})` : '';
      addToast(`GPU detected${gpu}: ${data.vramGB} GB VRAM — ${label} model profile applied automatically.`, 'info', 10000);
    });

    // Subscribe to title updates pushed from main (keeps sidebar title in sync)
    const titleUnsub = window.electron.onTitleUpdated?.((data) => {
      // Dispatch a custom DOM event so ConversationSidebar can patch its local list
      window.dispatchEvent(new CustomEvent('sadie:title-updated', { detail: data }));
    });

    // Ollama health — show a warning banner if Ollama isn't reachable on startup
    const ollamaUnsub = window.electron.onOllamaStatus?.((data) => {
      if (!data.online) {
        addToast(
          `Ollama not running — start Ollama to use local models. (${data.url})`,
          'warning',
          0  // persistent until dismissed
        );
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
      hwUnsub?.();
      titleUnsub?.();
      ollamaUnsub?.();
      modelFbUnsub?.();
      compactUnsub?.();
    };
  }, []);

  // Listen for capture saved event from header (StatusIndicator)
  useEffect(() => {
    const onSaved = (e: Event) => {
      const detail: any = (e as CustomEvent)?.detail;
      if (detail?.path) {
        setMessages(prev => [...prev, { id: newId(), role: 'system', content: `Saved capture: ${detail.path}`, createdAt: Date.now(), error: null }]);
      }
    };
    window.addEventListener('sadie:capture-saved', onSaved as EventListener);
    return () => window.removeEventListener('sadie:capture-saved', onSaved as EventListener);
  }, [newId]);

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
      try { (window as any).__SADIE_RENDERER_LOGS = (window as any).__SADIE_RENDERER_LOGS || []; (window as any).__SADIE_RENDERER_LOGS.push(`[Renderer] addMessage conv=${convId} id=${msg.id} len=${String(msg.content).length}`); } catch (e) {}
      const res = await window.electron.addMessage?.(convId, sharedMsg);
      try { (window as any).__SADIE_RENDERER_LOGS.push(`[Renderer] addMessage result=${JSON.stringify(res)}`); } catch (e) {}
    } catch (err) {
      console.error('Failed to persist message:', err);
      try { (window as any).__SADIE_RENDERER_LOGS.push(`[Renderer] addMessage error=${String(err)}`); } catch (e) {}
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
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

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
   * Send message to SADIE orchestrator
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
      onStreamEnd: (payload: { streamId?: string; cancelled?: boolean }) => {
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
          (window as any).__e2eEvents.push('sadie:stream-end');
          if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received sadie:stream-end', payload);
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
            try { (window as any).sadieCapture?.log(`[Renderer] STREAM ERROR url=${diag.url} status=${diag.httpStatus} n8nResponded=${diag.n8nResponded}`); } catch (e) {}
            try {
              setBackendDiagnostic(typeof diag === 'string' ? diag : JSON.stringify(diag, null, 2));
            } catch (e) { setBackendDiagnostic(String(diag)); }
            setStatus(prev => ({ ...prev, n8n: 'offline' }));
          }
        } catch (e) {}

        // Use the human-readable message from classifyError when available
        const errorText = payload.message || (typeof payload.error === 'string' ? payload.error : undefined) || 'Stream error';

        setMessages(prev => {
          return prev.map(m => {
            if (m.id !== assistantId) return m;
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
          (window as any).__e2eEvents.push('sadie:stream-error');
          if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received sadie:stream-error', payload);
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

    const streamRequest: (SadieRequestWithImages & { streamId?: string }) = {
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
      try { (window as any).sadieCapture?.log(`[Renderer] Sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ ...streamRequest, streamId: assistantId });
      if (process.env.NODE_ENV === 'test') {
        const timeoutMs = Number(process.env.SADIE_E2E_PROBE_TIMEOUT_MS) || 6000;
        try {
          const t = setTimeout(() => {
            try { (window as any).__sadie_error_received = true; (window as any).__sadie_error_event = { error: 'probe_timeout', streamId: assistantId }; } catch (e) {}
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
        try { (window as any).__sadie_error_received = true; (window as any).__sadie_error_event = err; } catch (e) {}
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
    await dispatchMessage(
      pending.text,
      pending.messageText,
      pending.images,
      pending.documents,
      pending.recommendation.recommendedModel,
    );
  }, [dispatchMessage, pendingModelSuggestion]);

  const retryMessage = useCallback(async (assistantId: string) => {
    const idx = messages.findIndex(m => m.id === assistantId);
    if (idx <= 0) return;
    const prevUser = messages[idx - 1];
    if (!prevUser || prevUser.role !== "user") return;

    // reset assistant bubble
    updateMessage(assistantId, m => ({
      ...m,
      content: "",
      error: null,
      streamingState: "streaming",
      createdAt: Date.now(),
      durationMs: undefined,
    }));

    subscribeToStream(assistantId, assistantId);

    try {
      logDebug('[Renderer] Retry sending stream request', { streamId: assistantId, message: prevUser.content });
      try { (window as any).sadieCapture?.log(`[Renderer] Retry sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ streamId: assistantId, user_id: 'desktop_user', conversation_id: conversationId || 'default', message: prevUser.content, timestamp: new Date().toISOString(), images: undefined, retry: true });
    } catch (err: any) {
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: "error",
        error: err?.message ?? "Retry failed",
      }));
      unsubscribeStream(assistantId);
    }
  }, [messages, settings, subscribeToStream, unsubscribeStream, updateMessage]);

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
    <div className={modeClasses} data-testid="sadie-app-root" data-hydrated={isHydrated ? "true" : undefined} data-theme={settings.theme || 'dark'} data-density={settings.messageDensity || 'comfortable'}>
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Custom frameless titlebar — shown in widget mode */}
      {widgetMode && (
        <div className="widget-titlebar">
          <div className="widget-titlebar-brand">
            <span className={`widget-status-dot${status.ollama === 'offline' ? ' disconnected' : ''}`} />
            <h1>SADIE</h1>
          </div>
          <div className="widget-model-selector">
            <ModelSelector
              currentModel={settings.chatModel || 'qwen2.5:7b'}
              customLLM={settings.customLLM}
              useCustomLLM={settings.useCustomLLM}
              onModelChange={async (model: string, useCustom: boolean) => {
                const newSettings = {
                  ...settings,
                  chatModel: model,
                  useCustomLLM: useCustom,
                  ...(useCustom && settings.customLLM ? {
                    customLLM: { ...settings.customLLM, model }
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
              locked={false}
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
              className="expand-btn"
              onClick={handleToggleWidgetMode}
              title="Expand to full window"
              aria-label="Expand"
            >&#x26F6;</button>
            <button
              type="button"
              onClick={() => window.electron?.minimizeWindow?.()}
              title="Minimize"
              aria-label="Minimize"
            >&#x2013;</button>
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
            <span className="widget-status-dot" />
            <h1>SADIE</h1>
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
      <StatusIndicator 
        connectionStatus={status} 
        onRefresh={async () => { try { const c = await window.electron.checkConnection?.(); if (c) { setStatus(c); if (c.n8n === 'online') setBackendDiagnostic(null); } } catch (e) { /* ignore */ } }} 
        onSettingsClick={() => setSettingsOpen(true)}
        onToolsClick={() => setToolsOpen(true)}
        onRagClick={() => setRagPanelOpen(true)}
        onAnalyticsClick={() => setAnalyticsOpen(true)}
        onNotificationsClick={() => setNotifHistoryOpen(true)}
        notificationCount={notifHistory.length}
        onMenuClick={() => setSidebarOpen(true)}
        onExportChat={async () => {
          const lines: string[] = [`# SADIE Chat Export\n_Exported: ${new Date().toLocaleString()}_\n`];
          for (const m of messages) {
            if (m.role === 'system') continue;
            const label = m.role === 'user' ? '**You**' : '**SADIE**';
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
        currentModel={settings.chatModel || 'qwen2.5:7b'}
        customLLM={settings.customLLM}
        useCustomLLM={settings.useCustomLLM}
        uncensoredModel={settings.uncensoredModel || 'dolphin-llama3:8b'}
        vramGB={vramGB}
        onModelChange={async (model: string, useCustom: boolean) => {
          const newSettings = {
            ...settings,
            chatModel: model,
            useCustomLLM: useCustom,
            ...(useCustom && settings.customLLM ? {
              customLLM: { ...settings.customLLM, model }
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
            <TokenCounter messages={messages} model={settings.chatModel || 'llama3.2:3b'} />
          </Suspense>
        </div>
      )}

      {/* Main Content Area */}
      {mode === 'chat' ? (
        <ErrorBoundary zone="Chat">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            onUserCancel={handleUserCancel}
            onRetry={retryMessage}
            onBookmark={handleBookmark}
            onReact={handleReact}
            onEdit={handleEdit}
            systemPrompt={conversationSystemPrompt}
            onUpdateSystemPrompt={updateConversationSystemPrompt}
          />
        </ErrorBoundary>
      ) : mode === 'automation' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <AutomationCenter />
        </Suspense>
      ) : mode === 'image' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <ImageGenerator />
        </Suspense>
      ) : mode === 'documents' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <DocumentViewer />
        </Suspense>
      ) : (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <WebServicesPanel />
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
          message="SADIE found a stronger local model for this one request."
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

      {/* Analytics Dashboard */}
      {analyticsOpen && (
        <Suspense fallback={null}>
          <TelemetryDashboard open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />
        </Suspense>
      )}

      {/* Permission Modal (appears when main requests permission escalation) */}
      <PermissionModal open={permissionModalOpen} missingPermissions={permissionRequestData?.missingPermissions || []} reason={permissionRequestData?.reason} requestId={permissionRequestData?.requestId} onClose={() => { setPermissionModalOpen(false); setPermissionRequestData(null); }} />

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

      {firstRunOpen && (
        <Suspense fallback={null}>
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
