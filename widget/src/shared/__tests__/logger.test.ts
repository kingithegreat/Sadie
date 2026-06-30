/**
 * logger.test.ts
 * Tests for src/shared/logger.ts
 *
 * Because `isDebug` is evaluated at module-load time, tests that need a
 * different value use jest.isolateModules() + explicit env vars.
 */

// In Jest's default environment NODE_ENV is 'test' (not 'production'),
// so the shared logger loads with isDebug = true.

describe('shared logger — exports', () => {
  let logger: typeof import('../logger');

  beforeAll(async () => {
    logger = await import('../logger');
  });

  test('exports named debug function', () => {
    expect(typeof logger.debug).toBe('function');
  });

  test('exports named info function', () => {
    expect(typeof logger.info).toBe('function');
  });

  test('exports named warn function', () => {
    expect(typeof logger.warn).toBe('function');
  });

  test('exports named error function', () => {
    expect(typeof logger.error).toBe('function');
  });

  test('default export has debug, info, warn, error methods', () => {
    expect(typeof logger.default.debug).toBe('function');
    expect(typeof logger.default.info).toBe('function');
    expect(typeof logger.default.warn).toBe('function');
    expect(typeof logger.default.error).toBe('function');
  });
});

// ── info / warn / error always call console regardless of debug mode ──────────

describe('shared logger — info / warn / error always write', () => {
  let logger: typeof import('../logger');
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    logger = await import('../logger');
  });

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('info calls console.info with [HomeBot] prefix', () => {
    logger.info('hello info');
    expect(infoSpy).toHaveBeenCalledWith('[HomeBot]', 'hello info');
  });

  test('info passes multiple arguments', () => {
    logger.info('a', 'b', 'c');
    expect(infoSpy).toHaveBeenCalledWith('[HomeBot]', 'a', 'b', 'c');
  });

  test('warn calls console.warn with [HomeBot] prefix', () => {
    logger.warn('something wrong');
    expect(warnSpy).toHaveBeenCalledWith('[HomeBot]', 'something wrong');
  });

  test('error calls console.error with [HomeBot] prefix', () => {
    logger.error('fatal', new Error('boom'));
    expect(errorSpy).toHaveBeenCalledWith('[HomeBot]', 'fatal', expect.any(Error));
  });
});

// ── debug writes when isDebug = true (NODE_ENV !== 'production') ─────────────

describe('shared logger — debug writes when isDebug is true', () => {
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    // Ensure we are in a non-production env for isDebug = true
    process.env.NODE_ENV = 'test';
    delete process.env.HOMEBOT_DEBUG;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('debug calls console.debug with [HomeBot] prefix when NODE_ENV is test', () => {
    // Logger was loaded with NODE_ENV=test so isDebug=true
    const logger = jest.requireActual('../logger') as typeof import('../logger');
    logger.debug('test debug message');
    expect(debugSpy).toHaveBeenCalledWith('[HomeBot]', 'test debug message');
  });
});

// ── debug is suppressed in production mode ───────────────────────────────────

describe('shared logger — debug suppressed when HOMEBOT_DEBUG=false and NODE_ENV=production', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    // restore env
    process.env.NODE_ENV = 'test';
    delete process.env.HOMEBOT_DEBUG;
  });

  test('debug does not call console.debug when isDebug is false', () => {
    let logger: typeof import('../logger') | undefined;

    // Load fresh module instance with production env so isDebug=false
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'production';
      delete process.env.HOMEBOT_DEBUG;
      logger = require('../logger');
    });

    const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    logger!.debug('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('debug calls console.debug when HOMEBOT_DEBUG=true even in production', () => {
    let logger: typeof import('../logger') | undefined;

    jest.isolateModules(() => {
      process.env.NODE_ENV = 'production';
      process.env.HOMEBOT_DEBUG = 'true';
      logger = require('../logger');
    });

    const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    logger!.debug('explicit debug');
    expect(spy).toHaveBeenCalledWith('[HomeBot]', 'explicit debug');
    spy.mockRestore();
  });
});
