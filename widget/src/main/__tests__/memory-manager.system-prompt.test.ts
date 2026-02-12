// Mock a minimal electron.app for the memory-manager (app.isPackaged may be accessed)
jest.mock('electron', () => ({
  app: { isPackaged: false, getPath: jest.fn(() => process.env.TEST_USERDATA || '') }
}));

import { createNewConversation, getConversation, saveConversation } from '../memory-manager';

describe('memory-manager conversation systemPrompt', () => {
  test('createNewConversation includes empty systemPrompt by default and can be persisted', () => {
    const conv = createNewConversation('sys-prompt-test');
    expect(conv).toBeDefined();
    expect(conv.systemPrompt).toBeDefined();
    expect(conv.systemPrompt).toBe('');

    // Update and save
    conv.systemPrompt = 'You are a friendly assistant that replies in haiku.';
    const saved = saveConversation(conv);
    expect(saved).toBe(true);

    const reloaded = getConversation(conv.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.systemPrompt).toBe('You are a friendly assistant that replies in haiku.');
  });
});
