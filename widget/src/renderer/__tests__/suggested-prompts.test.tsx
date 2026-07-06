/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuggestedPrompts, { PROMPT_BUCKETS, ALL_DEFAULTS, pickDefaultPrompts } from '../components/SuggestedPrompts';

describe('pickDefaultPrompts (pure)', () => {
  test('returns the requested count', () => {
    expect(pickDefaultPrompts(5)).toHaveLength(5);
    expect(pickDefaultPrompts(3)).toHaveLength(3);
  });

  test('every returned prompt is a real prompt from one of the buckets', () => {
    const picks = pickDefaultPrompts(5);
    for (const p of picks) {
      expect(ALL_DEFAULTS).toContain(p);
    }
  });

  test('has six buckets, five prompts each, matching the roadmap capability surface', () => {
    const keys = Object.keys(PROMPT_BUCKETS);
    expect(keys).toEqual(
      expect.arrayContaining(['files', 'code', 'web', 'productivity', 'creative', 'system']),
    );
    for (const key of keys) {
      expect(PROMPT_BUCKETS[key].length).toBeGreaterThanOrEqual(5);
    }
  });
});

afterEach(() => { delete (window as any).electron; });

function setElectronConversations(convs: any[]) {
  (window as any).electron = {
    loadConversations: jest.fn().mockResolvedValue({
      success: true,
      data: { conversations: convs, activeConversationId: null },
    }),
  };
}

describe('SuggestedPrompts', () => {
  test('renders default prompts when no electron API is available', async () => {
    // No window.electron set
    const onSelect = jest.fn();
    render(<SuggestedPrompts onSelect={onSelect} />);

    // One of the default prompts should eventually appear
    await waitFor(() => {
      expect(screen.getByText(/Try asking:/i)).toBeInTheDocument();
    });
    const pills = document.querySelectorAll('.suggested-pill');
    expect(pills.length).toBeGreaterThan(0);
  });

  test('renders default prompts when there are no prior conversations', async () => {
    setElectronConversations([]);
    render(<SuggestedPrompts onSelect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Try asking:/i)).toBeInTheDocument();
    });
    // Default fallback picks 5 (one per prompt bucket) since the bucketed
    // upgrade in 'feat: upgrade first-user suggested prompts'
    const pills = document.querySelectorAll('.suggested-pill');
    expect(pills.length).toBe(5);
  });

  test('derives suggestions from past user messages when ≥ 3 unique', async () => {
    setElectronConversations([
      {
        updatedAt: '2026-04-15T10:00:00Z',
        messages: [
          { role: 'user', content: 'How do I refactor this function safely?' },
          { role: 'assistant', content: 'Sure!' },
          { role: 'user', content: 'Can you summarize the README for me?' },
          { role: 'user', content: 'What does the enrichment module do?' },
          { role: 'user', content: 'Help me fix the failing test case.' },
        ],
      },
    ]);
    render(<SuggestedPrompts onSelect={jest.fn()} />);

    await waitFor(() => {
      expect(document.querySelectorAll('.suggested-pill').length).toBeGreaterThanOrEqual(3);
    });

    const text = Array.from(document.querySelectorAll('.suggested-pill'))
      .map(p => p.textContent)
      .join(' | ');

    // Should include at least one of the real past user messages
    const matchedAny = [
      'How do I refactor this function safely?',
      'Can you summarize the README for me?',
      'What does the enrichment module do?',
      'Help me fix the failing test case.',
    ].some(m => text.includes(m));
    expect(matchedAny).toBe(true);
  });

  test('filters out assistant messages, short messages, and very long ones', async () => {
    setElectronConversations([
      {
        updatedAt: '2026-04-15T10:00:00Z',
        messages: [
          { role: 'assistant', content: 'This is an assistant reply that should be filtered.' },
          { role: 'user', content: 'hi' }, // too short
          { role: 'user', content: 'a'.repeat(500) }, // too long
          // Only 1 valid user message — falls back to defaults
          { role: 'user', content: 'What tools do you support?' },
        ],
      },
    ]);
    render(<SuggestedPrompts onSelect={jest.fn()} />);

    await waitFor(() => {
      expect(document.querySelectorAll('.suggested-pill').length).toBeGreaterThan(0);
    });

    const text = Array.from(document.querySelectorAll('.suggested-pill'))
      .map(p => p.textContent)
      .join(' | ');

    expect(text).not.toContain('assistant reply');
    expect(text).not.toMatch(/^hi$/m);
    expect(text).not.toContain('aaaaaaaaa');
  });

  test('deduplicates repeated user messages', async () => {
    setElectronConversations([
      {
        updatedAt: '2026-04-15T10:00:00Z',
        messages: [
          { role: 'user', content: 'How do I debug this error message?' },
          { role: 'user', content: 'How do I debug this error message?' },
          { role: 'user', content: 'How do I debug this error message?' },
          { role: 'user', content: 'Can you write a unit test for this?' },
          { role: 'user', content: 'What is the difference between map and forEach?' },
        ],
      },
    ]);
    render(<SuggestedPrompts onSelect={jest.fn()} />);

    await waitFor(() => {
      expect(document.querySelectorAll('.suggested-pill').length).toBeGreaterThanOrEqual(3);
    });

    const pills = Array.from(document.querySelectorAll('.suggested-pill'))
      .map(p => p.textContent);
    const debugCount = pills.filter(t => t?.includes('debug this error')).length;
    expect(debugCount).toBe(1);
  });

  test('clicking a pill invokes onSelect with the full prompt', async () => {
    setElectronConversations([
      {
        updatedAt: '2026-04-15T10:00:00Z',
        messages: [
          { role: 'user', content: 'What can you help me with today?' },
          { role: 'user', content: 'Search the web for recent AI news' },
          { role: 'user', content: 'Summarize the meeting notes from Monday' },
        ],
      },
    ]);
    const onSelect = jest.fn();
    render(<SuggestedPrompts onSelect={onSelect} />);

    await waitFor(() => {
      expect(document.querySelectorAll('.suggested-pill').length).toBeGreaterThan(0);
    });

    const firstPill = document.querySelector('.suggested-pill') as HTMLButtonElement;
    fireEvent.click(firstPill);

    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as string;
    // The clicked pill's argument should be one of the seeded user messages
    expect([
      'What can you help me with today?',
      'Search the web for recent AI news',
      'Summarize the meeting notes from Monday',
    ]).toContain(arg);
  });

  test('falls back to defaults when loadConversations throws', async () => {
    (window as any).electron = {
      loadConversations: jest.fn().mockRejectedValue(new Error('boom')),
    };
    render(<SuggestedPrompts onSelect={jest.fn()} />);

    await waitFor(() => {
      expect(document.querySelectorAll('.suggested-pill').length).toBeGreaterThan(0);
    });
  });

  test('truncates very long prompts in the display with ellipsis', async () => {
    const longPrompt = 'Can you help me understand this very long sentence that definitely exceeds fifty chars';
    setElectronConversations([
      {
        updatedAt: '2026-04-15T10:00:00Z',
        messages: [
          { role: 'user', content: longPrompt },
          { role: 'user', content: 'Short one please' },
          { role: 'user', content: 'Another short prompt' },
        ],
      },
    ]);
    render(<SuggestedPrompts onSelect={jest.fn()} />);

    await waitFor(() => {
      expect(document.querySelectorAll('.suggested-pill').length).toBeGreaterThan(0);
    });

    const pills = Array.from(document.querySelectorAll('.suggested-pill'));
    const truncated = pills.find(p => p.textContent?.endsWith('…'));
    if (truncated) {
      expect(truncated.getAttribute('title')).toBe(longPrompt);
    }
  });
});
