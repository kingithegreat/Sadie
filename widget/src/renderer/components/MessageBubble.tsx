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
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-role={isAssistant ? "assistant-message" : "user-message"}
    >
      <div
        className={[
          "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow",
          isUser
            ? "bg-indigo-600 text-white rounded-br-md"
            : "bg-zinc-900 text-zinc-100 rounded-bl-md border border-zinc-800",
        ].join(" ")}
      >
        <div className="whitespace-pre-wrap break-words">
          {message.content || (isAssistant && state === "streaming" ? "•••" : "")}
        </div>

        {isAssistant && (
          <div className="mt-2 flex items-center gap-2 text-xs opacity-80">
            {state === "streaming" && (
              <button
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                onClick={() => onCancel(message.id!)}
                aria-label="Stop generating"
              >
                Stop generating
              </button>
            )}

            {state === "cancelling" && (
              <span className="text-amber-300">Cancelling…</span>
            )}

            {state === "cancelled" && (
              <span className="text-amber-300">Cancelled</span>
            )}

            {state === "error" && (
              <>
                <span className="text-red-400 font-semibold">Error</span>
                <button
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                  onClick={() => onRetry(message.id!)}
                >
                  Retry
                </button>
              </>
            )}

            {state === "finished" && (
              <span className="text-zinc-400">Done</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
