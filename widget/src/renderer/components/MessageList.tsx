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

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
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
