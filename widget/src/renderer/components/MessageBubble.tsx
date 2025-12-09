import React from "react";
import type { ChatMessage } from "../types";

export function MessageBubble({
  message,
  onCancel,
  onRetry,
}: {
  message: ChatMessage;
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const state = message.streamingState;

  return (
    <div
      className={`message-wrapper ${isUser ? 'user' : 'assistant'}`}
      data-role={isAssistant ? 'assistant-message' : 'user-message'}
      data-state={state || ''}
      data-message-id={message.id ?? ''}
    >
      {/* Avatar */}
      <div className={`message-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? '👤' : '✨'}
      </div>

      {/* Message content */}
      <div className="message-content">
        <div className="message-bubble">
          {/* Message text */}
          {message.content || (isAssistant && state === "streaming" ? (
            <div className="streaming-indicator">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          ) : "")}
        </div>

        {/* Footer with status and actions */}
        {isAssistant && (
          <div className="message-footer">
            {state === "streaming" && (
              <>
                <span className="status-text streaming">Generating...</span>
                <button
                  className="message-action-btn"
                  onClick={() => onCancel(message.id!)}
                  aria-label="Stop generating"
                >
                  ⏹ Stop
                </button>
              </>
            )}

            {state === "cancelling" && (
              <span className="status-text" style={{ color: '#FCD34D' }}>Stopping...</span>
            )}

            {state === "cancelled" && (
              <span className="status-text" style={{ color: '#FCD34D' }}>Cancelled</span>
            )}

            {state === "error" && (
              <>
                <span className="status-text error">Error</span>
                <button
                  className="message-action-btn"
                  onClick={() => onRetry(message.id!)}
                >
                  ↻ Retry
                </button>
              </>
            )}

            {state === "finished" && (
              <span className="status-text">Done</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
