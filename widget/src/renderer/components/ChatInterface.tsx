import React from 'react';
import { debug as logDebug } from '../../shared/logger';
import MessageList from './MessageList';
import { InputBox } from './InputBox';
import type { ChatMessage } from '../types';
import type { ImageAttachment as SharedImageAttachment, DocumentAttachment } from '../../shared/types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  onUserCancel?: (messageId: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onUserCancel }) => {
  const handleSend = (content: string, images?: SharedImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = content?.trim?.() ?? '';
    logDebug('[Renderer] sendMessage invoked', { text, docCount: documents?.length || 0 });
    try { (window as any).sadieCapture?.log(`[Renderer] sendMessage invoked msg=${text.substring(0,120)} docs=${documents?.length || 0}`); } catch (e) {}
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
      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} onCancel={onUserCancel ?? (() => {})} onRetry={() => {}} />
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
