import React, { useState, useEffect, useCallback } from 'react';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
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

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const result = await (window as any).electron.loadConversations?.();
      if (result?.success && result.data?.conversations) {
        const convList = Object.values(result.data.conversations) as Conversation[];
        // Sort by updatedAt descending
        convList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      onDeleteConversation(id);
      // Remove from local state
      setConversations(prev => prev.filter(c => c.id !== id));
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
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="sidebar-backdrop" onClick={onClose} />
      
      {/* Sidebar */}
      <div className="conversation-sidebar">
        <div className="sidebar-header">
          <h2>Conversations</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <button className="new-chat-btn" onClick={onNewConversation}>
          <span className="icon">+</span>
          New Chat
        </button>
        
        <div className="conversations-list">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="empty">No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                onClick={() => {
                  onSelectConversation(conv.id);
                  onClose();
                }}
              >
                {editingId === conv.id ? (
                  <input
                    className="edit-title-input"
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
                      <div className="conv-meta">
                        {conv.messageCount || 0} messages · {formatDate(conv.updatedAt)}
                      </div>
                    </div>
                    <div className="conv-actions">
                      <button 
                        className="edit-btn" 
                        onClick={(e) => handleStartEdit(conv.id, conv.title, e)}
                        title="Rename"
                      >
                        ✏️
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
    </>
  );
};

export default ConversationSidebar;
