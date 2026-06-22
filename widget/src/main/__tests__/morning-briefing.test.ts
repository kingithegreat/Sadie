// Mock the heavy tool chain before importing the module under test
jest.mock('../tools', () => ({
  executeToolBatch: jest.fn().mockResolvedValue([]),
  ToolCall: {},
  ToolContext: {},
}));

jest.mock('../config-manager', () => ({
  getSettings: () => ({ morningBriefing: true }),
}));

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(() => { throw new Error('not found'); }),
  writeFileSync: jest.fn(),
  writeFile: jest.fn((_p: string, _d: string, _e: string, cb: Function) => cb(null)),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(() => []),
}));

import { shouldOfferBriefing, markBriefingDelivered, generateBriefing } from '../morning-briefing';

describe('morning-briefing', () => {
  describe('shouldOfferBriefing', () => {
    test('returns true on first call of the day', () => {
      expect(shouldOfferBriefing()).toBe(true);
    });

    test('returns false after markBriefingDelivered', () => {
      markBriefingDelivered();
      expect(shouldOfferBriefing()).toBe(false);
    });
  });

  describe('generateBriefing', () => {
    test('returns a briefing even when tools return no data', async () => {
      const result = await generateBriefing();
      expect(typeof result).toBe('string');
      expect(result).toContain('Tip of the Day');
    });

    test('returns formatted markdown when tools return data', async () => {
      const { executeToolBatch } = require('../tools');
      (executeToolBatch as jest.Mock).mockResolvedValueOnce([
        { success: true, result: { temperature: { celsius: '18°C' }, condition: 'Partly cloudy', location: 'Auckland' } },
        { success: true, result: { events: [{ title: 'Team standup', start: new Date().toISOString() }] } },
        { success: true, result: { reminders: [{ message: 'Buy milk', fireAt: new Date().toISOString() }] } },
      ]);

      const result = await generateBriefing();
      expect(result).not.toBeNull();
      expect(result).toContain('Weather');
      expect(result).toContain('Events');
      expect(result).toContain('Reminders');
      expect(result).toContain('Team standup');
      expect(result).toContain('Buy milk');
    });
  });
});
