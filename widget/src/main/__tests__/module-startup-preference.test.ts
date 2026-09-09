import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let mockProfile = '';
jest.mock('electron', () => ({ app: { getPath: () => mockProfile } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
jest.mock('../licensing', () => ({ getCurrentTier: () => 'free' }));
jest.mock('../utils/logger', () => ({ logTelemetryEvent: jest.fn() }));
jest.mock('../modules/bundled/studio', () => ({
  STUDIO_MODULE_ID: 'homebot.production-studio',
  bundledStudioModule: {
    manifest: {
      schemaVersion: 1, id: 'homebot.production-studio', publisher: 'HomeBot', version: '1.0.0',
      hostApi: { min: '1.0.0', maxExclusive: '2.0.0' },
      display: { name: 'Production Studio', description: 'Startup fixture' },
      platforms: ['win32', 'darwin', 'linux'], dependencies: [], optionalIntegrations: [],
      contributions: { commands: ['homebot.production-studio.fixture'], views: [], settings: [], providers: [] },
      permissions: ['studio_fixture'], grants: [], resources: { gpu: 'none' }, dataSchemaVersion: 1,
    },
    activate(context: any) {
      context.registerTool('homebot.production-studio.fixture', {
        name: 'studio_fixture', description: 'Read fixture', parameters: { type: 'object', properties: {}, required: [] },
      }, async () => ({ success: true }));
    },
  },
}));

test.each([true, false])('startup honors persisted Studio disabled=%s', async disabled => {
  jest.resetModules();
  mockProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-module-startup-'));
  fs.mkdirSync(path.join(mockProfile, 'config'));
  if (disabled) fs.writeFileSync(path.join(mockProfile, 'config', 'module-preferences.json'), JSON.stringify({
    schemaVersion: 1, disabledModules: ['homebot.production-studio'],
  }));
  const { initializeBundledModules, bundledModuleHost } = require('../modules/bundled');
  const { getTool } = require('../tools/registry');
  try {
    initializeBundledModules();
    initializeBundledModules();
    expect(bundledModuleHost.list()[0].state).toBe(disabled ? 'disabled' : 'enabled');
    expect(Boolean(getTool('studio_fixture'))).toBe(!disabled);
  } finally {
    await bundledModuleHost.disposeAll();
    fs.rmSync(mockProfile, { recursive: true, force: true });
  }
});
