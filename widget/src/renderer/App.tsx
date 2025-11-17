import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import ActionConfirmation from './components/ActionConfirmation';
import StatusIndicator from './components/StatusIndicator';
import SettingsPanel from './components/SettingsPanel';

// Types
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  error?: boolean;
  // streaming state: 'streaming' | 'done' | 'cancelled'
  streamingState?: 'streaming' | 'done' | 'cancelled';
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

interface Status {
  n8nOnline: boolean;
  ollamaOnline: boolean;
}

const App: React.FC = () => {
  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState<ToolCall | null>(null);
  const [pendingConfirmationData, setPendingConfirmationData] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    alwaysOnTop: true,
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space'
  });
  const [status, setStatus] = useState<Status>({
    n8nOnline: false,
    ollamaOnline: false
  });
  const [conversationId] = useState<string>('default');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    
    // Listen for IPC replies from main process
    const unsubscribe = window.electron.onMessage(handleSadieReply);
    
    // Cleanup
    return () => {
      unsubscribe();
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
      setStatus({ n8nOnline: false, ollamaOnline: false });
      return;
    }

    const data = response.data;

    // Update status (n8n is online if we got a response)
    setStatus({ n8nOnline: true, ollamaOnline: true });

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
    const unsubscribeChunk = window.electron.onStreamChunk((data: any) => {
      if (!data || !data.chunk || data.streamId !== assistantId) return;
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: (m.content || '') + data.chunk } : m));
    });

    const unsubscribeEnd = window.electron.onStreamEnd((data: any) => {
      if (!data || data.streamId !== assistantId) return;
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streamingState: data.cancelled ? 'cancelled' : 'done', timestamp: new Date().toISOString() } : m));
      unsubscribeChunk();
      unsubscribeEnd();
      unsubscribeError();
    });

    const unsubscribeError = window.electron.onStreamError((err: any) => {
      if (!err || err.streamId !== assistantId) return;
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streamingState: 'cancelled', error: true, content: (m.content || '') + '\n\n[Stream error]' } : m));
      unsubscribeChunk();
      unsubscribeEnd();
      unsubscribeError();
    });

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

    window.electron.sendStreamMessage(streamRequest as any);
  };

  /**
   * Handle confirmation approval
   */
  const handleConfirmAction = () => {
    if (!pendingToolCall) return;

    // Send confirmation to orchestrator
    const confirmationMessage = `CONFIRM: ${pendingToolCall.tool_name}`;
    window.electron.sendMessage(confirmationMessage, conversationId);

    // Clear confirmation state
    setAwaitingConfirmation(false);
    setPendingToolCall(null);
    setPendingConfirmationData(null);
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
      <StatusIndicator status={status} />

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
