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
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Available Tools"
        style={{ maxHeight: '80vh', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        tabIndex={-1}
      >
        <div className="settings-header">
          <h2 style={{ margin: 0, fontSize: 15 }}>🔧 Available Tools ({tools.length})</h2>
          <button className="close-button" onClick={onClose} aria-label="Close tools panel">✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px 0' }}>
          <input
            className="setting-input"
            style={{ width: '100%' }}
            placeholder="Search tools…"
            aria-label="Search tools"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px' }}>
          {loading && <p style={{ color: '#888', fontSize: 13 }}>Loading tools…</p>}
          {error && <p style={{ color: '#ff3b30', fontSize: 13 }}>{error}</p>}

          {!loading && filtered.length === 0 && (
            <p style={{ color: '#888', fontSize: 13 }}>No tools match "{search}"</p>
          )}

          {categories.map(cat => (
            <div key={cat} style={{ marginBottom: 8 }}>
              {/* Category header */}
              <button
                onClick={() => toggleCat(cat)}
                aria-expanded={expandedCats.has(cat)}
                aria-controls={`tools-cat-${cat}`}
                aria-label={`${prettyCat(cat)} tools, ${grouped[cat].length} tool${grouped[cat].length === 1 ? '' : 's'}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#a1a1aa', fontSize: 11, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  padding: '4px 0', marginBottom: 4,
                }}
              >
                <span>{categoryIcon(cat)}</span>
                <span>{prettyCat(cat)}</span>
                <span style={{ color: '#52525b', marginLeft: 4 }}>({grouped[cat].length})</span>
                <span style={{ marginLeft: 'auto' }}>{expandedCats.has(cat) ? '▾' : '▸'}</span>
              </button>

              {/* Tool cards */}
              {expandedCats.has(cat) && (
                <div id={`tools-cat-${cat}`} role="list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {grouped[cat].map(tool => (
                    <div
                      key={tool.name}
                      role="listitem"
                      tabIndex={0}
                      style={{
                        background: '#111', border: '1px solid #27272a',
                        borderRadius: 8, padding: '8px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <code style={{ fontSize: 12, color: '#22d3ee', fontFamily: 'monospace' }}>
                          {tool.name}
                        </code>
                      </div>
                      <p style={{ margin: '3px 0 0', fontSize: 12, color: '#a1a1aa', lineHeight: 1.4 }}>
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
