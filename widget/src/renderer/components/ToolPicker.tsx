import React, { useState, useEffect, useRef } from 'react';

// Tool categories and their tools
const TOOL_CATEGORIES = {
  'Time & Info': [
    { id: 'get_current_time', name: 'Current Time', icon: '🕐', description: 'Get the current time' },
    { id: 'get_weather', name: 'Weather', icon: '🌤️', description: 'Get weather information' },
    { id: 'get_system_info', name: 'System Info', icon: '💻', description: 'Get system information' },
  ],
  'Files': [
    { id: 'list_directory', name: 'List Files', icon: '📁', description: 'List files in a directory' },
    { id: 'read_file', name: 'Read File', icon: '📄', description: 'Read file contents' },
    { id: 'write_file', name: 'Write File', icon: '✏️', description: 'Write to a file' },
    { id: 'get_file_info', name: 'File Info', icon: 'ℹ️', description: 'Get file information' },
  ],
  'Web': [
    { id: 'web_search', name: 'Web Search', icon: '🔍', description: 'Search the web' },
    { id: 'fetch_url', name: 'Fetch URL', icon: '🌐', description: 'Fetch content from a URL' },
    { id: 'open_url', name: 'Open URL', icon: '🔗', description: 'Open a URL in browser' },
  ],
  'Clipboard': [
    { id: 'get_clipboard', name: 'Get Clipboard', icon: '📋', description: 'Get clipboard contents' },
    { id: 'set_clipboard', name: 'Set Clipboard', icon: '📝', description: 'Copy text to clipboard' },
  ],
  'Memory': [
    { id: 'remember', name: 'Remember', icon: '🧠', description: 'Save something to memory' },
    { id: 'recall', name: 'Recall', icon: '💭', description: 'Recall from memory' },
    { id: 'list_memories', name: 'List Memories', icon: '📚', description: 'Show all memories' },
  ],
  'Utilities': [
    { id: 'calculate', name: 'Calculate', icon: '🔢', description: 'Perform calculations' },
    { id: 'screenshot', name: 'Screenshot', icon: '📸', description: 'Take a screenshot' },
    { id: 'launch_app', name: 'Launch App', icon: '🚀', description: 'Launch an application' },
  ],
  'Voice': [
    { id: 'speak', name: 'Speak', icon: '🔊', description: 'Text to speech' },
    { id: 'stop_speaking', name: 'Stop', icon: '🔇', description: 'Stop speaking' },
  ],
  'Sports': [
    { id: 'nba_query', name: 'NBA Stats', icon: '🏀', description: 'Get NBA information' },
    { id: 'generate_sports_report', name: 'Sports Report', icon: '📊', description: 'Generate sports report' },
  ],
};

interface ToolPickerProps {
  onSelectTool: (toolId: string, toolName: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function ToolPicker({ onSelectTool, isOpen, onClose }: ToolPickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const categories = Object.keys(TOOL_CATEGORIES);

  return (
    <div className="tool-picker-overlay">
      <div className="tool-picker" ref={pickerRef}>
        <div className="tool-picker-header">
          <h3>🛠️ Select a Tool</h3>
          <button className="tool-picker-close" onClick={onClose}>×</button>
        </div>
        
        <div className="tool-picker-content">
          {/* Category tabs */}
          <div className="tool-picker-categories">
            {categories.map(cat => (
              <button
                key={cat}
                className={`tool-category-btn ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Tool grid */}
          <div className="tool-picker-grid">
            {(selectedCategory ? [selectedCategory] : categories).map(cat => (
              <div key={cat} className="tool-category-section">
                {!selectedCategory && <div className="tool-category-title">{cat}</div>}
                <div className="tool-items">
                  {TOOL_CATEGORIES[cat as keyof typeof TOOL_CATEGORIES].map(tool => (
                    <button
                      key={tool.id}
                      className="tool-item"
                      onClick={() => {
                        onSelectTool(tool.id, tool.name);
                        onClose();
                      }}
                      title={tool.description}
                    >
                      <span className="tool-icon">{tool.icon}</span>
                      <span className="tool-name">{tool.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ToolPicker;
