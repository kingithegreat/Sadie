
import { debug as logDebug } from '../../shared/logger';
import MessageList from './MessageList';
import { InputBox } from './InputBox';
import type { ChatMessage } from '../types';
import type { ImageAttachment as SharedImageAttachment, DocumentAttachment } from '../../shared/types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  onUserCancel?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  /** Optional per-conversation system prompt shown/edited in the chat header */
  systemPrompt?: string;
  onUpdateSystemPrompt?: (prompt: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onUserCancel, onRetry, systemPrompt, onUpdateSystemPrompt }) => {
  const handleSend = (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = content?.trim?.() ?? '';
    logDebug('[Renderer] sendMessage invoked', { text, documents: documents?.length || 0 });
    try { (window as any).sadieCapture?.log(`[Renderer] sendMessage invoked msg=${text.substring(0,120)}`); } catch (e) {}
    const payload = { message: text, images, documents };
    logDebug('[Renderer] invoking sadie:sendMessage IPC', payload);
    try { (window as any).sadieCapture?.log(`[Renderer] invoking sadie:sendMessage IPC payloadPreview=${String(payload.message).substring(0,120)}`); } catch (e) {}
    const result = onSendMessage(content, images, documents);
    logDebug('[Renderer] IPC returned', { result });
    try { (window as any).sadieCapture?.log(`[Renderer] send invoked returned`); } catch (e) {}
    return result;
  };
  return (
    <div className="chat-interface">
      {/* Per-conversation system prompt editor (inline, above messages) */}
      <div className="conversation-system-prompt">
        <label className="system-prompt-label">Chat guidelines</label>
        <div className="system-prompt-controls">
          <textarea
            className="system-prompt-textarea"
            aria-label="Conversation system prompt"
            placeholder="Enter system / guideline text for this conversation (applies to model behavior)"
            value={systemPrompt ?? ''}
            onChange={(e) => onUpdateSystemPrompt?.(e.target.value)}
          />
          <button
            className="btn btn-sm"
            onClick={() => onUpdateSystemPrompt?.('')}
            title="Clear system prompt"
          >Clear</button>
        </div>
      </div>

      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} onCancel={onUserCancel ?? (() => {})} onRetry={onRetry ?? (() => {})} />
      </div>

      {/* Fixed input box at bottom */}
      <div className="input-container">
        <div className="input-wrapper">
          <InputBox onSendMessage={handleSend} />
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
