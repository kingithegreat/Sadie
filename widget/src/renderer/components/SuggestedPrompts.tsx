import React, { useEffect, useState } from 'react';

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
}

/**
 * Suggested prompts shown in the empty-chat state.
 *
 * Organised into capability categories so new users immediately see
 * what HomeBot can do beyond basic chat.  Each bucket is sampled once
 * per render so users see variety across sessions.
 *
 * For returning users, recent conversation history is used instead.
 */
const PROMPT_BUCKETS: Record<string, string[]> = {
  files: [
    "What files are on my Desktop?",
    "Show me the biggest files in my Downloads folder",
    "Read and summarize ~/Documents/notes.txt",
    "Create a new file on my Desktop called ideas.md",
    "Search my project for all TODO comments",
  ],
  code: [
    "Write a Python script to rename all .jpg files in a folder",
    "Debug this error: [paste your error here]",
    "Show git status for my current project",
    "Run npm test in my project folder",
    "Explain this code and suggest improvements: [paste code]",
  ],
  web: [
    "Search the web for the latest AI news",
    "What's the weather right now?",
    "What's happening in the news today?",
    "Look up the latest React 19 features",
    "Fetch and summarize this URL: [paste link]",
  ],
  productivity: [
    "Remind me to send the invoice at 5pm",
    "What's on my calendar today?",
    "Read my clipboard and help me improve it",
    "Draft a professional email declining a meeting",
    "Summarise this PDF: [drag file here]",
  ],
  creative: [
    "Generate an image of a futuristic city at sunset",
    "Write a short bio for my LinkedIn profile",
    "Brainstorm 10 names for my new app",
    "Turn these bullet points into a polished paragraph: [paste bullets]",
    "Write unit tests for this function: [paste code]",
  ],
  system: [
    "What processes are using the most CPU right now?",
    "Show me my system specs",
    "Open Spotify",
    "Take a screenshot and tell me what's on screen",
    "What's in my clipboard?",
  ],
};

const ALL_DEFAULTS = Object.values(PROMPT_BUCKETS).flat();

/**
 * Pick one prompt at random from each bucket, then shuffle to avoid
 * always leading with the same category.
 */
function pickDefaultPrompts(count = 5): string[] {
  const buckets = Object.values(PROMPT_BUCKETS);
  // One from each bucket (shuffled within bucket), then flatten + re-shuffle
  const picked = buckets
    .map(bucket => bucket[Math.floor(Math.random() * bucket.length)])
    .sort(() => Math.random() - 0.5);
  return picked.slice(0, count);
}

/**
 * Derives suggested prompts from recent conversation history.
 * Falls back to bucketed default prompts for new users.
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

          // Extract recent user messages across the last 10 conversations
          const userMessages: string[] = [];
          for (const conv of sorted.slice(0, 10)) {
            if (!conv.messages) continue;
            for (const msg of conv.messages) {
              if (msg.role === 'user' && msg.content?.trim()) {
                const text = msg.content.trim();
                // Skip very short, very long, or file-path-only messages
                if (text.length >= 12 && text.length <= 120 && !text.startsWith('/')) {
                  userMessages.push(text);
                }
              }
            }
          }

          // Deduplicate and pick diverse ones
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

        // Fallback: bucketed defaults for new users (variety across categories)
        if (mounted) {
          setSuggestions(pickDefaultPrompts(5));
        }
      } catch {
        if (mounted) {
          setSuggestions(pickDefaultPrompts(5));
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
            type="button"
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
export { PROMPT_BUCKETS, ALL_DEFAULTS, pickDefaultPrompts };
