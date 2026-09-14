import { expect, type ElectronApplication } from '@playwright/test';
import * as path from 'path';

/** Actual transport tripwires with five positive controls; never a fake speech adapter. */
export async function trapSpeechNetwork(app: ElectronApplication) {
  expect(await app.evaluate((_electron, fixture: { cacheDir?: string; packagePath: string }) => {
      if (fixture.cacheDir) {
        const createRequire = (process as any).getBuiltinModule('module').createRequire;
        const widgetRequire = createRequire(fixture.packagePath);
        const runtimeRequire = createRequire(widgetRequire.resolve('kokoro-js'));
        runtimeRequire('@huggingface/transformers').env.cacheDir = fixture.cacheDir;
      }
      const state = globalThis as typeof globalThis & { exportSpeechAttempts: string[] };
      state.exportSpeechAttempts = [];
      const inspect = (value: any) => {
        const destination = typeof value === 'string' ? value : String(value?.url || value?.hostname || value?.host || value);
        if (/huggingface\.co|hf\.co|microsoft\.com|bing\.com|speech-export-control\.invalid/.test(destination)) {
          state.exportSpeechAttempts.push(destination);
          throw new Error('Speech/model network request blocked by the local export test');
        }
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => { inspect(input); return originalFetch(input, init); };
      for (const moduleName of ['http', 'https']) {
        const transport = (process as any).getBuiltinModule(moduleName);
        for (const method of ['get', 'request']) {
          const original = transport[method];
          transport[method] = (...args: any[]) => { inspect(args[0]); return original.apply(transport, args); };
        }
      }
      for (const invoke of [
        () => globalThis.fetch('https://speech-export-control.invalid'),
        () => (process as any).getBuiltinModule('http').get({ hostname: 'speech-export-control.invalid' }),
        () => (process as any).getBuiltinModule('http').request({ hostname: 'speech-export-control.invalid' }),
        () => (process as any).getBuiltinModule('https').get({ hostname: 'speech-export-control.invalid' }),
        () => (process as any).getBuiltinModule('https').request({ hostname: 'speech-export-control.invalid' }),
      ]) { try { invoke(); } catch { /* Positive controls must be observed. */ } }
      const count = state.exportSpeechAttempts.length;
      state.exportSpeechAttempts = [];
      return count;
    }, { cacheDir: process.env.HOMEBOT_KOKORO_TEST_CACHE, packagePath: path.resolve('package.json') })).toBe(5);
}
