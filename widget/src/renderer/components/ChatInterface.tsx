import React from 'react';
import MessageList from './MessageList';
import InputBox from './InputBox';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  error?: boolean;
  id?: string;
  streamingState?: 'streaming' | 'done' | 'cancelled';
  image?: {
    filename: string;
    url?: string;
    mimeType?: string;
  } | null;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (content: string, image?: { filename?: string; mimeType?: string; data?: string } | null) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage }) => {
  return (
    <div className="chat-interface">
      {/* Scrollable message list */}
      <div className="messages-container">
        <MessageList messages={messages} />
      </div>

      {/* Fixed input box at bottom */}
      <div className="input-container">
        <InputBox onSendMessage={onSendMessage} />
      </div>
    </div>
  );
};

export default ChatInterface;
