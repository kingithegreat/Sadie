import os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron before any imports so memory-manager uses the temp userData path
jest.mock('electron', () => ({
  app: { isPackaged: true, getPath: jest.fn(() => process.env.TEST_USERDATA || os.tmpdir()) }
}));

import { createNewConversation, getConversation, saveConversation, __flushWritesSync } from '../memory-manager';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-mm-test-'));
  process.env.TEST_USERDATA = tmpDir;
});

afterAll(() => {
  delete process.env.TEST_USERDATA;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

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
    __flushWritesSync(); // flush queued async writes before reading back

    const reloaded = getConversation(conv.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.systemPrompt).toBe('You are a friendly assistant that replies in haiku.');
  });
});
