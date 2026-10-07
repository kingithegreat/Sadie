
import { useLayoutEffect, useRef, useState } from 'react';
import { debug as logDebug } from '../../shared/logger';
import MessageList from './MessageList';
import { InputBox, type ComposerDraft, type ComposerAttachmentBatch,
  type ComposerAttachmentScope, type ComposerAttachmentDeliveryResult } from './InputBox';
import SuggestedPrompts from './SuggestedPrompts';
import type { ChatMessage } from '../types';
import type { ImageAttachment as SharedImageAttachment, DocumentAttachment } from '../../shared/types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  onUserCancel?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onOpenSettings?: () => void;
  draft?: ComposerDraft;
  onDraftChange?: (draft: ComposerDraft) => void;
  draftKey?: string;
  draftGeneration?: number;
  pendingAttachmentReads?: number;
  onAttachmentsReady?: (batch: ComposerAttachmentBatch) => ComposerAttachmentDeliveryResult;
  onAttachmentReadStart?: (scope: ComposerAttachmentScope) => void;
  onAttachmentReadEnd?: (scope: ComposerAttachmentScope) => void;
  onAttachmentReadError?: (message: string) => void;
  onBookmark?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  /** Right-click a brainstormed idea → make it a Media Studio job. */
  onSendToMediaStudio?: (message: ChatMessage) => void;
  /** Optional per-conversation system prompt shown/edited in the chat header */
  systemPrompt?: string;
  onUpdateSystemPrompt?: (prompt: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onUserCancel, onRetry, onOpenSettings, draft, onDraftChange, draftKey, draftGeneration, pendingAttachmentReads, onAttachmentsReady, onAttachmentReadStart, onAttachmentReadEnd, onAttachmentReadError, onBookmark, onReact, onEdit, onSendToMediaStudio, systemPrompt, onUpdateSystemPrompt }) => {
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{ id: number; text: string } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const hasGuidelines = !!(systemPrompt && systemPrompt.trim());

  useLayoutEffect(() => {
    const input = composerRef.current?.closest<HTMLElement>('.input-container');
    const app = input?.closest<HTMLElement>('.app-container');
    if (!input || !app) return;
    const property = '--homebot-composer-clearance';
    const previous = app.style.getPropertyValue(property);
    let active = true;
    const measure = () => {
      if (!active || !input.isConnected || !app.isConnected) return;
      const clearance = Math.max(120, Math.ceil(app.getBoundingClientRect().bottom - input.getBoundingClientRect().top) + 12);
      app.style.setProperty(property, `${clearance}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(input);
    observer?.observe(app);
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (previous) app.style.setProperty(property, previous);
      else app.style.removeProperty(property);
    };
  }, []);

  const handleSend = (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = content?.trim?.() ?? '';
    logDebug('[Renderer] sendMessage invoked', { text, documents: documents?.length || 0 });
    try { (window as any).homebotCapture?.log(`[Renderer] sendMessage invoked msg=${text.substring(0,120)}`); } catch (e) {}
    onSendMessage(content, images, documents);
  };

  const handleSuggestedSelect = (prompt: string) => {
    setSuggestion(previous => ({ id: (previous?.id ?? 0) + 1, text: prompt }));
  };
  const handleReattach = (kind: 'images' | 'documents') => {
    const label = kind === 'images' ? 'Attach images' : 'Attach documents';
    composerRef.current?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.click();
  };
  return (
    <div className="chat-interface">
      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} onCancel={onUserCancel ?? (() => {})} onRetry={onRetry ?? (() => {})} onOpenSettings={onOpenSettings} onReattach={handleReattach} onBookmark={onBookmark} onReact={onReact} onEdit={onEdit} onSendToMediaStudio={onSendToMediaStudio} />
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
        <div ref={composerRef} className="input-wrapper">
          <InputBox onSendMessage={handleSend} draft={draft} onDraftChange={onDraftChange} draftKey={draftKey}
            draftGeneration={draftGeneration} onAttachmentsReady={onAttachmentsReady}
            pendingAttachmentReads={pendingAttachmentReads}
            onAttachmentReadStart={onAttachmentReadStart} onAttachmentReadEnd={onAttachmentReadEnd}
            onAttachmentReadError={onAttachmentReadError} suggestion={suggestion} />
          <button
            type="button"
            className={`guidelines-toggle-btn ${hasGuidelines ? 'has-content' : ''}`}
            onClick={() => setGuidelinesOpen(!guidelinesOpen)}
            title={guidelinesOpen ? 'Hide guidelines' : 'Set chat guidelines'}
            aria-label={guidelinesOpen ? 'Hide chat guidelines' : 'Set chat guidelines'}
          >
            {hasGuidelines ? '📝' : '📋'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
