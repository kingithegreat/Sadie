import {
  installConsoleGate,
  isProductionRuntime,
  __resetConsoleGate,
} from '../../main/utils/console-gate';

describe('console-gate', () => {
  const orig = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const savedEnv = { ...process.env };

  afterEach(() => {
    __resetConsoleGate();
    // Restore any spies / originals and env between cases.
    console.log = orig.log;
    console.debug = orig.debug;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
    process.env = { ...savedEnv };
    delete process.env.HOMEBOT_DEBUG_CONSOLE;
  });

  describe('isProductionRuntime', () => {
    it('honors an explicit boolean', () => {
      expect(isProductionRuntime(true)).toBe(true);
      expect(isProductionRuntime(false)).toBe(false);
    });
    it('is true when NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';
      expect(isProductionRuntime()).toBe(true);
    });
    it('is false when NODE_ENV=test or development', () => {
      process.env.NODE_ENV = 'test';
      expect(isProductionRuntime()).toBe(false);
      process.env.NODE_ENV = 'development';
      expect(isProductionRuntime()).toBe(false);
    });
  });

  describe('installConsoleGate', () => {
    it('does not suppress in dev', () => {
      const applied = installConsoleGate({ production: false });
      expect(applied).toBe(false);
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      console.log('hello');
      expect(spy).toHaveBeenCalledWith('hello');
      spy.mockRestore();
    });

    it('suppresses log/debug/info in production but keeps warn/error', () => {
      const logSpy = jest.spyOn(orig, 'log');
      const warnCalls: unknown[] = [];
      console.warn = ((...a: unknown[]) => { warnCalls.push(a); }) as typeof console.warn;

      const applied = installConsoleGate({ production: true });
      expect(applied).toBe(true);

      // log/debug/info are now no-ops (do not reach the original)
      console.log('should be swallowed');
      console.debug('nope');
      console.info('nope');
      expect(logSpy).not.toHaveBeenCalled();

      // warn/error still work
      console.warn('important');
      expect(warnCalls).toHaveLength(1);

      logSpy.mockRestore();
    });

    it('respects forceVerbose (no suppression even in production)', () => {
      const applied = installConsoleGate({ production: true, forceVerbose: true });
      expect(applied).toBe(false);
    });

    it('respects HOMEBOT_DEBUG_CONSOLE=1 escape hatch', () => {
      process.env.HOMEBOT_DEBUG_CONSOLE = '1';
      const applied = installConsoleGate({ production: true });
      expect(applied).toBe(false);
    });

    it('is idempotent (second install is a no-op)', () => {
      expect(installConsoleGate({ production: true })).toBe(true);
      expect(installConsoleGate({ production: true })).toBe(false);
    });

    it('__resetConsoleGate restores original methods', () => {
      installConsoleGate({ production: true });
      __resetConsoleGate();
      // After reset, a fresh install can apply again and console.log is real
      expect(console.log).toBe(orig.log);
    });
  });
});
