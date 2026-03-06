import React, { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage } from "../types";

// highlight.js — core + common languages (tree-shaken)
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // also covers HTML
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('ps1', powershell);

/* ================================================================== */
/*  Self-contained Markdown renderer — zero external dependencies      */
/* ================================================================== */

/**
 * Code block with a copy button (no syntax highlighting library needed).
 */
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // Apply syntax highlighting after render / when content changes
  useEffect(() => {
    if (codeRef.current) {
      // Reset any previous highlighting so hljs re-processes
      codeRef.current.removeAttribute('data-highlighted');
      codeRef.current.textContent = children;
      try {
        hljs.highlightElement(codeRef.current);
      } catch {
        // If the language isn't registered, leave as plain text
      }
    }
  }, [children, language]);

  const handleCopy = useCallback(() => {
    try {
      window.electron?.writeClipboard?.(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
    }
  }, [children]);

  // Build the class name for hljs — e.g. "language-python"
  const langClass = language ? `language-${language}` : '';

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'code'}</span>
        <button className="code-copy-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <pre className="code-block-pre">
        <code ref={codeRef} className={langClass}>{children}</code>
      </pre>
    </div>
  );
}

/**
 * File link component that opens files via Electron shell
 */
function FileLink({ filePath, children, showFolder }: { filePath: string; children: React.ReactNode; showFolder?: boolean }) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (showFolder) {
      window.electron?.showInFolder?.(filePath);
    } else {
      window.electron?.openFile?.(filePath);
    }
  }, [filePath, showFolder]);

  return (
    <a href="#" onClick={handleClick} className="message-link file-link" title={showFolder ? 'Show in folder' : 'Open file'}>
      {children}
    </a>
  );
}

/**
 * Parse inline markdown (bold, italic, inline code, links) into React nodes.
 */
function parseInline(text: string, keyBase: number = 0): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match: **bold**, *italic*, `code`, [text](url), bare URLs, file:// URLs
  const inlineRe = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))|(https?:\/\/[^\s<>"'`)\]]+)|(file:\/\/([^\s<>"'`)\]]+))/g;
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
      // [text](url) - check if it's a file:// URL
      const url = m[9];
      const linkText = m[8];
      if (url.startsWith('file://')) {
        const filePath = decodeURIComponent(url.replace('file://', '').replace(/^\/+/, ''));
        nodes.push(<FileLink key={k++} filePath={filePath}>{linkText}</FileLink>);
      } else {
        nodes.push(
          <a key={k++} href={url} target="_blank" rel="noopener noreferrer" className="message-link">
            {linkText}
          </a>
        );
      }
    } else if (m[10]) {
      // bare https:// URL
      nodes.push(
        <a key={k++} href={m[10]} target="_blank" rel="noopener noreferrer" className="message-link">
          {m[10]}
        </a>
      );
    } else if (m[11]) {
      // bare file:// URL
      const filePath = decodeURIComponent(m[12].replace(/^\/+/, ''));
      nodes.push(<FileLink key={k++} filePath={filePath}>📄 {filePath.split(/[/\\]/).pop()}</FileLink>);
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

      // Horizontal rule
      if (/^[-*_]{3,}\s*$/.test(line)) {
        result.push(<hr key={key++} className="md-hr" />);
        i++;
        continue;
      }

      // Markdown table: lines containing | that look like a table
      // First row is header, second row is separator (---|---), rest are body
      if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1])) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].includes('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        if (tableLines.length >= 2) {
          const parseRow = (row: string) =>
            row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
          const headerCells = parseRow(tableLines[0]);
          // tableLines[1] is the separator row — skip it
          const bodyRows = tableLines.slice(2);
          // Detect per-column alignment from separator
          const sepCells = parseRow(tableLines[1]);
          const aligns = sepCells.map(s => {
            if (s.startsWith(':') && s.endsWith(':')) return 'center';
            if (s.endsWith(':')) return 'right';
            return 'left';
          });
          result.push(
            <div key={key++} className="md-table-wrapper">
              <table className="md-table">
                <thead>
                  <tr>
                    {headerCells.map((cell, ci) => (
                      <th key={ci} style={{ textAlign: aligns[ci] as any }}>
                        {parseInline(cell, key * 1000 + ci)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri}>
                      {parseRow(row).map((cell, ci) => (
                        <td key={ci} style={{ textAlign: aligns[ci] as any }}>
                          {parseInline(cell, key * 1000 + ri * 100 + ci)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
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

  // Split content into segments — plain text parts vs inline images
  const IMAGE_TOKEN = '__SADIE_IMAGE__:';
  // Detect image MIME type from base64 magic bytes prefix
  const detectImageMime = (b64: string): string => {
    if (b64.startsWith('/9j/')) return 'image/jpeg';
    if (b64.startsWith('UklGR')) return 'image/webp';
    if (b64.startsWith('R0lGOD')) return 'image/gif';
    return 'image/png'; // default (covers iVBOR... PNG prefix)
  };
  if (!isUser && content.includes(IMAGE_TOKEN)) {
    const segments = content.split(IMAGE_TOKEN);
    return (
      <div className="message-text markdown-body">
        {segments.map((seg, idx) => {
          if (idx === 0) {
            // Text before the first image token — strip the ⏳ progress line if present
            const cleaned = seg
              .split('\n')
              .filter(line => !line.trimStart().startsWith('⏳ Generating image'))
              .join('\n');
            return cleaned.trim() ? <React.Fragment key={idx}>{renderMarkdown(cleaned)}</React.Fragment> : null;
          }
          // Each subsequent segment starts with the raw base64 data; the rest is text
          const newline = seg.indexOf('\n');
          const b64 = newline === -1 ? seg.trim() : seg.slice(0, newline).trim();
          const rest = newline === -1 ? '' : seg.slice(newline + 1);
          return (
            <React.Fragment key={idx}>
              {b64 && (
                <img
                  src={`data:${detectImageMime(b64)};base64,${b64}`}
                  alt="Generated image"
                  style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8, display: 'block' }}
                />
              )}
              {rest.trim() && renderMarkdown(rest)}
            </React.Fragment>
          );
        })}
      </div>
    );
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
  const [speaking, setSpeaking] = useState(false);

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

  const handleSpeak = useCallback(async () => {
    if (!message.content) return;
    if (speaking) {
      await window.electron?.ttsStop?.();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      await window.electron?.ttsSpeak?.(message.content);
      setSpeaking(false);
    }
  }, [message.content, speaking]);
  return (
    <div
      className={`message-wrapper ${isUser ? "user" : "assistant"}`}
      data-role={isAssistant ? "assistant-message" : "user-message"}
      data-state={state || ""}
      data-message-id={message.id ?? ""}
    >
      {isUser ? (
        <>
          {/* USER: content first (+ image thumbnails), avatar second */}
          <div className="message-content">
            {/* Image thumbnails attached to this user message */}
            {message.images && message.images.length > 0 && (
              <div className="user-image-previews" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: message.content ? 6 : 0 }}>
                {message.images.map((img, i) => (
                  img.url ? (
                    <img
                      key={i}
                      src={img.url}
                      alt={img.filename || 'attached image'}
                      title={img.filename || 'attached image'}
                      style={{ maxWidth: 220, maxHeight: 160, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.15)' }}
                    />
                  ) : null
                ))}
              </div>
            )}
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
                      className="message-action-btn"
                      onClick={() => onRetry(message.id!)}
                      aria-label="Regenerate response"
                    >
                      ↻ Regenerate
                    </button>
                    <button
                      className="message-action-btn copy-msg-btn"
                      onClick={handleCopyMessage}
                      aria-label="Copy response"
                    >
                      {copiedMsg ? '✓ Copied' : '📋 Copy'}
                    </button>
                    <button
                      className={`message-action-btn speak-btn${speaking ? ' speaking' : ''}`}
                      onClick={handleSpeak}
                      aria-label={speaking ? 'Stop speaking' : 'Speak response'}
                    >
                      {speaking ? '⏹ Stop' : '🔊 Speak'}
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
