// Integration test: ensure messages persist to conversation-history.json via MemoryManager
import os from 'os';

jest.mock('electron', () => ({
  app: { isPackaged: true, getPath: jest.fn(() => process.env.TEST_USERDATA || os.tmpdir()) }
}));

import { createNewConversation, addMessageToConversation, getConversation, __flushWritesSync } from '../memory-manager';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'homebot-persist-test-'));
  process.env.TEST_USERDATA = tmpDir;
});

afterAll(() => {
  delete process.env.TEST_USERDATA;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

describe('persistence integration', () => {
  test('create conversation and add message persists to disk', () => {
    const conv = createNewConversation('persistence-test');
    expect(conv).toBeDefined();
    __flushWritesSync(); // flush createNewConversation writes before reading back

    const msg = { id: 'm1', role: 'user', content: 'hello persistence', timestamp: new Date().toISOString() } as any;
    const ok = addMessageToConversation(conv.id, msg);
    expect(ok).toBe(true);
    __flushWritesSync(); // flush addMessage writes before reading back

    const reloaded = getConversation(conv.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.messages.length).toBeGreaterThan(0);
    expect(reloaded!.messages.find(m => m.id === 'm1')).toBeDefined();

    // Verify on-disk file updated
    const base = process.env.TEST_USERDATA || '';
    const file = join(base, 'memory', 'json-store', 'conversation-history.json');
    if (existsSync(file)) {
      const content = JSON.parse(readFileSync(file, 'utf-8'));
      const found = (content.conversations || []).find((c: any) => c.id === conv.id);
      expect(found).toBeDefined();
      expect(Array.isArray(found.messages)).toBe(true);
      expect(found.messages.find((m: any) => m.id === 'm1')).toBeDefined();
    }
  });
});