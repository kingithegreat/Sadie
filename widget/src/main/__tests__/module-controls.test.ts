import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrustedModuleHost, type TrustedModuleDefinitionV1 } from '../modules/host';
import { ModuleController } from '../modules/controller';
import { ModulePreferenceStore } from '../modules/preferences';
import { getAllToolDefinitions, getTool, registerOwnedTool } from '../tools/registry';
import { ModuleContractError } from '../../shared/modules/contracts';

const id = 'homebot.controls-fixture';
const name = 'module_controls_fixture';
let directory: string;
let preferences: ModulePreferenceStore;
let host: TrustedModuleHost;
let controller: ModuleController;
let allowed: boolean;
let runs: number;
const fixture: TrustedModuleDefinitionV1 = {
  manifest: {
    schemaVersion: 1, id, version: '1.0.0', publisher: 'HomeBot',
    hostApi: { min: '1.0.0', maxExclusive: '2.0.0' }, display: { name: 'Fixture', description: 'Controls test' },
    platforms: ['win32'], dependencies: [], optionalIntegrations: [],
    contributions: { commands: [`${id}.read`], views: [], settings: [], providers: [] },
    permissions: [name], grants: ['fixture.read'], resources: { gpu: 'none' }, dataSchemaVersion: 1,
  },
  activate(context) {
    context.registerTool(`${id}.read`, { name, description: 'Read fixture', parameters: { type: 'object', properties: {}, required: [] } },
      async () => { runs++; return { success: true }; });
  },
};

function createHost() {
  host = new TrustedModuleHost({ platform: 'win32', registerTool: registerOwnedTool,
    invokeTool: async () => ({ success: true }), canUseGrants: () => allowed });
  host.install([fixture]);
  controller = new ModuleController(host, preferences);
  controller.restore();
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-module-controls-'));
  preferences = new ModulePreferenceStore(() => path.join(directory, 'config', 'module-preferences.json'));
  allowed = true;
  runs = 0;
  createHost();
});
afterEach(async () => { await host.disposeAll(); fs.rmSync(directory, { recursive: true, force: true }); });

test('disable survives a new host, preserves projects and re-enables one executable tool', async () => {
  fs.writeFileSync(path.join(directory, 'project.json'), 'user-owned project');
  const captured = getTool(name)!;
  expect((await controller.setEnabled(id, false)).ok).toBe(true);
  expect(getTool(name)).toBeUndefined();
  expect(await captured.handler({}, { executionId: 'old-generation' })).toMatchObject({ success: false, code: 'MODULE_UNAVAILABLE' });
  expect(runs).toBe(0);
  await host.disposeAll();
  createHost();
  expect(host.list()[0].state).toBe('disabled');
  expect(getTool(name)).toBeUndefined();
  expect((await controller.setEnabled(id, true)).ok).toBe(true);
  expect((await controller.setEnabled(id, true)).ok).toBe(true);
  expect(getAllToolDefinitions().filter(tool => tool.name === name)).toHaveLength(1);
  expect(await getTool(name)!.handler({}, { executionId: 'enabled-control' })).toMatchObject({ success: true });
  expect(runs).toBe(1);
  expect(fs.readFileSync(path.join(directory, 'project.json'), 'utf8')).toBe('user-owned project');
  expect(fs.readdirSync(path.join(directory, 'config'))).toEqual(['module-preferences.json']);
});

test('disable removes exposure and persists immediately while existing work drains', async () => {
  let release!: () => void;
  const work = host.invoke(id, () => new Promise<void>(done => { release = done; }));
  const disable = controller.setEnabled(id, false);
  try {
    expect(host.list()[0]).toMatchObject({ state: 'draining', activeCalls: 1 });
    expect(getTool(name)).toBeUndefined();
    expect(preferences.read()).toEqual([id]);
    expect(await controller.setEnabled(id, true)).toMatchObject({ ok: false, code: 'MODULE_BUSY' });
    await expect(host.invoke(id, () => { runs++; })).rejects.toMatchObject({ code: 'MODULE_UNAVAILABLE' });
    expect(runs).toBe(0);
  } finally { release(); await work; await disable; }
  expect(host.list()[0].state).toBe('disabled');
});

test('failed persistence does not change live module state or exposure', async () => {
  jest.spyOn(preferences, 'setEnabled').mockImplementationOnce(() => { throw new ModuleContractError('PREFERENCES_UNAVAILABLE', 'Write failed'); });
  expect(await controller.setEnabled(id, false)).toMatchObject({ ok: false, code: 'PREFERENCES_UNAVAILABLE' });
  expect(host.list()[0].state).toBe('enabled');
  expect(getTool(name)).toBeDefined();
  expect(preferences.read()).toEqual([]);
});

test('locked activation restores the saved disabled choice without registering tools', async () => {
  await controller.setEnabled(id, false);
  allowed = false;
  expect(controller.list().modules![0].access).toBe('locked');
  expect(await controller.setEnabled(id, true)).toMatchObject({ ok: false, code: 'ENTITLEMENT_DENIED' });
  expect(preferences.read()).toEqual([id]);
  expect(getTool(name)).toBeUndefined();
});

test('corrupt preferences keep modules off and preserve the damaged file', async () => {
  await host.disposeAll();
  fs.mkdirSync(path.join(directory, 'config'));
  const file = path.join(directory, 'config', 'module-preferences.json');
  fs.writeFileSync(file, '{damaged');
  createHost();
  expect(controller.list()).toMatchObject({ ok: true, warning: expect.stringContaining('stay off') });
  expect(getTool(name)).toBeUndefined();
  expect(await controller.setEnabled(id, true)).toMatchObject({ ok: false, code: 'PREFERENCES_UNAVAILABLE' });
  expect(fs.readFileSync(file, 'utf8')).toBe('{damaged');
});

test('unknown module identities cannot create preferences or run code', async () => {
  expect(await controller.setEnabled('../../outside', true)).toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
  expect(fs.readdirSync(directory)).toEqual([]);
  expect(runs).toBe(0);
});

test('startup follows dependency order but never overrides a disabled dependency', async () => {
  await host.disposeAll();
  const manifest = fixture.manifest as any;
  const dependencyId = 'homebot.controls-dependency';
  const dependent = { ...fixture, manifest: { ...manifest, dependencies: [{
    id: dependencyId, version: { min: '1.0.0', maxExclusive: '2.0.0' },
  }] } };
  const dependency = { manifest: { ...manifest, id: dependencyId, permissions: [],
    contributions: { commands: [], views: [], settings: [], providers: [] } }, activate() {} };
  host = new TrustedModuleHost({ platform: 'win32', registerTool: registerOwnedTool,
    invokeTool: async () => ({ success: true }), canUseGrants: () => true });
  host.install([dependent, dependency]);
  controller = new ModuleController(host, preferences);
  controller.restore();
  expect(host.list().map(item => item.state)).toEqual(['enabled', 'enabled']);
  expect(await controller.setEnabled(dependencyId, false)).toMatchObject({ ok: false, code: 'ACTIVE_DEPENDENTS' });
  expect(preferences.read()).toEqual([]);
  await host.disposeAll();
  preferences.setEnabled(dependencyId, false);
  controller.restore();
  expect(host.list().map(item => item.state)).toEqual(['disabled', 'disabled']);
  expect(getTool(name)).toBeUndefined();
});
