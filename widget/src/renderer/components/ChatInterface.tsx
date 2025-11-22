import React from 'react';
import MessageList from './MessageList';
import InputBox from './InputBox';
import { Message as SharedMessage, ImageAttachment as SharedImageAttachment } from '../../shared/types';

interface ChatInterfaceProps {
  messages: SharedMessage[];
  onSendMessage: (content: string, images?: SharedImageAttachment[] | null) => void;
  onUserCancel?: (messageId: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onUserCancel }) => {
  return (
    <div className="chat-interface">
      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} onUserCancel={onUserCancel} />
      </div>

      {/* Fixed input box at bottom */}
      <div className="input-container">
        <InputBox onSendMessage={onSendMessage} />
      </div>
    </div>
  );
};

export default ChatInterface;
