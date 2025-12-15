import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debug as logDebug, info as logInfo, error as logError } from '../shared/logger';
import ChatInterface from "./components/ChatInterface";
import StatusIndicator from "./components/StatusIndicator";
import ActionConfirmation from "./components/ActionConfirmation";
import SettingsPanel from "./components/SettingsPanel";
import FirstRunModal from './components/FirstRunModal';
import PermissionModal from './components/PermissionModal';
import ConversationSidebar from "./components/ConversationSidebar";
import type {
  ChatMessage,
  StreamingState,
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
  Settings as ModelSettings
} from "./types";
import type {
  Message as SharedMessage,
  ConnectionStatus,
  ImageAttachment,
  DocumentAttachment,
  SadieRequestWithImages,
  Settings as SharedSettings,
  StoredConversation,
} from '../shared/types';

// Types
type Status = ConnectionStatus;

interface AppProps {
  /** Optional initial messages for tests */
  initialMessages?: SharedMessage[];
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
    // Test-only DOM cleanup: ensure previous test renders don't leave stale "Cancelled" badges
    if (process.env.NODE_ENV === 'test') {
      try {
        document.querySelectorAll('.status-text').forEach(el => {
          if (el.textContent?.toLowerCase().includes('cancelled')) {
            el.remove();
          }
        });
      } catch (e) {}
    }
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
  const [pendingToolCall, setPendingToolCall] = useState<any | null>(null);
  const [pendingConfirmationData, setPendingConfirmationData] = useState<any>(null);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [permissionRequestData, setPermissionRequestData] = useState<{ requestId?: string; missingPermissions?: string[]; reason?: string; streamId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settings, setSettings] = useState<SharedSettings>({
    alwaysOnTop: true,
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space'
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [status, setStatus] = useState<Status>({ n8n: 'checking', ollama: 'checking' });
  const [backendDiagnostic, setBackendDiagnostic] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Keep a ref to the latest messages for debug inspection during tests
  // This ref is used only by test instrumentation and is harmless in production.
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

    // active stream subscriptions by streamId (use Map for convenience)
    const streamSubsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    // test-only watchdog timers per stream to avoid hanging 'streaming' state in tests
    const streamWatchersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    // per-stream lifecycle state to make finalization idempotent and resilient to races
    interface StreamState {
      id: string;
      finalized: boolean;
      content: string[];
      startTime: number;
      lastChunkTime?: number;
    }
    const streamStatesRef = useRef<Map<string, StreamState>>(new Map());

  // Load settings and conversation on boot
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Load settings
        const loaded = await window.electron.getSettings();
        if (mounted && loaded) setSettings(prev => ({ ...prev, ...loaded }));
        
        // Load conversations from memory
        const convResult = await window.electron.loadConversations?.();
        if (mounted && convResult?.success && convResult.data) {
          const store = convResult.data;
          
          // If there's an active conversation, load it
          if (store.activeConversationId) {
            const convData = await window.electron.getConversation?.(store.activeConversationId);
            if (convData?.success && convData.data) {
              setConversationId(store.activeConversationId);
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
      console.log('[App] Confirmation request received:', data);
      setPendingConfirmationData({
        confirmationId: data.confirmationId,
        message: data.message,
        streamId: data.streamId
      });
      setAwaitingConfirmation(true);
    });

    const permUnsub = window.electron.onPermissionRequest?.((data) => {
      console.log('[App] Permission request received:', data);
      setPermissionRequestData({ requestId: data.requestId, missingPermissions: data.missingPermissions, reason: data.reason, streamId: data.streamId });
      setPermissionModalOpen(true);
    });
    
    return () => {
      unsubscribe?.();
      permUnsub?.();
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

  /**
   * Load user settings from main process
   */
  const updateMessage = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages(prev => prev.map(m => (m.id === id ? fn(m) : m)));
  }, []);

  // Helper to persist a message to the conversation store
  const persistMessage = useCallback(async (msg: ChatMessage) => {
    if (!conversationId) return;
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
      await window.electron.addMessage?.(conversationId, sharedMsg);
    } catch (err) {
      console.error('Failed to persist message:', err);
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

  const appendAssistantIfMissing = useCallback((assistantId: string) => {
    setMessages(prev => {
      if (prev.some(m => m.id === assistantId)) return prev;
      return [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          streamingState: "streaming",
          error: null,
          streamId: assistantId,
        }
      ];
    });
  }, []);

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
   * Handle creating a new conversation
   */
  const handleNewConversation = async () => {
    try {
      const result = await window.electron.createConversation?.();
      if (result?.success && result.data) {
        setConversationId(result.data.id);
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
  const handleSelectConversation = async (id: string) => {
    try {
      const convData = await window.electron.getConversation?.(id);
      if (convData?.success && convData.data) {
        setConversationId(id);
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
   * Handle reply from n8n orchestrator via IPC
   */
  const handleSadieReply = (response: any) => {
    // Check if response is an error
    if (response.error || !response.success) {
      setMessages(prev => [...prev, {
        id: newId(),
        role: 'assistant',
        content: response.message || response.response || 'An error occurred.',
        createdAt: Date.now(),
        error: response.message || 'error'
      }]);
      setStatus({ n8n: 'offline', ollama: 'offline' });
      return;
    }

    const data = response.data;

    // Update status (n8n is online if we got a response)
    setStatus({ n8n: 'online', ollama: 'online' });

    // Check if action is blocked
    if (data.status === 'blocked') {
      setMessages(prev => [...prev, {
        id: newId(),
        role: 'assistant',
        content: `⛔ ${data.message}\n\nViolations: ${data.violations?.join(', ') || 'Unknown'}`,
        createdAt: Date.now(),
        error: data.message || 'error'
      }]);
      return;
    }

    // Check if confirmation is needed
    if (data.status === 'needs_confirmation' || data.requires_confirmation) {
      setPendingToolCall(data.tool_call || null);
      setPendingConfirmationData(data);
      setAwaitingConfirmation(true);
      
      setMessages(prev => [...prev, {
        id: newId(),
        role: 'assistant',
        content: data.message || 'This action requires your confirmation.',
        createdAt: Date.now(),
        error: null
      }]);
      return;
    }

    // Normal response
    const assistantMessage = data.response || data.message || 'No response.';
    setMessages(prev => [...prev, {
      id: newId(),
      role: 'assistant',
      content: assistantMessage,
      createdAt: Date.now(),
      error: null
    }]);
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

  // --- STREAM LIFECYCLE PATCH START ---
  // --- STREAM LIFECYCLE (clean, production-first) ---
  const subscribeToStream = useCallback((streamId: string, assistantId?: string) => {
    // Initialize per-stream state for lifecycle management
    streamStatesRef.current.set(streamId, {
      id: streamId,
      finalized: false,
      content: [],
      startTime: Date.now()
    });

    // Finalizer: idempotent, authoritative update of message state
    const finalizeStream = (status: 'complete' | 'error' | 'cancelled', error?: string) => {
      const state = streamStatesRef.current.get(streamId);
      if (!state) return;
      if (state.finalized) return; // idempotent guard
      state.finalized = true;

      const finalContent = state.content.join('');

      // Update visible message state (authoritative)
      setMessages(prev => prev.map(msg => {
        if (msg.id !== streamId) return msg;
        const streamingState = status === 'complete' ? 'finished' : (status === 'cancelled' ? 'cancelled' : 'error');
        return {
          ...msg,
          content: error || finalContent || msg.content,
          streamingState,
          isStreaming: false,
          error: status === 'error' ? (error || msg.error) : null
        };
      }));

      // Persist final message if available (best-effort)
      try {
        (window as any).electron?.ipcRenderer?.invoke?.('persist-message', {
          id: streamId,
          content: error || finalContent,
          status: status === 'complete' ? 'done' : 'error'
        }).catch(() => {});
      } catch (e) { /* ignore */ }

      // Clear any test watchdog timer
      try {
        const t = streamWatchersRef.current.get(streamId);
        if (t) { clearTimeout(t); streamWatchersRef.current.delete(streamId); }
      } catch (e) {}

      // Clean up subscriptions map
      const subs = streamSubsRef.current.get(streamId) as { unsubscribe?: () => void } | undefined;
      if (subs && typeof subs.unsubscribe === 'function') {
        try { subs.unsubscribe(); } catch (e) {}
        streamSubsRef.current.delete(streamId);
      }

      // Remove internal state after a short delay to allow any late observers to read final state
      setTimeout(() => streamStatesRef.current.delete(streamId), 5000);

      // Test-only instrumentation: emit E2E events and debug logs
      if (process.env.NODE_ENV === 'test') {
        try { console.log(`[Stream ${streamId}] Finalized ${status}`); } catch (e) {}
        try {
          (window as any).__e2eEvents = (window as any).__e2eEvents || [];
          (window as any).__e2eEvents.push({ type: 'stream-finalized', streamId, status, timestamp: new Date().toISOString() });
        } catch (e) {}
      }
    };

    // Generic chunk handler (production)
    const onChunk = (chunk: string) => {
      const st = streamStatesRef.current.get(streamId);
      if (!st || st.finalized) return;
      st.lastChunkTime = Date.now();
      st.content.push(chunk);

      // Optimistically update UI
      setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: st.content.join(''), isStreaming: true } : m));
    };

    // Hook into IPC/preload APIs (best-effort, minimal compatibility)
    let legacyUnsub: (() => void) | undefined;
    try {
      legacyUnsub = window.electron?.subscribeToStream?.(streamId, {
        onStreamChunk: (p: any) => onChunk(p.chunk),
        onStreamEnd: (p: any) => finalizeStream(p?.cancelled ? 'cancelled' : 'complete'),
        onStreamError: (p: any) => finalizeStream('error', p?.error)
      }) as any;
    } catch (e) { /* ignore */ }

    // Attach IPC event listeners if available (preload or renderer-specific hooks)
    const unsubChunk = ((window as any).electron?.ipcRenderer?.onStreamChunk?.(streamId, onChunk) as any) ?? (() => {});
    const unsubEnd = ((window as any).electron?.ipcRenderer?.onStreamEnd?.(streamId, (d: any) => finalizeStream(d?.cancelled ? 'cancelled' : 'complete')) as any) ?? (() => {});
    const unsubError = ((window as any).electron?.ipcRenderer?.onStreamError?.(streamId, (err: any) => finalizeStream('error', err)) as any) ?? (() => {});

    // Compose single unsubscribe handler
    const unsubscribeAll = () => {
      try { unsubChunk(); } catch (e) {}
      try { unsubEnd(); } catch (e) {}
      try { unsubError(); } catch (e) {}
      try { if (legacyUnsub) legacyUnsub(); } catch (e) {}
    };

    streamSubsRef.current.set(streamId, { unsubscribe: unsubscribeAll });

    // Safety timeout to force-finalize hung streams
    const safety = setTimeout(() => {
      const st = streamStatesRef.current.get(streamId);
      if (st && !st.finalized) finalizeStream('error', 'Stream timeout');
    }, 60000);

    // If tests need to observe, install a test-only watchdog pointer
    if (process.env.NODE_ENV === 'test') {
      streamWatchersRef.current.set(streamId, safety);
      try { console.log(`[Stream ${streamId}] Initialized (test mode)`); } catch (e) {}
      try { (window as any).__e2eEvents = (window as any).__e2eEvents || []; (window as any).__e2eEvents.push({ type: 'stream-initialized', streamId, timestamp: new Date().toISOString() }); } catch (e) {}
    }

    // Return cleanup
    return () => {
      clearTimeout(safety);
      const s = streamSubsRef.current.get(streamId);
      if (s && typeof s.unsubscribe === 'function') {
        try { s.unsubscribe(); } catch (e) {}
        streamSubsRef.current.delete(streamId);
      }
    };
  }, []);
  // --- STREAM LIFECYCLE END ---

  // Handle sending a message and wiring up streaming lifecycle
  const handleSendMessage = useCallback(async (content?: string, images?: ImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = (content ?? '').toString().trim();
    if (!text && (!images || images.length === 0) && (!documents || documents.length === 0)) return;

    // If documents are attached, prepend info about them to the message
    let messageText = text;
    if (documents && documents.length > 0) {
      const docInfo = documents.map(d => `[Document attached: ${d.filename}]`).join('\n');
      messageText = docInfo + (text ? '\n\n' + text : '\n\nPlease analyze this document.');
    }

    // Add user message
    const userId = newId();
    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      content: messageText,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    
    // Persist user message
    persistMessage(userMsg);

    // Assistant placeholder
    const assistantId = newId();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streamingState: 'streaming'
    };
    setMessages(prev => [...prev, assistantPlaceholder]);
    
    // Persist assistant placeholder (will be updated when streaming completes)
    persistMessage(assistantPlaceholder);

    // subscribe to stream updates before sending to avoid lost chunks
    subscribeToStream(assistantId, assistantId);

    // Prepare stream request
    const streamRequest: (SadieRequestWithImages & { streamId?: string }) = {
      user_id: 'desktop_user',
      conversation_id: conversationId || 'default',
      message: messageText,
      timestamp: new Date().toISOString(),
    };
    if (images && images.length > 0) {
      streamRequest.images = images;
      if (images.length === 1) streamRequest.image = images[0];
    }
    if (documents && documents.length > 0) {
      streamRequest.documents = documents;
    }

    // register a single unsubscribe placeholder if subscribeToStream used the subscription
    // window.electron.subscribeToStream already stored an unsubscribe in streamSubsRef

    try {
      logDebug('[Renderer] Sending stream request', { streamId: assistantId, payload: streamRequest });
      try { (window as any).sadieCapture?.log(`[Renderer] Sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ ...streamRequest, streamId: assistantId });
      // Test-only watchdog: if no stream-end or stream-error arrives within timeout,
      // mark the stream as error so E2E tests don't hang indefinitely.
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
        streamingState: "error",
        error: err?.message ?? "Failed to send",
      }));
      // In test runs, expose a global flag so E2E harness can detect the error
      if (process.env.NODE_ENV === 'test') {
        try { (window as any).__sadie_error_received = true; (window as any).__sadie_error_event = err; } catch (e) {}
      }
      unsubscribeStream(assistantId);
    }
  }, [conversationId, subscribeToStream, unsubscribeStream, updateMessage, newId]);

  const cancelStream = useCallback((streamId: string) => {
    console.log(`[Stream ${streamId}] Cancel requested`);
    
    // Optimistically update UI
    setMessages(prev => prev.map(msg => {
      if (msg.id === streamId && msg.isStreaming) {
        return { 
          ...msg, 
          status: 'cancelling', // Intermediate state
          isStreaming: true // Keep true until we get confirmation
        };
      }
      return msg;
    }));

    // Request cancellation from main process
    try {
      (window as any).electron?.ipcRenderer?.sendStreamMessage?.('cancel', { streamId });
    } catch (e) {
      console.error('[Stream] cancel request failed', e);
    }

    // The finalizer will handle cleanup when onStreamEnd({cancelled:true}) arrives
    // Or the safety timeout will trigger if no end event comes
  }, []);

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
    }));

    subscribeToStream(assistantId, assistantId);

    try {
      logDebug('[Renderer] Retry sending stream request', { streamId: assistantId, message: prevUser.content });
      try { (window as any).sadieCapture?.log(`[Renderer] Retry sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ streamId: assistantId, user_id: 'desktop_user', conversation_id: conversationId || 'default', message: prevUser.content, timestamp: new Date().toISOString(), images: undefined });
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
    console.log(`[Stream ${id}] handleUserCancel: optimistic streamingState=cancelled`);

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

  // canSend is handled by child InputBox; the renderer only needs to know hydration state

  return (
    <div className="app-container">
      {/* Conversation Sidebar */}
      <ConversationSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Status Indicator / Header */}
      <StatusIndicator 
        connectionStatus={status} 
        onRefresh={async () => { try { const c = await window.electron.checkConnection?.(); if (c) { setStatus(c); if (c.n8n === 'online') setBackendDiagnostic(null); } } catch (e) { /* ignore */ } }} 
        onSettingsClick={() => setSettingsOpen(true)}
        onMenuClick={() => setSidebarOpen(true)}
        backendDiagnostic={backendDiagnostic}
        onCopyDiagnostic={async (text: string) => {
          try {
            await navigator.clipboard.writeText(text);
            // Optionally show a small in-chat system message
            setMessages(prev => [...prev, { id: newId(), role: 'system', content: 'Diagnostic copied to clipboard', createdAt: Date.now(), error: null }]);
          } catch (e) {
            console.error('Failed to copy diagnostic to clipboard:', e);
          }
        }}
        onDismissDiagnostic={() => setBackendDiagnostic(null)}
      />

      {/* Main Chat Interface */}
      <ChatInterface 
        messages={messages}
        onSendMessage={handleSendMessage}
        onUserCancel={handleUserCancel}
      />

      {/* Action Confirmation Modal */}
      {awaitingConfirmation && pendingConfirmationData && (
        <ActionConfirmation
          actionSummary={pendingConfirmationData.message || 'Confirm this action?'}
          warnings={pendingConfirmationData.warnings || []}
          onConfirm={handleConfirmAction}
          onReject={handleRejectAction}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Permission Modal (appears when main requests permission escalation) */}
      <PermissionModal open={permissionModalOpen} missingPermissions={permissionRequestData?.missingPermissions || []} reason={permissionRequestData?.reason} requestId={permissionRequestData?.requestId} onClose={() => { setPermissionModalOpen(false); setPermissionRequestData(null); }} />

      {firstRunOpen && (
        <FirstRunModal
          open={firstRunOpen}
          settings={settings as any}
          onSave={(s) => saveSettings(s as any)}
          onClose={() => setFirstRunOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
