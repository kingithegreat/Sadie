import React, { useEffect, useRef } from 'react';

interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  error?: boolean;
  // streaming state: 'streaming' | 'done' | 'cancelled'
  streamingState?: 'streaming' | 'done' | 'cancelled';
  image?: {
    filename: string;
    url?: string;
    mimeType?: string;
  } | null;
}

interface MessageListProps {
  messages: Message[];
}

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="message-list">
      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isSystem = message.role === 'system';
        const isError = message.error;

        return (
          <div
            key={message.id || index}
            className={`message-wrapper ${isUser ? 'user' : 'assistant'}`}
          >
            <div 
              className={`message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'} ${isError ? 'error-bubble' : ''} ${isSystem ? 'system-bubble' : ''}`}
            >
              <div className="message-content">
                {message.image && (
                  <div className="message-image-wrap">
                    <img className="message-image" src={message.image.url} alt={message.image.filename} />
                  </div>
                )}
                {message.content}
                {message.streamingState === 'streaming' && (
                  <>
                    <span className="streaming-cursor" aria-hidden>
                      <span className="dot dot1">•</span>
                      <span className="dot dot2">•</span>
                      <span className="dot dot3">•</span>
                    </span>
                    <button
                      className="stream-cancel-btn"
                      title="Stop generating"
                      aria-label="Stop generating"
                      onClick={() => {
                        try {
                          (window as any).electron?.cancelStream?.(message.id);
                        } catch (e) {
                          // ignore
                        }
                      }}
                    >
                      ✖
                    </button>
                  </>
                )}
                {message.streamingState === 'cancelled' && (
                  <div className="stream-cancelled-footer">Stopped by user</div>
                )}
              </div>
              {message.timestamp && (
                <div className="message-timestamp">
                  {formatTime(message.timestamp)}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={messagesEndRef} />
      <style>{`
        .streaming-cursor {
          display: inline-block;
          margin-left: 8px;
          color: var(--muted, #888);
          animation: blink 1s steps(3, end) infinite;
          font-weight: 600;
        }
        @keyframes blink {
          50% { opacity: 0.3; }
        }
        .stream-cancel-btn {
          margin-left: 8px;
          background: transparent;
          border: none;
          color: var(--danger-bg, #d9534f);
          cursor: pointer;
          font-size: 12px;
          padding: 2px 6px;
        }
        .stream-cancel-btn:focus { outline: 2px solid var(--primary, #007aff); }
      `}</style>
    </div>
  );
};

export default MessageList;
