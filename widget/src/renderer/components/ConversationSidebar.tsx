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
  archived?: boolean;
  tags?: string[];
}

interface ConversationSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversationId: string | null;
  onSelectConversation: (id: string, messageId?: string) => void;
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
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'created' | 'name'>('recent');
  const [compactStatus, setCompactStatus] = useState<Record<string, string>>({});
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

  const handleExport = async (id: string, e: React.MouseEvent, format: 'markdown' | 'json' = 'markdown') => {
    e.stopPropagation();
    setExportStatus(s => ({ ...s, [id]: 'exporting' }));
    try {
      const r = await (window as any).electron.exportConversation?.(id, format);
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

  const handleArchive = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    const newArchived = !conv.archived;
    setConversations(prev => prev.map(c => c.id === id ? { ...c, archived: newArchived } : c));
    try {
      await (window as any).electron.saveConversation?.({ ...conv, archived: newArchived });
    } catch (err) {
      console.error('Failed to toggle archive:', err);
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

  const TAG_OPTIONS = [
    { name: 'Work', color: '#A07820' },
    { name: 'Personal', color: '#10b981' },
    { name: 'Research', color: '#f59e0b' },
    { name: 'Important', color: '#ef4444' },
    { name: 'Fun', color: '#8b5cf6' },
  ];

  const handleCompact = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    if ((conv.messageCount || 0) <= 20) {
      setCompactStatus(s => ({ ...s, [id]: 'too-few' }));
      setTimeout(() => setCompactStatus(s => { const n = {...s}; delete n[id]; return n; }), 2500);
      return;
    }
    setCompactStatus(s => ({ ...s, [id]: 'compacting' }));
    try {
      const r = await (window as any).electron.compactConversation?.(id);
      if (r?.success && !r.error) {
        setCompactStatus(s => ({ ...s, [id]: 'done' }));
        setConversations(prev => prev.map(c =>
          c.id === id ? { ...c, messageCount: r.compactedCount } : c
        ));
      } else {
        setCompactStatus(s => ({ ...s, [id]: r?.error || 'error' }));
      }
      setTimeout(() => setCompactStatus(s => { const n = {...s}; delete n[id]; return n; }), 3000);
    } catch {
      setCompactStatus(s => ({ ...s, [id]: 'error' }));
      setTimeout(() => setCompactStatus(s => { const n = {...s}; delete n[id]; return n; }), 3000);
    }
  };

  const handleToggleTag = async (id: string, tag: string) => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    const currentTags = conv.tags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter(t => t !== tag)
      : [...currentTags, tag];
    setConversations(prev => prev.map(c => c.id === id ? { ...c, tags: newTags } : c));
    try {
      await (window as any).electron.saveConversation?.({ ...conv, tags: newTags });
    } catch (err) {
      console.error('Failed to toggle tag:', err);
    }
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

  const filteredConversations = (() => {
    let list = conversations.filter(c => showArchived ? !!c.archived : !c.archived);
    if (filterText.trim()) {
      list = list.filter(c => (c.title || '').toLowerCase().includes(filterText.toLowerCase()));
    }
    // Apply sort (pinned always first)
    list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (sortBy === 'name') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  })();

  if (showSearch) {
    return (
      <ConversationSearch
        onSelectConversation={(id, msgId) => { onSelectConversation(id, msgId); onClose(); }}
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
          <button className="close-btn" onClick={onClose} aria-label="Close sidebar">×</button>
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

        <button
          className={`archive-toggle-btn${showArchived ? ' active' : ''}`}
          onClick={() => setShowArchived(prev => !prev)}
          title={showArchived ? 'Show active' : 'Show archived'}
          aria-label={showArchived ? 'Show active conversations' : 'Show archived conversations'}
        >
          📦 {showArchived ? 'Archived' : 'Active'}
        </button>

        <select
          className="sidebar-sort-select"
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'recent' | 'created' | 'name')}
          aria-label="Sort conversations"
          title="Sort conversations"
        >
          <option value="recent">Recently active</option>
          <option value="created">Date created</option>
          <option value="name">Name A–Z</option>
        </select>
        
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
                  { label: 'Export Markdown', icon: '⬇️', action: () => handleExport(conv.id, e as any, 'markdown') },
                  { label: 'Export JSON', icon: '📋', action: () => handleExport(conv.id, e as any, 'json') },
                  { label: conv.archived ? 'Restore' : 'Archive', icon: '📦', action: () => handleArchive(conv.id, e as any) },
                  { label: `Compact${(conv.messageCount || 0) > 20 ? ` (${conv.messageCount} msgs)` : ''}`, icon: '🗜️', action: () => handleCompact(conv.id, e as any) },
                  { divider: true, label: '', action: () => {} },
                  ...TAG_OPTIONS.map(t => ({
                    label: `${(conv.tags || []).includes(t.name) ? '✓ ' : ''}${t.name}`,
                    icon: '🏷️',
                    action: () => handleToggleTag(conv.id, t.name),
                  })),
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
                      {compactStatus[conv.id] && (
                        <div className={`conv-compact-status ${compactStatus[conv.id] === 'done' ? 'success' : compactStatus[conv.id] === 'compacting' ? 'pending' : 'info'}`}>
                          {compactStatus[conv.id] === 'compacting' ? '⏳ Compacting...' :
                           compactStatus[conv.id] === 'done' ? '✅ Compacted' :
                           compactStatus[conv.id] === 'too-few' ? 'ℹ️ <20 messages, nothing to compact' :
                           `❌ ${compactStatus[conv.id]}`}
                        </div>
                      )}
                      {conv.tags && conv.tags.length > 0 && (
                        <div className="conv-tags">
                          {conv.tags.map(tag => (
                            <span key={tag} className={`conv-tag conv-tag-${tag.toLowerCase()}`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
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
                        aria-label={`Rename ${conv.title}`}
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
                        className="archive-btn"
                        onClick={(e) => handleArchive(conv.id, e)}
                        title={conv.archived ? 'Restore' : 'Archive'}
                        aria-label={conv.archived ? `Restore ${conv.title}` : `Archive ${conv.title}`}
                      >
                        📦
                      </button>
                      <button
                        className="delete-btn"
                        onClick={(e) => handleDelete(conv.id, e)}
                        title="Delete"
                        aria-label={`Delete ${conv.title}`}
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
