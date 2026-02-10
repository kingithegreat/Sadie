import React, { useState, useCallback } from "react";
import type { ChatMessage } from "../types";

/* ================================================================== */
/*  Self-contained Markdown renderer — zero external dependencies      */
/* ================================================================== */

/**
 * Code block with a copy button (no syntax highlighting library needed).
 */
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    try {
      window.electron?.writeClipboard?.(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
    }
  }, [children]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'code'}</span>
        <button className="code-copy-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <pre className="code-block-pre">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/**
 * Parse inline markdown (bold, italic, inline code, links) into React nodes.
 */
function parseInline(text: string, keyBase: number = 0): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match: **bold**, *italic*, `code`, [text](url), bare URLs
  const inlineRe = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))|(https?:\/\/[^\s<>"'`)\]]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = keyBase;

  while ((m = inlineRe.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    if (m[1]) {
      // **bold**
      nodes.push(<strong key={k++}>{m[2]}</strong>);
    } else if (m[3]) {
      // *italic*
      nodes.push(<em key={k++}>{m[4]}</em>);
    } else if (m[5]) {
      // `inline code`
      nodes.push(<code key={k++} className="inline-code">{m[6]}</code>);
    } else if (m[7]) {
      // [text](url)
      nodes.push(
        <a key={k++} href={m[9]} target="_blank" rel="noopener noreferrer" className="message-link">
          {m[8]}
        </a>
      );
    } else if (m[10]) {
      // bare URL
      nodes.push(
        <a key={k++} href={m[10]} target="_blank" rel="noopener noreferrer" className="message-link">
          {m[10]}
        </a>
      );
    }
    last = inlineRe.lastIndex;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes.length > 0 ? nodes : [text];
}

/**
 * Lightweight markdown-to-JSX renderer.
 * Handles: fenced code blocks, inline code, bold, italic, links,
 *          headings, unordered/ordered lists, paragraphs.
 */
function renderMarkdown(content: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let key = 0;

  // Split on fenced code blocks first (```lang\n...\n```)
  const parts = content.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    // Check if this is a fenced code block
    const codeMatch = part.match(/^```(\w*)\n([\s\S]*?)```$/);
    if (codeMatch) {
      const lang = codeMatch[1] || 'code';
      const code = codeMatch[2].replace(/\n$/, '');
      result.push(<CodeBlock key={key++} language={lang} children={code} />);
      continue;
    }

    // Process non-code-block text line by line
    const lines = part.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const Tag = `h${level}` as keyof JSX.IntrinsicElements;
        result.push(<Tag key={key++}>{parseInline(headingMatch[2], key * 100)}</Tag>);
        i++;
        continue;
      }

      // Unordered list items (-, *, +)
      if (/^[\s]*[-*+]\s/.test(line)) {
        const items: React.ReactNode[] = [];
        while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
          const itemText = lines[i].replace(/^[\s]*[-*+]\s/, '');
          items.push(<li key={key++}>{parseInline(itemText, key * 100)}</li>);
          i++;
        }
        result.push(<ul key={key++}>{items}</ul>);
        continue;
      }

      // Ordered list items (1. 2. etc)
      if (/^[\s]*\d+\.\s/.test(line)) {
        const items: React.ReactNode[] = [];
        while (i < lines.length && /^[\s]*\d+\.\s/.test(lines[i])) {
          const itemText = lines[i].replace(/^[\s]*\d+\.\s/, '');
          items.push(<li key={key++}>{parseInline(itemText, key * 100)}</li>);
          i++;
        }
        result.push(<ol key={key++}>{items}</ol>);
        continue;
      }

      // Regular paragraph: collect consecutive non-empty, non-special lines
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].match(/^#{1,6}\s/) &&
        !lines[i].match(/^[\s]*[-*+]\s/) &&
        !lines[i].match(/^[\s]*\d+\.\s/)
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        result.push(
          <p key={key++}>{parseInline(paraLines.join('\n'), key * 100)}</p>
        );
      }
    }
  }

  return result;
}

/**
 * Render assistant messages as Markdown with code blocks + copy button.
 * User messages stay plain text with linkification.
 */
function renderContent(content: string, isUser: boolean): React.ReactNode {
  if (isUser) {
    return <div className="message-text">{linkifyText(content)}</div>;
  }

  return (
    <div className="message-text markdown-body">
      {renderMarkdown(content)}
    </div>
  );
}

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
  const [copiedMsg, setCopiedMsg] = useState(false);

  const handleCopyMessage = useCallback(() => {
    if (!message.content) return;
    try {
      window.electron?.writeClipboard?.(message.content);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2000);
    } catch (e) {
      console.error('Failed to copy message to clipboard:', e);
    }
  }, [message.content]);
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
                  renderContent(message.content!, true)
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
                  renderContent(message.content!, false)
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

                {state === "finished" && (
                  <>
                    <span className="status-text">Done</span>
                    <button
                      className="message-action-btn copy-msg-btn"
                      onClick={handleCopyMessage}
                      aria-label="Copy response"
                    >
                      {copiedMsg ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
