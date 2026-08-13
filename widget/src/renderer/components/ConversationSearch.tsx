import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface SearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  updatedAt: string;
}

interface ConversationSearchProps {
  onSelectConversation: (id: string, messageId?: string) => void;
  onClose: () => void;
}

const ConversationSearch: React.FC<ConversationSearchProps> = ({ onSelectConversation, onClose }) => {
  // Escape closes and returns to the conversation list. This panel replaces the
  // sidebar entirely and fills the window, and Escape is the most expected key
  // there is in a search box — it had none.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [exportStatus, setExportStatus] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const r = await (window as any).electron.searchConversations?.(q.trim(), 50);
      setResults(r?.data ?? []);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  };

  const handleExport = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    setExportStatus(s => ({ ...s, [convId]: 'exporting' }));
    try {
      const r = await (window as any).electron.exportConversation?.(convId);
      if (r?.success) {
        setExportStatus(s => ({ ...s, [convId]: 'done' }));
        setTimeout(() => setExportStatus(s => { const n = { ...s }; delete n[convId]; return n; }), 2500);
      } else {
        setExportStatus(s => ({ ...s, [convId]: 'error' }));
      }
    } catch {
      setExportStatus(s => ({ ...s, [convId]: 'error' }));
    }
  };

  // Highlight matched text inside snippet
  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    );
  };

  // Group results by conversation
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.conversationId] ??= []).push(r);
    return acc;
  }, {});

  const exportLabel = (convId: string) => {
    const s = exportStatus[convId];
    if (s === 'exporting') return '⏳';
    if (s === 'done') return '✅';
    if (s === 'error') return '❌';
    return '⬇️';
  };

  // Portalled to document.body. ConversationSidebar SWAPS ITS OWN ROOT for this
  // component when search is open — it returns <ConversationSearch/> instead of
  // the sidebar — and ErrorBoundary/Suspense render no DOM node, so this becomes
  // a direct child of .app-container. The sidebar is named in the blanket rule's
  // :not() list; .conversation-search-overlay is not, so swapping roots silently
  // dropped the exemption and the panel was laid out as a page row:
  //
  //   .app-container > *:not(.app-header):not(...) {
  //     position: relative; z-index: 1; }   /* (0,10,0) beats (0,1,0) */
  //
  // Exactly the trap a blocklist sets: the exemption is attached to a class
  // name, not to what the element is for.
  return createPortal((
    <div className="conversation-search-overlay">
      <div className="conversation-search-panel">
        <div className="search-header">
          <h3>Search Conversations</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close search">×</button>
        </div>

        <div className="search-input-row">
          <input
            className="search-input"
            type="text"
            placeholder="Search all messages…"
            value={query}
            onChange={handleQueryChange}
            autoFocus
            aria-label="Search conversations"
          />
          {loading && <span className="search-spinner">⟳</span>}
        </div>

        <div className="search-results">
          {!searched && !loading && (
            <p className="search-hint">Start typing to search across all your conversations.</p>
          )}
          {searched && Object.keys(grouped).length === 0 && (
            <p className="search-empty">No messages matched <strong>"{query}"</strong></p>
          )}
          {Object.entries(grouped).map(([convId, hits]) => (
            <div key={convId} className="search-group">
              <div className="search-group-header">
                <button
                  type="button"
                  className="search-group-open"
                  onClick={() => { onSelectConversation(convId, hits[0]?.messageId); onClose(); }}
                  aria-label={`Open conversation ${hits[0].conversationTitle || 'Untitled'}`}
                >
                  <span className="search-group-title">{hits[0].conversationTitle || 'Untitled'}</span>
                  <span className="search-group-meta">{hits.length} match{hits.length !== 1 ? 'es' : ''}</span>
                </button>
                <button
                  type="button"
                  className="export-btn"
                  title="Export conversation to Markdown"
                  onClick={e => handleExport(e, convId)}
                  aria-label={`Export ${hits[0].conversationTitle}`}
                >
                  {exportLabel(convId)}
                </button>
              </div>
              {hits.slice(0, 3).map((hit, i) => (
                <div
                  key={`${hit.messageId}-${i}`}
                  className="search-hit"
                  onClick={() => { onSelectConversation(convId, hit.messageId); onClose(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') { onSelectConversation(convId, hit.messageId); onClose(); } }}
                >
                  <span className="hit-role">{hit.role === 'user' ? 'You' : 'HomeBot'}</span>
                  <span className="hit-snippet">{highlight(hit.snippet, query)}</span>
                </div>
              ))}
              {hits.length > 3 && (
                <div
                  className="search-hit search-hit-more"
                  onClick={() => { onSelectConversation(convId); onClose(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') { onSelectConversation(convId); onClose(); } }}
                >
                  +{hits.length - 3} more match{hits.length - 3 !== 1 ? 'es' : ''} in this conversation
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
};

export default ConversationSearch;
