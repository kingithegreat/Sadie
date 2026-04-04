import { useEffect, useRef, useState, useCallback } from "react";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  messages,
  onCancel,
  onRetry,
  onBookmark,
}: {
  messages: ChatMessage[];
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
  onBookmark?: (messageId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);

  // Detect when user scrolls away from the bottom
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setAutoScroll(atBottom);
    setShowScrollBtn(!atBottom);
  }, []);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, autoScroll]);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setAutoScroll(true);
    setShowScrollBtn(false);
  }, []);

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

  const bookmarkCount = messages.filter(m => m.bookmarked).length;
  const displayMessages = showBookmarksOnly ? messages.filter(m => m.bookmarked) : messages;

  return (
    <div
      className="message-list"
      role="log"
      aria-live="polite"
      aria-label="Conversation messages"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {bookmarkCount > 0 && (
        <div className="bookmarks-filter-bar">
          <button
            className={`bookmarks-filter-btn${showBookmarksOnly ? ' active' : ''}`}
            onClick={() => setShowBookmarksOnly(prev => !prev)}
            aria-label={showBookmarksOnly ? 'Show all messages' : 'Show bookmarks only'}
          >
            ★ {showBookmarksOnly ? 'Show all' : `Bookmarks (${bookmarkCount})`}
          </button>
        </div>
      )}
      {displayMessages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          onCancel={onCancel}
          onRetry={onRetry}
          onBookmark={onBookmark}
        />
      ))}
      <div ref={endRef} />
      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}

export default MessageList;
