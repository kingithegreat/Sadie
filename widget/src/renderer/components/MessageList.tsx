import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  messages,
  onCancel,
  onRetry,
}: {
  messages: ChatMessage[];
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Show welcome message if no messages
  if (messages.length === 0) {
    return (
      <div className="welcome-container">
        <div className="welcome-icon">✨</div>
        <h2 className="welcome-title">Hello! I'm SADIE</h2>
        <p className="welcome-subtitle">
          Your friendly local AI assistant. I can help you with questions, create folders, move files, and more. What would you like to do today?
        </p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

export default MessageList;
