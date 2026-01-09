import React from "react";
import type { ChatMessage } from "../types";

// Import SADIE icon for assistant avatar
const sadieIcon = require('../assets/SadieIcon.png');

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
  const avatarEmoji = message.role === 'user' ? '👤' : null; // Use icon for assistant
  const avatarClass = message.role === 'user' ? 'user' : 'assistant';
  const state = message.streamingState;
  const hasContent = Boolean(message.content && message.content.trim());
  const shouldShowBubble = hasContent || (isAssistant && state === "streaming");

  // Reflection meta UI logic
  const reflection = isAssistant ? message.reflection : undefined;
  const hasReflection = !!reflection;

  // Clamp and guard confidence percent
  let confidencePercent: number | null = null;
  let confidenceDisplay: string = '—';
  if (hasReflection && typeof reflection?.confidence === 'number' && Number.isFinite(reflection.confidence)) {
    let raw = reflection.confidence;
    if (raw < 0) raw = 0;
    if (raw > 1) raw = 1;
    confidencePercent = Math.round(raw * 100);
    confidenceDisplay = `${confidencePercent}%`;
  }
  const accepted = reflection?.accepted ?? false;
  const isStreaming = state === "streaming";

  // Color for confidence badge
  let confidenceColor = '#888';
  if (hasReflection) {
    if (accepted) confidenceColor = '#22c55e'; // green
    else if (confidencePercent !== null) confidenceColor = '#f59e42'; // orange
  }

  // Strip tool prefix from displayed content for cleaner UI
  const displayContent = message.content?.replace(/^\[USE TOOL: [^\]]+\]\s*/i, '') || '';
  const hasDisplayContent = Boolean(displayContent.trim());

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
            {(hasDisplayContent || (isAssistant && isStreaming)) && (
              <div className="message-bubble">
                {hasDisplayContent ? (
                  displayContent
                ) : (
                  isAssistant && isStreaming && (
                    <div className="thinking-indicator">
                      <span className="thinking-icon">✨</span>
                      <span className="thinking-text">Thinking...</span>
                    </div>
                  )
                )}
              </div>
            )}
            {isAssistant && (
              <div className="message-footer">
                {isStreaming && (
                  <>
                    <span className="status-text streaming">{hasContent ? 'Generating...' : 'Thinking...'}</span>
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
            <img src={sadieIcon} alt="SADIE" className="avatar-icon" />
          </div>

          <div className="message-content">
            {(hasDisplayContent || (isAssistant && isStreaming)) && (
              <div className="message-bubble">
                {hasDisplayContent ? (
                  displayContent
                ) : (
                  isAssistant && isStreaming && (
                    <div className="thinking-indicator">
                      <span className="thinking-icon">✨</span>
                      <span className="thinking-text">Thinking...</span>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Confidence / validation meta — only when finished and reflection exists */}
            {isAssistant && hasReflection && !isStreaming && (
              <div className="mt-1 text-xs opacity-70 flex flex-row items-center gap-2">
                <span style={{ color: confidenceColor }}>
                  {accepted
                    ? 'Validated result'
                    : (confidencePercent !== null ? 'Unvalidated / low-confidence result' : 'Not evaluated')}
                </span>
                <span style={{ color: confidenceColor }}>
                  · Confidence: {confidenceDisplay}
                  {accepted ? ' (accepted)' : confidencePercent !== null ? ' (rejected)' : ''}
                </span>
                {typeof reflection?.threshold === 'number' &&
                  confidencePercent !== null && (
                    <span>
                      (threshold {Math.round(Math.max(0, Math.min(1, reflection.threshold)) * 100)}%)
                    </span>
                  )}
              </div>
            )}

            {isAssistant && (
              <div className="message-footer">
                {isStreaming && (
                  <>
                    <span className="status-text streaming">{hasContent ? 'Generating...' : 'Thinking...'}</span>
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
