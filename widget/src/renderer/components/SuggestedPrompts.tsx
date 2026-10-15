import React from 'react';

interface SuggestedPromptsProps {
  /** Prepare an editable draft; the composer owns the user's explicit Send. */
  onSelect: (prompt: string) => void;
}

const STARTER_PROMPTS = [
  { label: 'Draft a message', prompt: 'Help me draft a short, polite message. Ask me who it is for and what I want to say.' },
  { label: 'Explain something', prompt: 'Help me understand a topic in plain language. Ask me what I want explained.' },
  { label: 'Plan a task', prompt: 'Help me plan a task step by step. Ask me what I want to achieve.' },
  { label: 'Brainstorm ideas', prompt: 'Help me brainstorm ideas. Ask me what I am working on.' },
] as const;

/** Stable starting points that need no files, account or connected service. */
const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({ onSelect }) => (
  <div className="suggested-prompts">
    <span className="suggested-label">Choose a starting point. Edit it before you send.</span>
    <div className="suggested-pills">
      {STARTER_PROMPTS.map(({ label, prompt }) => (
        <button
          type="button"
          key={label}
          className="suggested-pill"
          onClick={() => onSelect(prompt)}
          title={prompt}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
);

export default SuggestedPrompts;
export { STARTER_PROMPTS };
