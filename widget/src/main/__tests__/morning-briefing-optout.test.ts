/**
 * The opt-out branch of shouldOfferBriefing.
 *
 * `morning-briefing.ts` has honoured `settings.morningBriefing === false` since
 * it was written — its own header says so — but nothing could ever write that
 * value, so the branch was unreachable in production AND untested: the existing
 * suite mocks `getSettings` as `{ morningBriefing: true }` and only ever
 * exercises the ON path.
 *
 * A separate file because the config mock is module-level, and this needs the
 * opposite value.
 */

jest.mock('../tools', () => ({
  executeToolBatch: jest.fn().mockResolvedValue([]),
  ToolCall: {},
  ToolContext: {},
}));

let mockSettings: Record<string, unknown> = {};
jest.mock('../config-manager', () => ({
  getSettings: () => mockSettings,
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

import { shouldOfferBriefing } from '../morning-briefing';

describe('shouldOfferBriefing respects the opt-out', () => {
  test('false switches the briefing off', () => {
    mockSettings = { morningBriefing: false };
    expect(shouldOfferBriefing()).toBe(false);
  });

  test('undefined leaves it ON — absent is not opted out', () => {
    // The check is `=== false`, so a fresh install with no such key keeps the
    // behaviour it has always had. The Settings checkbox agrees, and has its
    // own test saying so.
    mockSettings = {};
    expect(shouldOfferBriefing()).toBe(true);
  });

  test('true leaves it on', () => {
    mockSettings = { morningBriefing: true };
    expect(shouldOfferBriefing()).toBe(true);
  });

  test('only a strict false counts — a falsy value is not an opt-out', () => {
    // Guards the `=== false` against being loosened to a truthiness check,
    // which would make 0, '' or null silently disable the feature.
    for (const value of [0, '', null]) {
      mockSettings = { morningBriefing: value };
      expect(shouldOfferBriefing()).toBe(true);
    }
  });
});
