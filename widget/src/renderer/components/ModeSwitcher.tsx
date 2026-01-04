import React from 'react';
import { MessageSquare, Workflow } from 'lucide-react';
import { useModeStore, AppMode } from '../stores/mode-store';

export function ModeSwitcher() {
  const { mode, setMode } = useModeStore();

  const modes = [
    {
      id: 'chat' as AppMode,
      label: 'Chat',
      icon: MessageSquare,
      description: 'General AI assistant',
    },
    {
      id: 'n8n' as AppMode,
      label: 'N8N Automation',
      icon: Workflow,
      description: 'Build workflows with AI',
    },
  ];

  return (
    <div className="mode-switcher">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          className={`mode-button ${mode === m.id ? 'active' : ''}`}
          title={m.description}
        >
          <m.icon size={20} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}