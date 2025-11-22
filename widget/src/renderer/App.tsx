import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { InputBox } from "./components/InputBox";
import { MessageList } from "./components/MessageList";
import { SettingsModal } from "./components/SettingsModal";
import type {
  ChatMessage,
  StreamingState,
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
  Settings
} from "./types";

// Types
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  error?: boolean;
  // streaming state: pending | streaming | finished | cancelled | error
  streamingState?: 'pending' | 'streaming' | 'finished' | 'cancelled' | 'error';
  image?: { filename?: string; url?: string; mimeType?: string } | null;
}

interface ToolCall {
  tool_name: string;
  parameters: Record<string, any>;
  reasoning?: string;
  confirmation_id?: string;
}

interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
}

type Status = ConnectionStatus;

interface AppProps {
  /** Optional initial messages for tests */
  initialMessages?: SharedMessage[];
}

const App: React.FC<AppProps> = ({ initialMessages }) => {
  // State
  const [messages, setMessages] = useState<SharedMessage[]>(initialMessages ?? []);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState<ToolCall | null>(null);
  const [pendingConfirmationData, setPendingConfirmationData] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    alwaysOnTop: true,
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space'
  });
  const [status, setStatus] = useState<Status>({ n8n: 'checking', ollama: 'checking' });
  const [conversationId] = useState<string>('default');

    // active stream subscriptions by streamId
    const subsRef = useRef<Record<
      string,
      { unsubscribe: () => void }
    >>({});

  // Load settings on boot
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const loaded = await window.electron.getSettings();
        if (mounted && loaded) setSettings({ ...DEFAULT_SETTINGS, ...loaded });
      } catch (err) {
        console.error("Failed to load settings", err);
      } finally {
        if (mounted) setIsHydrated(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Ensure we clean up any remaining stream listeners when the component
  // unmounts to avoid memory leaks.
  useEffect(() => {
    return () => {
      for (const subs of streamSubsRef.current.values()) {
        try { if (typeof subs.chunkUnsub === 'function') subs.chunkUnsub(); } catch (e) {}
        try { if (typeof subs.endUnsub === 'function') subs.endUnsub(); } catch (e) {}
        try { if (typeof subs.errorUnsub === 'function') subs.errorUnsub(); } catch (e) {}
      }
      streamSubsRef.current.clear();
    };
  }, []);

  /**
   * Load user settings from main process
   */
  const updateMessage = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages(prev => prev.map(m => (m.id === id ? fn(m) : m)));
  }, []);

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
  const saveSettings = async (newSettings: Settings) => {
    try {
      await window.electron.saveSettings(newSettings);
      setSettings(newSettings);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  /**
   * Handle reply from n8n orchestrator via IPC
   */
  const handleSadieReply = (response: any) => {
    // Check if response is an error
    if (response.error || !response.success) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.message || response.response || 'An error occurred.',
        timestamp: new Date().toISOString(),
        error: true
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
        role: 'assistant',
        content: `⛔ ${data.message}\n\nViolations: ${data.violations?.join(', ') || 'Unknown'}`,
        timestamp: new Date().toISOString(),
        error: true
      }]);
      return;
    }

    // Check if confirmation is needed
    if (data.status === 'needs_confirmation' || data.requires_confirmation) {
      setPendingToolCall(data.tool_call || null);
      setPendingConfirmationData(data);
      setAwaitingConfirmation(true);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message || 'This action requires your confirmation.',
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    // Normal response
    const assistantMessage = data.response || data.message || 'No response.';
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date().toISOString()
    }]);
  };

  /**
   * Send message to SADIE orchestrator
   */
  const unsubscribeStream = useCallback((streamId: string) => {
    const subs = subsRef.current;
    if (subs[streamId]) {
      try { subs[streamId].unsubscribe(); } catch {}
      delete subs[streamId];
    }
  }, []);

  const subscribeToStream = useCallback((streamId: string, assistantId: string) => {
    // prevent double subscription
    if (subsRef.current[streamId]) return;

    const unsubscribe = window.electron.subscribeToStream?.(streamId, {
      onStreamChunk: (payload: StreamChunkPayload) => {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id !== assistantId) return m;
            if (m.streamingState !== "streaming") return m; // ignore late chunks
            return {
              ...m,
              content: m.content + payload.chunk,
              updatedAt: Date.now(),
            };
          });
        });
      },
      onStreamEnd: (payload: StreamEndPayload) => {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id !== assistantId) return m;

            const cancelled = !!payload.cancelled;
            const nextState: StreamingState = cancelled ? "cancelled" : "finished";

            return {
              ...m,
              streamingState: nextState,
              updatedAt: Date.now(),
            };
          });
        });
        unsubscribeStream(streamId);
      },
      onStreamError: (payload: StreamErrorPayload) => {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id !== assistantId) return m;
            return {
              ...m,
              streamingState: "error",
              error: payload.error ?? "Stream error",
              updatedAt: Date.now(),
            };
          });
        });
        unsubscribeStream(streamId);
      },
    });

    subsRef.current[streamId] = { unsubscribe: (unsubscribe ?? (() => {})) as () => void };
  }, [unsubscribeStream]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    const userMsg: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };

    // Normalize images: support single image or array of images
    let images: Array<{ filename?: string; mimeType?: string; data?: string }> | undefined;
    if (Array.isArray(imageOrImages)) {
      images = imageOrImages.map((it: any) => ({ filename: it.filename, mimeType: it.mimeType, data: it.data }));
    } else if (imageOrImages) {
      images = [{ filename: imageOrImages.filename, mimeType: imageOrImages.mimeType, data: imageOrImages.data }];
    }

    // Append user message; include thumbnail info if available
    const userMsgWithImage: Message = images && images.length > 0
      ? { ...userMsg, image: { filename: images[0].filename, url: images[0].data ? `data:${images[0].mimeType};base64,${images[0].data}` : undefined, mimeType: images[0].mimeType } }
      : userMsg;
    setMessages(prev => [...prev, userMsgWithImage]);

    // Prepare assistant placeholder with streaming flag
    const userId = newId();
    const assistantId = newId(); // <- SINGLE ID USED FOR BOTH REQUEST + UI
    const assistantPlaceholder: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streamingState: 'streaming'
    };

    setMessages(prev => [...prev, assistantPlaceholder]);

    // subscribe first so we don't miss early chunks
    subscribeToStream(assistantId, assistantId);
    // Use per-stream subscription map to make lifecycle robust and easy to cleanup
    // Use a single stream identifier for both the message and the stream request so
    // incoming chunks are correlated properly (renderer must subscribe using the
    // same streamId that main receives).
    const streamId = assistantId;

    // store unsubscribers for this streamId
    const chunkUnsub = window.electron.onStreamChunk?.((data: any) => {
      if (!data || !data.chunk || data.streamId !== streamId) return;
      // Only append chunks while the assistant message is still in 'streaming' state.
      // This prevents racey situations where cancelled streams still receive
      // in-flight chunks from upstream which should be ignored by the UI.
      setMessages(prev => prev.map(m => {
        if (m.id !== assistantId) return m;
        if (m.streamingState !== 'streaming') return m;
        return { ...m, content: (m.content || '') + data.chunk };
      }));
    }) as (() => void) | undefined;

    const endUnsub = window.electron.onStreamEnd?.((data: any) => {
      if (!data || data.streamId !== streamId) return;
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streamingState: data.cancelled ? 'cancelled' : 'finished', timestamp: new Date().toISOString() } : m));
      // cleanup this stream's subscriptions
      const subs = streamSubsRef.current.get(streamId);
      if (subs) {
        try { if (typeof subs.chunkUnsub === 'function') subs.chunkUnsub(); } catch (e) {}
        try { if (typeof subs.endUnsub === 'function') subs.endUnsub(); } catch (e) {}
        try { if (typeof subs.errorUnsub === 'function') subs.errorUnsub(); } catch (e) {}
      }
      streamSubsRef.current.delete(streamId);
    }) as (() => void) | undefined;

    const errorUnsub = window.electron.onStreamError?.((err: any) => {
      if (!err || err.streamId !== streamId) return;
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streamingState: 'error', error: true, content: (m.content || '') + '\n\n[Stream error]' } : m));
      // cleanup this stream's subscriptions
      const subs = streamSubsRef.current.get(streamId);
      if (subs) {
        try { if (typeof subs.chunkUnsub === 'function') subs.chunkUnsub(); } catch (e) {}
        try { if (typeof subs.endUnsub === 'function') subs.endUnsub(); } catch (e) {}
        try { if (typeof subs.errorUnsub === 'function') subs.errorUnsub(); } catch (e) {}
      }
      streamSubsRef.current.delete(streamId);
    }) as (() => void) | undefined;

    // Start streaming request via preload; we include the SAME streamId so main can correlate
    try {
      await window.electron.sendStreamMessage({
        streamId: assistantId,
        text,
        settings,
      });
    } catch (err: any) {
      console.error(err);
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: "error",
        error: err?.message ?? "Failed to send",
      }));
      unsubscribeStream(assistantId);
    }
  }, [input, settings, subscribeToStream, unsubscribeStream, updateMessage]);

  const cancelStream = useCallback(async (assistantId: string) => {
    // optimistic cancel right away
    updateMessage(assistantId, m => ({
      ...m,
      streamingState: "cancelling",
    }));

    try {
      await window.electron.cancelStream(assistantId);
      // final authoritative state comes via onStreamEnd({cancelled:true})
      // but if upstream never responds, we still present cancelled
      updateMessage(assistantId, m => {
        if (m.streamingState !== "cancelling") return m;
        return { ...m, streamingState: "cancelled" };
      });
    } catch (err) {
      console.error("cancel error", err);
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: "error",
        error: "Cancel failed",
      }));
      unsubscribeStream(assistantId);
    }
  }, [unsubscribeStream, updateMessage]);
      user_id: 'desktop_user',
      conversation_id: conversationId,
      message,
      timestamp: new Date().toISOString(),
      streamId
    };
    if (images && images.length > 0) {
      // include images[] for multiple attachments
      streamRequest.images = images;
      // keep single-image compatibility for downstream/backends that expect `image`
      if (images.length === 1) streamRequest.image = images[0];
    }

    // register our per-stream subscribers under the assistantId so incoming events are correlated
    streamSubsRef.current.set(streamId, { chunkUnsub, endUnsub, errorUnsub });

    // tell main to start the stream; include our streamId so events are correlated
    window.electron.sendStreamMessage?.({ ...streamRequest, streamId } as any);
  };

  /**
   * Handle confirmation approval
   */
  const handleConfirmAction = () => {
    if (!pendingToolCall) return;

    // Send confirmation to orchestrator
    const confirmationMessage = `CONFIRM: ${pendingToolCall.tool_name}`;
    window.electron.sendMessage?.({ user_id: 'desktop_user', conversation_id: conversationId, message: confirmationMessage } as any);

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
      await window.electron.sendStreamMessage({
        streamId: assistantId,
        text: prevUser.content,
        settings,
      });
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
      try { if (typeof subs.chunkUnsub === 'function') subs.chunkUnsub(); } catch (e) {}
      try { if (typeof subs.endUnsub === 'function') subs.endUnsub(); } catch (e) {}
      try { if (typeof subs.errorUnsub === 'function') subs.errorUnsub(); } catch (e) {}
    }
    streamSubsRef.current.delete(id);
  };

  /**
   * Handle confirmation rejection
   */
  const handleRejectAction = () => {
    setMessages(prev => [...prev, {
      role: 'system',
      content: 'Action cancelled by user.',
      timestamp: new Date().toISOString()
    }]);

    setAwaitingConfirmation(false);
    setPendingToolCall(null);
    setPendingConfirmationData(null);
  };

  const canSend = useMemo(() => isHydrated && input.trim().length > 0, [isHydrated, input]);

  return (
    <div className="app-container">
      {/* Status Indicator */}
      <StatusIndicator connectionStatus={status} onRefresh={async () => { try { const c = await window.electron.checkConnection?.(); if (c) setStatus(c); } catch (e) { /* ignore */ } }} onSettingsClick={() => setSettingsOpen(true)} />

      {/* Settings Toggle Button */}
      <button 
        className="settings-toggle"
        onClick={() => setSettingsOpen(!settingsOpen)}
        title="Settings"
      >
        ⚙️
      </button>

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
    </div>
  );
};

export default App;
