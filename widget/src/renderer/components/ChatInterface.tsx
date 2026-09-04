
import { useState } from 'react';
import { debug as logDebug } from '../../shared/logger';
import MessageList from './MessageList';
import { InputBox } from './InputBox';
import SuggestedPrompts from './SuggestedPrompts';
import type { ChatMessage } from '../types';
import type { ImageAttachment as SharedImageAttachment, DocumentAttachment } from '../../shared/types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  onUserCancel?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onBookmark?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  /** Right-click a brainstormed idea → make it a Media Studio job. */
  onSendToMediaStudio?: (message: ChatMessage) => void;
  /** Optional per-conversation system prompt shown/edited in the chat header */
  systemPrompt?: string;
  onUpdateSystemPrompt?: (prompt: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onUserCancel, onRetry, onBookmark, onReact, onEdit, onSendToMediaStudio, systemPrompt, onUpdateSystemPrompt }) => {
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const hasGuidelines = !!(systemPrompt && systemPrompt.trim());

  const handleSend = (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = content?.trim?.() ?? '';
    logDebug('[Renderer] sendMessage invoked', { text, documents: documents?.length || 0 });
    try { (window as any).homebotCapture?.log(`[Renderer] sendMessage invoked msg=${text.substring(0,120)}`); } catch (e) {}
    onSendMessage(content, images, documents);
  };

  const handleSuggestedSelect = (prompt: string) => {
    // Send the suggested prompt directly
    onSendMessage(prompt);
  };
  return (
    <div className="chat-interface">
      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} onCancel={onUserCancel ?? (() => {})} onRetry={onRetry ?? (() => {})} onBookmark={onBookmark} onReact={onReact} onEdit={onEdit} onSendToMediaStudio={onSendToMediaStudio} />
      </div>

      {/* Suggested prompts when chat is empty */}
      {messages.length === 0 && (
        <SuggestedPrompts onSelect={handleSuggestedSelect} />
      )}

      {/* Fixed input box at bottom */}
      <div className="input-container">
        {/* Collapsible guidelines editor — above the input */}
        {guidelinesOpen && (
          <div className="conversation-system-prompt">
            <div className="system-prompt-controls">
              <textarea
                className="system-prompt-textarea"
                aria-label="Conversation system prompt"
                placeholder="Custom instructions for this conversation..."
                rows={2}
                value={systemPrompt ?? ''}
                onChange={(e) => onUpdateSystemPrompt?.(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="system-prompt-clear-btn"
                onClick={() => { onUpdateSystemPrompt?.(''); setGuidelinesOpen(false); }}
                title="Clear and close"
              >✕</button>
            </div>
          </div>
        )}
        <div className="input-wrapper">
          <InputBox onSendMessage={handleSend} />
          <button
            type="button"
            className={`guidelines-toggle-btn ${hasGuidelines ? 'has-content' : ''}`}
            onClick={() => setGuidelinesOpen(!guidelinesOpen)}
            title={guidelinesOpen ? 'Hide guidelines' : 'Set chat guidelines'}
          >
            {hasGuidelines ? '📝' : '📋'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
