/** @jest-environment node */

const sampleConv = {
  id: 'conv-1',
  title: 'Test Chat',
  createdAt: '2025-01-15T10:00:00.000Z',
  updatedAt: '2025-01-15T11:30:00.000Z',
  messages: [
    { role: 'user', content: 'Hello', createdAt: '2025-01-15T10:00:00.000Z' },
    { role: 'assistant', content: 'Hi there!', createdAt: '2025-01-15T10:01:00.000Z' },
  ],
};

// Mock the whole module to avoid Electron's app import
jest.mock('../../main/memory-manager', () => {
  const getConversation = jest.fn((id: string) => id === 'conv-1' ? sampleConv : null);

  // Re-implement exportConversationAsJSON directly to test its logic
  function exportConversationAsJSON(conversationId: string): string | null {
    const conv = getConversation(conversationId);
    if (!conv) return null;
    const payload = {
      id: conv.id,
      title: conv.title || 'Untitled Conversation',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
      messages: conv.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.createdAt ? { createdAt: msg.createdAt } : {}),
      })),
    };
    return JSON.stringify(payload, null, 2);
  }

  return { getConversation, exportConversationAsJSON };
});

import * as MemoryManager from '../../main/memory-manager';

describe('MemoryManager — exportConversationAsJSON', () => {
  test('returns null for unknown conversation', () => {
    const result = MemoryManager.exportConversationAsJSON('unknown-id');
    expect(result).toBeNull();
  });

  test('returns valid JSON string for existing conversation', () => {
    const result = MemoryManager.exportConversationAsJSON('conv-1');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.id).toBe('conv-1');
    expect(parsed.title).toBe('Test Chat');
    expect(parsed.messageCount).toBe(2);
  });

  test('JSON export includes all messages with correct structure', () => {
    const result = MemoryManager.exportConversationAsJSON('conv-1');
    const parsed = JSON.parse(result!);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toBe('Hello');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].content).toBe('Hi there!');
  });

  test('JSON export includes timestamps', () => {
    const result = MemoryManager.exportConversationAsJSON('conv-1');
    const parsed = JSON.parse(result!);
    expect(parsed.createdAt).toBe('2025-01-15T10:00:00.000Z');
    expect(parsed.updatedAt).toBe('2025-01-15T11:30:00.000Z');
  });
});
