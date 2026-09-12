import * as fs from 'fs';
import * as path from 'path';
import { transpileModule, ScriptTarget } from 'typescript';

// Execute the actual deferred startup block, without opening Electron windows
// or the unrelated integrations in index.ts. This keeps the regression tied
// to the reachable startup caller rather than an unused settings helper.
const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
const start = source.indexOf('    // First-time hardware profile detection');
const end = source.indexOf('\n  });', start);
if (start < 0 || end < start) throw new Error('Startup hardware settings block not found');
const runStartup = new Function('getSettings', 'detectGpuVram', 'applyHardwareProfile', 'saveSettings', 'mainWindow', 'console',
  `return (async () => { ${source.slice(start, end)} })();`);

test('a slow startup hardware probe cannot undo completed setup or privacy edits', async () => {
  let settings: any = { firstRun: true, useCustomLLM: true };
  let finishProbe!: (gpu: any) => void;
  const detect = jest.fn(() => new Promise(resolve => { finishProbe = resolve; }));
  const save = jest.fn(next => { settings = next; });
  const startup = runStartup(() => ({ ...settings }), detect, (value: any) => value, save, null, { log: jest.fn(), error: jest.fn() });
  expect(detect).toHaveBeenCalledTimes(1);
  settings = { firstRun: false, useCustomLLM: false, narrationEngine: 'kokoro' };
  finishProbe({ vramGB: 4, gpuName: 'Test GPU' });
  await startup;
  expect(settings).toMatchObject({ firstRun: false, useCustomLLM: false, narrationEngine: 'kokoro', hardwareProfile: '4gb' });
});

test('a profile chosen during detection takes precedence over the startup default', async () => {
  let settings: any = {};
  let finishProbe!: (gpu: any) => void;
  const detect = () => new Promise(resolve => { finishProbe = resolve; });
  const save = jest.fn();
  const startup = runStartup(() => ({ ...settings }), detect, (value: any) => value, save, null, { log: jest.fn(), error: jest.fn() });
  settings = { hardwareProfile: '8gb', firstRun: false };
  finishProbe({ vramGB: 4, gpuName: 'Test GPU' });
  await startup;
  expect(save).not.toHaveBeenCalled();
});

const modelStart = source.indexOf('      // Validate configured chatModel');
const modelEnd = source.indexOf("    } catch (e) { console.error('[MAIN] Ollama health check error:'", modelStart);
if (modelStart < 0 || modelEnd < modelStart) throw new Error('Startup model validation block not found');
const modelCode = transpileModule(source.slice(modelStart, modelEnd), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const runModelValidation = new Function('getSettings', 'saveSettings', 'axios', 'mainWindow', 'console',
  `return (async () => { const ollamaOnline = true; const ollamaUrl = 'http://localhost:11434'; ${modelCode} })();`);

test('model fallback preserves settings edited during model discovery', async () => {
  let settings: any = { chatModel: 'missing', firstRun: true, useCustomLLM: true };
  let finishDiscovery!: (response: any) => void;
  const axios = { get: () => new Promise(resolve => { finishDiscovery = resolve; }) };
  const startup = runModelValidation(() => ({ ...settings }), (next: any) => { settings = next; }, axios, null, { warn: jest.fn(), error: jest.fn() });
  settings = { ...settings, firstRun: false, useCustomLLM: false };
  finishDiscovery({ data: { models: [{ name: 'qwen2.5:7b' }] } });
  await startup;
  expect(settings).toMatchObject({ chatModel: 'qwen2.5:7b', firstRun: false, useCustomLLM: false });
});

test('model fallback cannot overwrite a model chosen while discovery is running', async () => {
  let settings = { chatModel: 'missing' };
  let finishDiscovery!: (response: any) => void;
  const axios = { get: () => new Promise(resolve => { finishDiscovery = resolve; }) };
  const save = jest.fn();
  const startup = runModelValidation(() => ({ ...settings }), save, axios, null, { warn: jest.fn(), error: jest.fn() });
  settings = { chatModel: 'chosen-model' };
  finishDiscovery({ data: { models: [{ name: 'qwen2.5:7b' }] } });
  await startup;
  expect(save).not.toHaveBeenCalled();
});
