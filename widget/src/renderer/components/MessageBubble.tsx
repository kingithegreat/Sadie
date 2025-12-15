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
  // Derive avatar and avatar class directly from the canonical role to
  // avoid any accidental mismatch when nested conditionals are evaluated.
  const avatarEmoji = message.role === 'user' ? '👤' : '✨';
  const avatarClass = message.role === 'user' ? 'user' : 'assistant';
  const state = message.streamingState;
  const hasContent = Boolean(message.content && message.content.trim());
  const shouldShowBubble = hasContent || (isAssistant && state === "streaming");
  return (
    <div
      className={`message-wrapper ${isUser ? "user" : "assistant"}`}
      data-role={isAssistant ? "assistant-message" : "user-message"}
      data-state={state || ""}
      data-message-id={message.id ?? ""}
    >
      {isUser ? (
        <>
          {/* USER: content first, avatar second */}
          <div className="message-content">
            {shouldShowBubble && (
              <div className="message-bubble">
                {hasContent ? (
                  message.content
                ) : (
                  isAssistant && state === "streaming" && (
                    <div className="streaming-indicator">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  )
                )}
              </div>
            )}
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
                  <span className="status-text" style={{ color: "#FCD34D" }}>
                    Stopping...
                  </span>
                )}

                {state === "cancelled" && (
                  <span className="status-text" style={{ color: "#FCD34D" }}>
                    Cancelled
                  </span>
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

                {state === "finished" && <span className="status-text">Done</span>}
              </div>
            )}
          </div>

          <div className={`message-avatar ${avatarClass}`}>
            {avatarEmoji}
          </div>
        </>
      ) : (
        <>
          {/* ASSISTANT: avatar first, content second */}
          <div className={`message-avatar ${avatarClass}`}>
            {avatarEmoji}
          </div>

          <div className="message-content">
            {shouldShowBubble && (
              <div className="message-bubble">
                {hasContent ? (
                  message.content
                ) : (
                  isAssistant && state === "streaming" && (
                    <div className="streaming-indicator">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  )
                )}
              </div>
            )}

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
                  <span className="status-text" style={{ color: "#FCD34D" }}>
                    Stopping...
                  </span>
                )}

                {state === "cancelled" && (
                  <span className="status-text" style={{ color: "#FCD34D" }}>
                    Cancelled
                  </span>
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

                {state === "finished" && <span className="status-text">Done</span>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
