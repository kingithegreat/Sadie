import React, { useEffect, useRef, useState, useCallback } from "react";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { getDailyQuote, getDailyJoke } from '../../shared/daily-content';

export function MessageList({
  messages,
  onCancel,
  onRetry,
  onBookmark,
  onReact,
  onEdit,
}: {
  messages: ChatMessage[];
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
  onBookmark?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
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
    const quote = getDailyQuote();
    const joke = getDailyJoke();
    return (
      <div className="welcome-container">
        <div className="welcome-icon">✨</div>
        <h2 className="welcome-title">Hello! I'm SADIE</h2>
        <p className="welcome-subtitle">
          Your friendly local AI assistant. I can help you with questions, create folders, move files, and more. What would you like to do today?
        </p>
        <div className="daily-content">
          <div className="daily-card daily-quote">
            <span className="daily-label">Quote of the Day</span>
            <blockquote>"{quote.text}"</blockquote>
            <cite>— {quote.author}</cite>
          </div>
          <div className="daily-card daily-joke">
            <span className="daily-label">Joke of the Day</span>
            <p>{joke}</p>
          </div>
        </div>
      </div>
    );
  }

  const bookmarkCount = messages.filter(m => m.bookmarked).length;
  const displayMessages = showBookmarksOnly ? messages.filter(m => m.bookmarked) : messages;

  // Compute date separator labels
  const dateLabelForMsg = (msg: ChatMessage): string => {
    if (!msg.createdAt) return '';
    const d = new Date(msg.createdAt);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Track which date labels have been shown
  let lastDateLabel = '';

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
      {displayMessages.map((m) => {
        const label = dateLabelForMsg(m);
        const showSeparator = label && label !== lastDateLabel;
        if (showSeparator) lastDateLabel = label;
        return (
          <React.Fragment key={m.id}>
            {showSeparator && (
              <div className="date-separator" role="separator">
                <span className="date-separator-label">{label}</span>
              </div>
            )}
            <MessageBubble
              message={m}
              onCancel={onCancel}
              onRetry={onRetry}
              onBookmark={onBookmark}
              onReact={onReact}
              onEdit={onEdit}
            />
          </React.Fragment>
        );
      })}
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
