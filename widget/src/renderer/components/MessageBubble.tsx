import React, { useState, useCallback, useRef, useEffect } from "react";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import type { ChatMessage } from "../types";
import homebotChatAvatarUrl from '../assets/HomeBotChatAvatar.png';
import userChatAvatarUrl from '../assets/UserChatAvatar.png';

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

function GeneratedImage({ filename }: { filename: string }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (window as any).electron?.getGeneratedImage?.(filename).then((dataUri: string | null) => {
      if (!cancelled && dataUri) setSrc(dataUri);
    });
    return () => { cancelled = true; };
  }, [filename]);
  if (!src) return <div className="md-generated-img-loading">Loading image...</div>;
  return <img src={src} alt="Generated image" className="md-generated-img" />;
}

/* ================================================================== */
/*  Search result cards — rendered from __HOMEBOT_SOURCES__: token     */
/* ================================================================== */

interface SourceCard {
  t: string; // title
  u: string; // url
  s: string; // snippet
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function SearchResultCards({ cards }: { cards: SourceCard[] }) {
  return (
    <div className="search-result-cards">
      {cards.map((card, i) => {
        const domain = getDomain(card.u);
        const ytId = extractYouTubeId(card.u);
        return (
          <a
            key={i}
            href={card.u}
            target="_blank"
            rel="noopener noreferrer"
            className={`search-card${ytId ? ' search-card--video' : ''}`}
          >
            {ytId && (
              <div className="search-card-thumb">
                <img src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt="" loading="lazy" />
                <div className="search-card-play">&#9654;</div>
              </div>
            )}
            <div className="search-card-body">
              <div className="search-card-title">{card.t}</div>
              {card.s && <div className="search-card-snippet">{card.s}</div>}
              <div className="search-card-domain">
                <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`} alt="" className="search-card-favicon" />
                {domain}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

const SOURCES_TOKEN = '__HOMEBOT_SOURCES__:';

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
                      <th key={ci} className={`md-table-align-${aligns[ci]}`}>
                        {parseInline(cell, key * 1000 + ci)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri}>
                      {parseRow(row).map((cell, ci) => (
                        <td key={ci} className={`md-table-align-${aligns[ci]}`}>
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
  const IMAGE_TOKEN = '__HOMEBOT_IMAGE__:';
  const IMAGE_FILE_TOKEN = '__HOMEBOT_IMAGE_FILE__:';
  const detectImageMime = (b64: string): string => {
    if (b64.startsWith('/9j/')) return 'image/jpeg';
    if (b64.startsWith('UklGR')) return 'image/webp';
    if (b64.startsWith('R0lGOD')) return 'image/gif';
    return 'image/png';
  };

  const hasImage = !isUser && (content.includes(IMAGE_TOKEN) || content.includes(IMAGE_FILE_TOKEN));
  if (hasImage) {
    const normalized = content.replace(/__HOMEBOT_IMAGE_FILE__:/g, IMAGE_TOKEN);
    const segments = normalized.split(IMAGE_TOKEN);
    return (
      <div className="message-text markdown-body">
        {segments.map((seg, idx) => {
          if (idx === 0) {
            const cleaned = seg
              .split('\n')
              .filter(line => !line.trimStart().startsWith('⏳ Generating image'))
              .join('\n');
            return cleaned.trim() ? <React.Fragment key={idx}>{renderMarkdown(cleaned)}</React.Fragment> : null;
          }
          const newline = seg.indexOf('\n');
          const imgRef = newline === -1 ? seg.trim() : seg.slice(0, newline).trim();
          const rest = newline === -1 ? '' : seg.slice(newline + 1);
          const isFilename = imgRef.match(/\.(png|jpg|jpeg|webp|gif)$/i) && !imgRef.includes('/') && !imgRef.includes('\\');
          return (
            <React.Fragment key={idx}>
              {imgRef && (isFilename
                ? <GeneratedImage filename={imgRef} />
                : <img src={`data:${detectImageMime(imgRef)};base64,${imgRef}`} alt="Generated image" className="md-generated-img" />
              )}
              {rest.trim() && renderMarkdown(rest)}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // Extract source cards if present
  const sourcesIdx = content.indexOf(SOURCES_TOKEN);
  if (sourcesIdx !== -1) {
    const textPart = content.slice(0, sourcesIdx);
    const jsonPart = content.slice(sourcesIdx + SOURCES_TOKEN.length);
    let cards: SourceCard[] = [];
    try { cards = JSON.parse(jsonPart); } catch { /* malformed — skip cards */ }
    return (
      <div className="message-text markdown-body">
        {textPart.trim() && renderMarkdown(textPart)}
        {cards.length > 0 && <SearchResultCards cards={cards} />}
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

/** Inline button that starts Ollama (`ollama serve`) via IPC. */
function StartOllamaButton() {
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<'idle' | 'done' | 'failed'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const handleStart = async () => {
    setStarting(true);
    setResult('idle');
    setErrMsg('');
    try {
      const res = await window.electron?.startOllama?.();
      if (res?.success) setResult('done');
      else { setResult('failed'); setErrMsg(res?.error || 'Failed to start Ollama'); }
    } catch (e: any) {
      setResult('failed');
      setErrMsg(e?.message || 'Failed to start Ollama');
    } finally {
      setStarting(false);
    }
  };

  if (result === 'done') {
    return <span style={{ color: 'var(--accent-color, #00d4ff)', fontSize: '12px', fontWeight: 600 }}>✓ Ollama running — click Retry</span>;
  }

  return (
    <>
      <button
        className="message-action-btn"
        onClick={handleStart}
        disabled={starting}
        style={{ padding: '4px 12px' }}
      >
        {starting ? 'Starting Ollama...' : '▶ Start Ollama'}
      </button>
      {result === 'failed' && errMsg && (
        <span style={{ color: 'var(--warning-color, #f59e0b)', fontSize: '11px', marginLeft: '4px', alignSelf: 'center' }}>
          {errMsg}
        </span>
      )}
    </>
  );
}

/** Inline button that triggers `ollama pull <model>` via IPC. */
function PullModelButton({ model }: { model: string }) {
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<'idle' | 'done' | 'failed'>('idle');

  const handlePull = async () => {
    setPulling(true);
    setResult('idle');
    try {
      const res = await window.electron?.pullModel?.(model);
      setResult(res?.success ? 'done' : 'failed');
    } catch {
      setResult('failed');
    } finally {
      setPulling(false);
    }
  };

  if (result === 'done') {
    return <span style={{ color: 'var(--accent-color, #00d4ff)', fontSize: '12px', fontWeight: 600 }}>✓ {model} pulled — click Retry</span>;
  }

  return (
    <button
      className="message-action-btn"
      onClick={handlePull}
      disabled={pulling}
      style={{ padding: '4px 12px' }}
    >
      {pulling ? `Pulling ${model}...` : `📦 Pull ${model}`}
      {result === 'failed' && <span style={{ color: 'var(--warning-color, #f59e0b)', marginLeft: '4px' }}>failed</span>}
    </button>
  );
}

export function MessageBubble({
  message,
  onCancel,
  onRetry,
  onBookmark,
  onReact,
  onEdit,
}: {
  message: ChatMessage;
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
  onBookmark?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";
  const state = message.streamingState;
  const hasContent = Boolean(message.content && message.content.trim());
  const shouldShowBubble = hasContent || (isAssistant && state === "streaming");
  const isCompactedSummary = isSystem && message.content?.startsWith('[Conversation summary');
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);
  const { menu, showContextMenu, closeContextMenu } = useContextMenu();

  useEffect(() => {
    if (!showReactionPicker) return;
    const handler = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setShowReactionPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showReactionPicker]);

  const timestamp = message.createdAt
    ? new Date(message.createdAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  const buildContextItems = useCallback((): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (message.content) {
      items.push({ label: 'Copy', icon: '📋', action: () => {
        window.electron?.writeClipboard?.(message.content!);
      }});
    }
    if (isUser && onEdit && message.id) {
      items.push({ label: 'Edit', icon: '✏️', action: () => {
        setEditDraft(message.content || '');
        setEditing(true);
        setTimeout(() => editRef.current?.focus(), 50);
      }});
    }
    if (onBookmark && message.id) {
      items.push({ label: message.bookmarked ? 'Remove bookmark' : 'Bookmark', icon: message.bookmarked ? '★' : '☆', action: () => onBookmark(message.id!) });
    }
    if (isAssistant && message.content) {
      items.push({ label: speaking ? 'Stop speaking' : 'Speak', icon: '🔊', action: () => {
        if (speaking) { window.electron?.ttsStop?.(); setSpeaking(false); }
        else { setSpeaking(true); window.electron?.ttsSpeak?.(message.content!).then(() => setSpeaking(false)).catch(() => setSpeaking(false)); }
      }});
    }
    if (isAssistant && state === 'finished' && message.id) {
      items.push({ divider: true, label: '', action: () => {} });
      items.push({ label: 'Regenerate', icon: '↻', action: () => onRetry(message.id!) });
    }
    return items;
  }, [message, isAssistant, state, speaking, onRetry, onBookmark]);

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

  // Render compacted summary messages with a distinct collapsed style
  if (isCompactedSummary) {
    const lines = (message.content || '').split('\n');
    const header = lines[0] || '';
    const body = lines.slice(2).join('\n');
    return (
      <div className="message-wrapper system-summary" data-message-id={message.id ?? ""}>
        <details className="compact-summary-details">
          <summary className="compact-summary-header">
            <span className="compact-summary-icon">🗜️</span>
            <span className="compact-summary-title">{header.replace(/^\[|\]$/g, '')}</span>
          </summary>
          <pre className="compact-summary-body">{body}</pre>
        </details>
      </div>
    );
  }

  // Hide other system messages from rendering
  if (isSystem) return null;

  return (
    <div
      className={`message-wrapper ${isUser ? "user" : "assistant"}${message.bookmarked ? ' bookmarked' : ''}`}
      data-role={isAssistant ? "assistant-message" : "user-message"}
      data-state={state || ""}
      data-message-id={message.id ?? ""}
      onContextMenu={(e) => showContextMenu(e, buildContextItems())}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeContextMenu} />}
      {onBookmark && message.id && (
        <button
          className={`bookmark-btn${message.bookmarked ? ' active' : ''}`}
          onClick={() => onBookmark(message.id!)}
          aria-label={message.bookmarked ? 'Remove bookmark' : 'Bookmark message'}
          title={message.bookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          {message.bookmarked ? '★' : '☆'}
        </button>
      )}
      {isUser ? (
        <>
          {/* USER: content first (+ image thumbnails), avatar second */}
          <div className="message-content">
            {/* Image thumbnails attached to this user message */}
            {message.images && message.images.length > 0 && (
              <div className={`user-image-previews user-image-previews-row${message.content ? '' : ' no-margin'}`}>
                {message.images.map((img, i) => (
                  img.url ? (
                    <img
                      key={i}
                      src={img.url}
                      alt={img.filename || 'attached image'}
                      title={img.filename || 'attached image'}
                      className="message-image-thumb"
                    />
                  ) : null
                ))}
              </div>
            )}
            {shouldShowBubble && (
              <div className="message-bubble">
                {editing ? (
                  <div className="message-edit-form">
                    <textarea
                      ref={editRef}
                      className="message-edit-textarea"
                      aria-label="Edit message"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setEditing(false); }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const trimmed = editDraft.trim();
                          if (trimmed && trimmed !== message.content && onEdit) {
                            onEdit(message.id!, trimmed);
                          }
                          setEditing(false);
                        }
                      }}
                      rows={Math.min(6, editDraft.split('\n').length + 1)}
                    />
                    <div className="message-edit-actions">
                      <button className="message-action-btn" onClick={() => setEditing(false)}>Cancel</button>
                      <button className="message-action-btn edit-save-btn" onClick={() => {
                        const trimmed = editDraft.trim();
                        if (trimmed && trimmed !== message.content && onEdit) {
                          onEdit(message.id!, trimmed);
                        }
                        setEditing(false);
                      }}>Save</button>
                    </div>
                  </div>
                ) : hasContent ? (
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
            {timestamp && (
              <span className="message-timestamp">
                {timestamp}{message.edited ? ' [edited]' : ''}
              </span>
            )}
          </div>

          <div className={`message-avatar ${isUser ? "user" : "assistant"}`}>
            {isUser ? <img src={userChatAvatarUrl} alt="You" className="avatar-img" /> : <img src={homebotChatAvatarUrl} alt="HomeBot" className="avatar-img" />}
          </div>
        </>
      ) : (
        <>
          {/* ASSISTANT: avatar first, content second */}
          <div className={`message-avatar ${isUser ? "user" : "assistant"}`}>
            {isUser ? <img src={userChatAvatarUrl} alt="You" className="avatar-img" /> : <img src={homebotChatAvatarUrl} alt="HomeBot" className="avatar-img" />}
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

            {timestamp && <span className="message-timestamp">{timestamp}</span>}

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
                  <span className="status-text status-text-warning">
                    Stopping...
                  </span>
                )}

                {state === "cancelled" && (
                  <span className="status-text status-text-warning">
                    Cancelled
                  </span>
                )}

                {state === "error" && (
                  <>
                    {message.recoveryHint ? (
                      <div className="error-recovery-card">
                        <div className="error-recovery-header">
                          <span className="error-recovery-icon">
                            {message.recoveryHint.service === 'ollama' ? '🔌' :
                             message.recoveryHint.service === 'model' ? '📦' :
                             message.recoveryHint.service === 'n8n' ? '⚙️' : '⚠️'}
                          </span>
                          <span className="error-recovery-title">
                            {message.recoveryHint.service === 'ollama' ? 'Ollama Offline' :
                             message.recoveryHint.service === 'model' ? 'Model Missing' :
                             message.recoveryHint.service === 'n8n' ? 'n8n Unavailable' : 'Error'}
                          </span>
                        </div>
                        <p className="error-recovery-message">
                          {message.recoveryHint.userMessage}
                        </p>
                        <div className="error-recovery-actions">
                          {message.recoveryHint.action === 'pull-model' && message.recoveryHint.model && (
                            <PullModelButton model={message.recoveryHint.model} />
                          )}
                          {message.recoveryHint.action === 'start-ollama' && (
                            <StartOllamaButton />
                          )}
                          {message.recoveryHint.action !== 'reattach-document' && (
                            <button
                              className="message-action-btn"
                              onClick={() => onRetry(message.id!)}
                            >
                              ↻ {message.recoveryHint.actionLabel || 'Retry'}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="error-inline-card">
                        <span className="error-inline-label">Something went wrong</span>
                        <div className="error-inline-actions">
                          <button
                            className="message-action-btn"
                            onClick={() => onRetry(message.id!)}
                          >
                            ↻ Retry
                          </button>
                        </div>
                        {message.error && (
                          <details className="error-diagnostics">
                            <summary className="error-diagnostics-toggle">Technical details</summary>
                            <pre className="error-diagnostics-text">{message.error}</pre>
                          </details>
                        )}
                      </div>
                    )}
                  </>
                )}

                {state === "finished" && (
                  <>
                    {message.model && (
                      <span className="status-text model-tag" title={`Model: ${message.model}`}>
                        {message.model}
                      </span>
                    )}
                    <span className="status-text">Done</span>
                    {typeof message.durationMs === 'number' && message.durationMs > 0 && (
                      <span className="status-text response-time" title="Response time">
                        ⏱ {(message.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {hasContent && (() => {
                      const wordCount = message.content!.trim().split(/\s+/).length;
                      const readMin = Math.max(1, Math.round(wordCount / 200));
                      return (
                        <span className="status-text reading-time" title={`${wordCount} words`}>
                          📖 {readMin} min read
                        </span>
                      );
                    })()}
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

      {/* Reactions bar */}
      {onReact && message.id && hasContent && (
        <div className="reactions-bar">
          {message.reactions && Object.entries(message.reactions).map(([emoji, count]) => (
            count > 0 && (
              <button
                key={emoji}
                className="reaction-pill active"
                onClick={() => onReact(message.id!, emoji)}
                aria-label={`Remove ${emoji} reaction`}
              >
                {emoji} {count}
              </button>
            )
          ))}
          <div className="reaction-picker-wrapper">
            <button
              className="reaction-add-btn"
              onClick={() => setShowReactionPicker(prev => !prev)}
              aria-label="Add reaction"
            >
              +
            </button>
            {showReactionPicker && (
              <div className="reaction-picker" ref={reactionPickerRef} role="menu" aria-label="Choose a reaction">
                {['👍', '👎', '❤️', '😂', '🎉', '🤔'].map(emoji => (
                  <button
                    key={emoji}
                    className="reaction-option"
                    role="menuitem"
                    onClick={() => { onReact(message.id!, emoji); setShowReactionPicker(false); }}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
