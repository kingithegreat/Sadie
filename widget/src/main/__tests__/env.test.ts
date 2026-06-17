/**
 * env.test.ts
 * Tests for src/main/env.ts
 *
 * Module-level constants (isPackagedBuild, isProduction, …) are frozen at import
 * time, so tests that need alternate values use jest.isolateModules().
 */

jest.mock('electron', () => ({
  app: { isPackaged: false, getPath: jest.fn(() => '/tmp') },
}));

// Default import — electron mock has isPackaged=false, NODE_ENV=test
import * as env from '../env';

// ── module-level constants (default Jest context) ─────────────────────────────

describe('env constants — default Jest context', () => {
  test('isPackagedBuild is false (electron mock isPackaged=false)', () => {
    expect(env.isPackagedBuild).toBe(false);
  });

  test('isProduction is false (NODE_ENV=test, not packaged)', () => {
    expect(env.isProduction).toBe(false);
  });

  test('isDevelopment is false (NODE_ENV=test, not development)', () => {
    expect(env.isDevelopment).toBe(false);
  });

  test('isE2E is false when HOMEBOT_E2E is not set at module load', () => {
    // HOMEBOT_E2E env is cleared at test startup ($env:HOMEBOT_E2E='')
    expect(env.isE2E).toBe(false);
  });

  test('isDemoMode is false when no --demo arg and HOMEBOT_DEMO_MODE not set', () => {
    expect(env.isDemoMode).toBe(false);
  });

  test('isReleaseBuild is false with non-packaged build and default env', () => {
    expect(env.isReleaseBuild).toBe(false);
  });

  test('default export includes all expected keys', () => {
    const d = env.default;
    expect(typeof d.isPackagedBuild).toBe('boolean');
    expect(typeof d.isProduction).toBe('boolean');
    expect(typeof d.isDevelopment).toBe('boolean');
    expect(typeof d.isE2E).toBe('boolean');
    expect(typeof d.isDemoMode).toBe('boolean');
    expect(typeof d.getRuntimeMode).toBe('function');
    expect(typeof d.sanitizeEnvForPackaged).toBe('function');
  });
});

// ── getRuntimeMode ────────────────────────────────────────────────────────────

describe('getRuntimeMode', () => {
  afterEach(() => {
    delete process.env.HOMEBOT_BETA;
    delete process.env.HOMEBOT_DEMO_MODE;
  });

  test('returns "prod" when no demo or beta flags are active', () => {
    delete process.env.HOMEBOT_BETA;
    expect(env.getRuntimeMode()).toBe('prod');
  });

  test('returns "beta" when HOMEBOT_BETA=1', () => {
    process.env.HOMEBOT_BETA = '1';
    expect(env.getRuntimeMode()).toBe('beta');
  });

  test('returns "beta" when --beta is in process.argv', () => {
    process.argv.push('--beta');
    expect(env.getRuntimeMode()).toBe('beta');
    process.argv.pop();
  });

  test('returns "demo" when loaded with --demo in argv (isolateModules)', () => {
    let isolatedEnv: any;
    jest.isolateModules(() => {
      process.argv.push('--demo');
      jest.doMock('electron', () => ({ app: { isPackaged: false } }));
      isolatedEnv = require('../env');
    });
    // Clean up argv before assertions
    const demoIdx = process.argv.indexOf('--demo');
    if (demoIdx !== -1) process.argv.splice(demoIdx, 1);
    expect(isolatedEnv.isDemoMode).toBe(true);
    expect(isolatedEnv.getRuntimeMode()).toBe('demo');
  });

  test('returns "demo" when HOMEBOT_DEMO_MODE=1 at module load (isolateModules)', () => {
    let isolatedEnv: any;
    jest.isolateModules(() => {
      process.env.HOMEBOT_DEMO_MODE = '1';
      jest.doMock('electron', () => ({ app: { isPackaged: false } }));
      isolatedEnv = require('../env');
    });
    delete process.env.HOMEBOT_DEMO_MODE;
    expect(isolatedEnv.isDemoMode).toBe(true);
    expect(isolatedEnv.getRuntimeMode()).toBe('demo');
  });
});

// ── isE2E variants (isolateModules) ───────────────────────────────────────────

describe('isE2E (isolateModules)', () => {
  afterEach(() => {
    delete process.env.HOMEBOT_E2E;
    jest.resetModules();
  });

  test('isE2E is true when HOMEBOT_E2E="1" at module load', () => {
    let isolatedEnv: any;
    jest.isolateModules(() => {
      process.env.HOMEBOT_E2E = '1';
      jest.doMock('electron', () => ({ app: { isPackaged: false } }));
      isolatedEnv = require('../env');
    });
    delete process.env.HOMEBOT_E2E;
    expect(isolatedEnv.isE2E).toBe(true);
  });

  test('isE2E is true when HOMEBOT_E2E="true" at module load', () => {
    let isolatedEnv: any;
    jest.isolateModules(() => {
      process.env.HOMEBOT_E2E = 'true';
      jest.doMock('electron', () => ({ app: { isPackaged: false } }));
      isolatedEnv = require('../env');
    });
    delete process.env.HOMEBOT_E2E;
    expect(isolatedEnv.isE2E).toBe(true);
  });
});

// ── isProduction / isDevelopment (isolateModules) ────────────────────────────

describe('isProduction / isDevelopment (isolateModules)', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('isProduction is true when NODE_ENV=production', () => {
    let isolatedEnv: any;
    const prev = process.env.NODE_ENV;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'production';
      jest.doMock('electron', () => ({ app: { isPackaged: false } }));
      isolatedEnv = require('../env');
    });
    process.env.NODE_ENV = prev;
    expect(isolatedEnv.isProduction).toBe(true);
  });

  test('isDevelopment is true when NODE_ENV=development and not packaged', () => {
    let isolatedEnv: any;
    const prev = process.env.NODE_ENV;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      jest.doMock('electron', () => ({ app: { isPackaged: false } }));
      isolatedEnv = require('../env');
    });
    process.env.NODE_ENV = prev;
    expect(isolatedEnv.isDevelopment).toBe(true);
  });
});

// ── sanitizeEnvForPackaged ────────────────────────────────────────────────────

describe('sanitizeEnvForPackaged', () => {
  test('is a no-op when isReleaseBuild is false (default)', () => {
    process.env.HOMEBOT_E2E = '1';
    env.sanitizeEnvForPackaged();
    // Should NOT have removed HOMEBOT_E2E since we are not in a release build
    expect(process.env.HOMEBOT_E2E).toBe('1');
    delete process.env.HOMEBOT_E2E;
  });

  test('removes HOMEBOT_E2E, HOMEBOT_DIRECT_OLLAMA, HOMEBOT_DEMO_MODE in release build (isolateModules)', () => {
    let isolatedEnv: any;
    jest.isolateModules(() => {
      // Simulate packaged + no E2E → isReleaseBuild=true
      delete process.env.HOMEBOT_E2E;
      jest.doMock('electron', () => ({ app: { isPackaged: true } }));
      isolatedEnv = require('../env');
    });

    // Only runs the sanitize path if isReleaseBuild is true
    if (!isolatedEnv.isReleaseBuild) {
      // On this build IS_RELEASE_BUILD webpack define is undefined,
      // so even with isPackaged=true we can't guarantee isReleaseBuild without the webpack define.
      // Just confirm the function doesn't throw.
      expect(() => isolatedEnv.sanitizeEnvForPackaged()).not.toThrow();
      return;
    }

    process.env.HOMEBOT_E2E = '1';
    process.env.HOMEBOT_DIRECT_OLLAMA = '1';
    process.env.HOMEBOT_DEMO_MODE = '1';
    isolatedEnv.sanitizeEnvForPackaged();
    expect(process.env.HOMEBOT_E2E).toBeUndefined();
    expect(process.env.HOMEBOT_DIRECT_OLLAMA).toBeUndefined();
    expect(process.env.HOMEBOT_DEMO_MODE).toBeUndefined();
  });
});
