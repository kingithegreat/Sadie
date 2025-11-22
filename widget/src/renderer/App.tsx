import React, { useState, useEffect, useRef } from 'react';
import ChatInterface from './components/ChatInterface';
import ActionConfirmation from './components/ActionConfirmation';
import StatusIndicator from './components/StatusIndicator';
import SettingsPanel from './components/SettingsPanel';
import { ConnectionStatus, ImageAttachment, Message as SharedMessage } from '../shared/types';

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

  // Map of active stream subscriptions keyed by streamId. Each entry holds
  // unsubscribe functions for chunk, end and error listeners. This ensures
  // robust lifecycle management and allows cleanup on unmount.
  const streamSubsRef = useRef<Map<string, {
    chunkUnsub?: () => void;
    endUnsub?: () => void;
    errorUnsub?: () => void;
  }>>(new Map());

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    // Listen for IPC replies from main process
    const unsub = window.electron.onMessage?.(handleSadieReply);
    // Cleanup
    return () => { if (typeof unsub === 'function') unsub(); };
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
  const loadSettings = async () => {
    try {
      const loadedSettings = await window.electron.getSettings();
      setSettings(loadedSettings);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

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
  const handleSendMessage = (message: string, imageOrImages?: any | null) => {
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
    const assistantId = `assistant-${Date.now()}`;
    const assistantPlaceholder: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streamingState: 'streaming'
    };

    setMessages(prev => [...prev, assistantPlaceholder]);

    // Subscribe to stream chunks for this request (filter by streamId)
    // Use per-stream subscription map to make lifecycle robust and easy to cleanup
    const streamId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `stream-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // store unsubscribers for this streamId
    const chunkUnsub = window.electron.onStreamChunk?.((data: any) => {
      if (!data || !data.chunk || data.streamId !== streamId) return;
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: (m.content || '') + data.chunk } : m));
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

    // Start streaming request via preload, include the assistantId so main can correlate
    const streamRequest: any = {
      user_id: 'desktop_user',
      conversation_id: conversationId,
      message,
      timestamp: new Date().toISOString(),
      streamId: assistantId
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

  // Optimistic cancellation requested by the user in the UI.
  const handleUserCancel = (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streamingState: 'cancelled' } : m));
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
