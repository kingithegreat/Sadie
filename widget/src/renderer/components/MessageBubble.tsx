import React from "react";
import type { ChatMessage } from "../types";

/**
 * Convert plain-text URLs into clickable <a> elements.
 * Returns an array of strings and JSX <a> elements.
 */
function linkifyText(text: string): React.ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<>"'`)\]]+)/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = urlRegex.exec(text)) !== null) {
    // Push text before the URL
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[1];
    parts.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="message-link"
      >
        {url}
      </a>
    );
    lastIndex = urlRegex.lastIndex;
  }
  // Push remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

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
                  <div className="message-text">{linkifyText(message.content!)}</div>
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

          <div className={`message-avatar ${isUser ? "user" : "assistant"}`}>
            {isUser ? "👤" : "✨"}
          </div>
        </>
      ) : (
        <>
          {/* ASSISTANT: avatar first, content second */}
          <div className={`message-avatar ${isUser ? "user" : "assistant"}`}>
            {isUser ? "👤" : "✨"}
          </div>

          <div className="message-content">
            {shouldShowBubble && (
              <div className="message-bubble">
                {hasContent ? (
                  <div className="message-text">{linkifyText(message.content!)}</div>
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
