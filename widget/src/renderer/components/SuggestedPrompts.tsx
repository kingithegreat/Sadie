import React, { useEffect, useState } from 'react';

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
}

const DEFAULT_PROMPTS = [
  'What can you help me with?',
  'Summarize my recent files',
  'What is the weather today?',
  'Help me write an email',
  'Search the web for latest news',
];

/**
 * Derives suggested prompts from recent conversation history.
 * Falls back to default prompts for new users.
 */
const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({ onSelect }) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const result = await (window as any).electron?.loadConversations?.();
        if (!mounted) return;

        if (result?.success && result.data?.conversations?.length) {
          const convs = result.data.conversations as Array<{
            messages?: Array<{ role: string; content: string }>;
            updatedAt?: string;
          }>;

          // Sort by most recently updated
          const sorted = [...convs].sort((a, b) =>
            (b.updatedAt || '').localeCompare(a.updatedAt || '')
          );

          // Extract recent user messages across conversations
          const userMessages: string[] = [];
          for (const conv of sorted.slice(0, 10)) {
            if (!conv.messages) continue;
            for (const msg of conv.messages) {
              if (msg.role === 'user' && msg.content?.trim()) {
                const text = msg.content.trim();
                // Skip very short or very long messages
                if (text.length >= 10 && text.length <= 120) {
                  userMessages.push(text);
                }
              }
            }
          }

          // Deduplicate by lowercase and pick diverse ones
          const seen = new Set<string>();
          const unique: string[] = [];
          for (const msg of userMessages) {
            const key = msg.toLowerCase().slice(0, 50);
            if (!seen.has(key)) {
              seen.add(key);
              unique.push(msg);
            }
            if (unique.length >= 8) break;
          }

          if (unique.length >= 3) {
            // Shuffle and pick 4-5
            const shuffled = unique.sort(() => Math.random() - 0.5);
            setSuggestions(shuffled.slice(0, 5));
            return;
          }
        }

        // Fallback: default prompts for new users
        if (mounted) {
          const shuffled = [...DEFAULT_PROMPTS].sort(() => Math.random() - 0.5);
          setSuggestions(shuffled.slice(0, 4));
        }
      } catch {
        if (mounted) {
          setSuggestions(DEFAULT_PROMPTS.slice(0, 4));
        }
      }
    })();

    return () => { mounted = false; };
  }, []);

  if (suggestions.length === 0) return null;

  return (
    <div className="suggested-prompts">
      <span className="suggested-label">Try asking:</span>
      <div className="suggested-pills">
        {suggestions.map((prompt, i) => (
          <button
            key={i}
            className="suggested-pill"
            onClick={() => onSelect(prompt)}
            title={prompt}
          >
            {prompt.length > 50 ? prompt.slice(0, 47) + '…' : prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestedPrompts;
