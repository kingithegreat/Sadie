/**
 * G-3 (issue #229) — regression guard for per-test-file isolation.
 *
 * Suites resolve settings through `app.getPath('userData')`, which the electron
 * mocks map to `os.tmpdir()`. When that was a shared, run-wide directory, one file's
 * saved settings were visible to the next file in the run: a file that changed a
 * setting changed the behaviour of whichever suite ran after it, and since jest
 * picks file order from cached durations, the victim moved between runs. Two probe
 * files proved it by driving the real `config-manager`: a marker one file wrote was
 * read by the other.
 *
 * If someone removes the harness isolation in `setupTests.ts`, these assertions fail
 * rather than the suite quietly going back to sharing state.
 */
jest.mock('electron', () => {
  const os = require('os');
  return {
    app: { getPath: () => os.tmpdir(), isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => value,
      decryptString: (value: string) => value,
    },
  };
});

import * as os from 'node:os';
import { getSettingsPath } from '../config-manager';

describe('per-file test isolation (G-3)', () => {
  test('this test file runs against its own temp root, not a run-wide shared one', () => {
    expect(os.tmpdir()).toContain('homebot-jest-tmp');
  });

  test('settings resolve inside that root, so a save cannot reach another suite', () => {
    const settingsPath = getSettingsPath();
    expect(settingsPath.startsWith(os.tmpdir())).toBe(true);
    expect(settingsPath.endsWith('user-settings.json')).toBe(true);
  });
});
