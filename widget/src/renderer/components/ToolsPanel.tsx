import React, { useState, useEffect } from 'react';

interface Tool {
  name: string;
  description: string;
  category: string;
}

interface ToolsPanelProps {
  onClose: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  filesystem: '📁',
  web: '🌐',
  system: '⚙️',
  memory: '🧠',
  voice: '🎤',
  document: '📄',
  sports: '🏀',
  utility: '🔧',
  notification: '🔔',
  code: '💻',
  reminder: '⏰',
  process: '⚡',
  contacts: '👤',
  news: '📰',
  git: '🗂️',
  diff: '📊',
  image: '🖼️',
  automation: '🤖',
};

function categoryIcon(cat: string) {
  return CATEGORY_ICONS[cat.toLowerCase()] || '🔧';
}

function prettyCat(cat: string) {
  return cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');
}

const ToolsPanel: React.FC<ToolsPanelProps> = ({ onClose }) => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const result = await (window as any).electron?.listTools?.();
        if (result?.success && result.tools) {
          setTools(result.tools);
          // Expand all categories by default
          const cats = new Set<string>(result.tools.map((t: Tool) => t.category));
          setExpandedCats(cats);
        } else {
          setError(result?.error || 'Failed to load tools');
        }
      } catch (e: any) {
        setError(e.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = search.trim()
    ? tools.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        t.category.toLowerCase().includes(search.toLowerCase())
      )
    : tools;

  // Group by category
  const grouped: Record<string, Tool[]> = {};
  for (const t of filtered) {
    const cat = t.category || 'utility';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }
  const categories = Object.keys(grouped).sort();

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      <div
        className="settings-panel tools-panel-col"
        role="dialog"
        aria-modal="true"
        aria-label="Available Tools"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        tabIndex={-1}
      >
        <div className="settings-header">
          <h2 className="tools-panel-title">🔧 Available Tools ({tools.length})</h2>
          <button className="close-button" onClick={onClose} aria-label="Close tools panel">✕</button>
        </div>

        {/* Search */}
        <div className="tools-search-bar">
          <input
            className="setting-input tools-search-input"
            placeholder="Search tools…"
            aria-label="Search tools"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="tools-list-body">
          {loading && <p className="tools-hint">Loading tools…</p>}
          {error && <p className="tools-error">{error}</p>}

          {!loading && filtered.length === 0 && (
            <p className="tools-hint">No tools match "{search}"</p>
          )}

          {categories.map(cat => (
            <div key={cat} className="tools-cat-group">
              {/* Category header */}
              <button
                onClick={() => toggleCat(cat)}
                aria-expanded={expandedCats.has(cat)}
                aria-controls={`tools-cat-${cat}`}
                aria-label={`${prettyCat(cat)} tools, ${grouped[cat].length} tool${grouped[cat].length === 1 ? '' : 's'}`}
                className="tools-cat-btn"
              >
                <span>{categoryIcon(cat)}</span>
                <span>{prettyCat(cat)}</span>
                <span className="tools-cat-count">({grouped[cat].length})</span>
                <span className="tools-cat-arrow">{expandedCats.has(cat) ? '▾' : '▸'}</span>
              </button>

              {/* Tool cards */}
              {expandedCats.has(cat) && (
                <div id={`tools-cat-${cat}`} role="list" className="tools-card-list">
                  {grouped[cat].map(tool => (
                    <div
                      key={tool.name}
                      role="listitem"
                      tabIndex={0}
                      className="tools-card"
                    >
                      <div className="tools-card-header">
                        <code className="tools-card-name">
                          {tool.name}
                        </code>
                      </div>
                      <p className="tools-card-desc">
                        {tool.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ToolsPanel;
