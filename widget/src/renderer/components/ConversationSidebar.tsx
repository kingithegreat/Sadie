import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ConversationSearch from './ConversationSearch';
import { ContextMenu, useContextMenu } from './ContextMenu';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pinned?: boolean;
}

interface ConversationSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  isOpen,
  onClose,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [exportStatus, setExportStatus] = useState<Record<string, string>>({});
  const [filterText, setFilterText] = useState('');
  const { menu, showContextMenu, closeContextMenu } = useContextMenu();
  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const result = await (window as any).electron.loadConversations?.();
      if (result?.success && result.data?.conversations) {
        const convList = Object.values(result.data.conversations) as Conversation[];
        // Sort: pinned first, then by updatedAt descending
        convList.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        setConversations(convList);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, loadConversations]);

  // Patch title in local list when main process auto-generates one
  useEffect(() => {
    const onTitleUpdated = (e: Event) => {
      const { conversationId, title } = (e as CustomEvent).detail ?? {};
      if (!conversationId || !title) return;
      setConversations(prev =>
        prev.map(c => c.id === conversationId ? { ...c, title } : c)
      );
    };
    window.addEventListener('sadie:title-updated', onTitleUpdated);
    return () => window.removeEventListener('sadie:title-updated', onTitleUpdated);
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      onDeleteConversation(id);
      // Remove from local state
      setConversations(prev => prev.filter(c => c.id !== id));
    }
  };

  const handleExport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExportStatus(s => ({ ...s, [id]: 'exporting' }));
    try {
      const r = await (window as any).electron.exportConversation?.(id);
      if (r?.success) {
        setExportStatus(s => ({ ...s, [id]: 'done' }));
        setTimeout(() => setExportStatus(s => { const n = {...s}; delete n[id]; return n; }), 2500);
      } else {
        setExportStatus(s => ({ ...s, [id]: 'error' }));
      }
    } catch {
      setExportStatus(s => ({ ...s, [id]: 'error' }));
    }
  };

  const exportLabel = (id: string) => {
    const s = exportStatus[id];
    if (s === 'exporting') return '⏳';
    if (s === 'done') return '✅';
    if (s === 'error') return '❌';
    return '⬇️';
  };

  const handleTogglePin = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    const newPinned = !conv.pinned;
    // Optimistic update
    setConversations(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, pinned: newPinned } : c);
      updated.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      return updated;
    });
    // Persist
    try {
      await (window as any).electron.saveConversation?.({ ...conv, pinned: newPinned });
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleStartEdit = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleSaveEdit = async (id: string) => {
    try {
      const conv = conversations.find(c => c.id === id);
      if (conv) {
        await (window as any).electron.saveConversation?.({
          ...conv,
          title: editTitle
        });
        setConversations(prev => prev.map(c => 
          c.id === id ? { ...c, title: editTitle } : c
        ));
      }
    } catch (err) {
      console.error('Failed to save title:', err);
    }
    setEditingId(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatFullDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  if (!isOpen) return null;

  const filteredConversations = filterText.trim()
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(filterText.toLowerCase()))
    : conversations;

  if (showSearch) {
    return (
      <ConversationSearch
        onSelectConversation={(id) => { onSelectConversation(id); onClose(); }}
        onClose={() => setShowSearch(false)}
      />
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div className="sidebar-backdrop" onClick={onClose} />
      
      {/* Sidebar */}
      <div className="conversation-sidebar">
        <div className="sidebar-header">
          <h2>Conversations</h2>
          <button className="search-btn" onClick={() => setShowSearch(true)} title="Search conversations" aria-label="Search conversations">
            🔍
          </button>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <button className="new-chat-btn" onClick={onNewConversation}>
          <span className="icon">+</span>
          New Chat
        </button>

        <div className="sidebar-filter">
          <input
            type="text"
            className="sidebar-filter-input"
            placeholder="Filter by title…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            aria-label="Filter conversations"
          />
          {filterText && (
            <button className="sidebar-filter-clear" onClick={() => setFilterText('')} aria-label="Clear filter">×</button>
          )}
        </div>
        
        <div className="conversations-list">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="empty">{filterText ? 'No matches' : 'No conversations yet'}</div>
          ) : (
            filteredConversations.map(conv => (
              <div
                key={conv.id}
                className={`conversation-item${conv.id === currentConversationId ? ' active' : ''}${conv.pinned ? ' pinned' : ''}`}
                onClick={() => {
                  onSelectConversation(conv.id);
                  onClose();
                }}
                onContextMenu={(e) => showContextMenu(e, [
                  { label: conv.pinned ? 'Unpin' : 'Pin', icon: conv.pinned ? '📌' : '📍', action: () => handleTogglePin(conv.id, e as any) },
                  { label: 'Rename', icon: '✏️', action: () => handleStartEdit(conv.id, conv.title, e as any) },
                  { label: 'Export', icon: '⬇️', action: () => handleExport(conv.id, e as any) },
                  { divider: true, label: '', action: () => {} },
                  { label: 'Delete', icon: '🗑️', action: () => handleDelete(conv.id, e as any) },
                ])}
              >
                {editingId === conv.id ? (
                  <input
                    className="edit-title-input"
                    aria-label="Edit conversation title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleSaveEdit(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(conv.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <>
                    <div className="conv-info">
                      <div className="conv-title">{conv.title || 'Untitled'}</div>
                      <div className="conv-meta" title={formatFullDate(conv.updatedAt)}>
                        <span className="conv-msg-count">{conv.messageCount || 0}</span>
                        <span className="conv-time">{formatDate(conv.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="conv-actions">
                      <button
                        className={`pin-btn${conv.pinned ? ' pinned' : ''}`}
                        onClick={(e) => handleTogglePin(conv.id, e)}
                        title={conv.pinned ? 'Unpin' : 'Pin'}
                        aria-label={conv.pinned ? 'Unpin conversation' : 'Pin conversation'}
                      >
                        {conv.pinned ? '📌' : '📍'}
                      </button>
                      <button 
                        className="edit-btn" 
                        onClick={(e) => handleStartEdit(conv.id, conv.title, e)}
                        title="Rename"
                      >
                        ✏️
                      </button>
                      <button
                        className="export-btn"
                        onClick={(e) => handleExport(conv.id, e)}
                        title="Export to Markdown"
                        aria-label={`Export ${conv.title}`}
                      >
                        {exportLabel(conv.id)}
                      </button>
                      <button 
                        className="delete-btn" 
                        onClick={(e) => handleDelete(conv.id, e)}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeContextMenu} />}
    </>
  );
};

export default ConversationSidebar;
