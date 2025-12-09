import React from 'react';
import MessageList from './MessageList';
import { InputBox } from './InputBox';
import type { ChatMessage } from '../types';
import type { ImageAttachment as SharedImageAttachment } from '../../shared/types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, images?: SharedImageAttachment[] | null) => void;
  onUserCancel?: (messageId: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onUserCancel }) => {
  return (
    <div className="chat-interface">
      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} onCancel={onUserCancel ?? (() => {})} onRetry={() => {}} />
      </div>

      {/* Fixed input box at bottom */}
      <div className="input-container">
        <div className="input-wrapper">
          <InputBox onSendMessage={onSendMessage} />
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
