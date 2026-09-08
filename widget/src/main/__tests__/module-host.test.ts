import { TrustedModuleHost, TrustedModuleContextV1, TrustedModuleDefinitionV1, ModuleHostServicesV1 } from '../modules/host';
import { getAllToolDefinitions, getTool, getToolOwner, registerOwnedTool, registerTool } from '../tools/registry';
import { ModuleManifestV1 } from '../../shared/modules/contracts';
import { ToolDefinition, ToolHandler } from '../tools/types';

let serial = 0;
const hosts: TrustedModuleHost[] = [];
const context = { executionId: 'module-contract-test' };
const definition = (name: string): ToolDefinition => ({ name, description: 'Read the fixture', parameters: { type: 'object', properties: {}, required: [] } });
function fixture(overrides: Partial<ModuleManifestV1> = {}): ModuleManifestV1 {
  const id = `homebot.fixture-${++serial}`;
  return {
    schemaVersion: 1, id, version: '1.0.0', publisher: 'HomeBot',
    hostApi: { min: '1.0.0', maxExclusive: '2.0.0' }, display: { name: id, description: 'Reviewed test module' },
    platforms: ['win32'], dependencies: [], optionalIntegrations: [],
    contributions: { commands: [`${id}.read`], views: [], settings: [], providers: [] },
    permissions: [`fixture_${serial}`], grants: [], resources: { gpu: 'none' }, dataSchemaVersion: 1,
    ...overrides,
  };
}
function host(overrides: Partial<ModuleHostServicesV1> = {}): TrustedModuleHost {
  const result = new TrustedModuleHost({ platform: 'win32', registerTool: registerOwnedTool, invokeTool: jest.fn(async () => ({ success: true })), ...overrides });
  hosts.push(result);
  return result;
}
function module(manifest = fixture(), effect: ToolHandler = jest.fn(async () => ({ success: true, result: 'read' }))): TrustedModuleDefinitionV1 {
  return { manifest, activate: ctx => ctx.registerTool(manifest.contributions.commands[0], definition(manifest.permissions[0]), effect) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(instance => instance.disposeAll()));
});

test.each([
  ['incompatible host', { hostApi: { min: '2.0.0', maxExclusive: '3.0.0' } }, 'INCOMPATIBLE_HOST'],
  ['unsupported OS', { platforms: ['linux'] }, 'UNSUPPORTED_PLATFORM'],
  ['missing dependency', { dependencies: [{ id: 'homebot.missing', version: { min: '1.0.0', maxExclusive: '2.0.0' } }] }, 'DEPENDENCY_MISSING'],
] as const)('preflights %s without installing or activating another member of the bundle', (_label, changes, code) => {
  const instance = host();
  const activate = jest.fn();
  expect(() => instance.install([
    { manifest: fixture(), activate },
    { manifest: { ...fixture(), ...changes }, activate },
  ])).toThrow(expect.objectContaining({ code }));
  expect(instance.list()).toEqual([]);
  expect(activate).not.toHaveBeenCalled();
});

test('rejects duplicate IDs, incompatible dependencies and cycles before registration', () => {
  const instance = host();
  const a = fixture();
  const b = fixture({ dependencies: [{ id: a.id, version: { min: '2.0.0', maxExclusive: '3.0.0' } }] });
  expect(() => instance.install([module(a), module(a)])).toThrow(expect.objectContaining({ code: 'DUPLICATE_MODULE' }));
  expect(() => instance.install([module(a), module(b)])).toThrow(expect.objectContaining({ code: 'DEPENDENCY_INCOMPATIBLE' }));
  b.dependencies[0].version.min = '1.0.0';
  a.dependencies.push({ id: b.id, version: { min: '1.0.0', maxExclusive: '2.0.0' } });
  expect(() => instance.install([module(a), module(b)])).toThrow(expect.objectContaining({ code: 'DEPENDENCY_CYCLE' }));
  expect(instance.list()).toEqual([]);
});

test('does not advertise unsupported UI/provider contributions as installed', () => {
  const manifest = fixture();
  manifest.contributions.views = [`${manifest.id}.view`];
  const instance = host();
  expect(() => instance.install([module(manifest)])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTRIBUTION' }));
  expect(instance.list()).toEqual([]);
});

test('rolls back commands and resources in reverse acquisition order after a partial failure', () => {
  const manifest = fixture();
  const released: string[] = [];
  let retained!: TrustedModuleContextV1;
  const instance = host();
  instance.install([{ manifest, activate(ctx) {
    retained = ctx;
    ctx.onDispose(() => released.push('first'));
    ctx.registerTool(manifest.contributions.commands[0], definition(manifest.permissions[0]), async () => ({ success: true }));
    ctx.onDispose(() => released.push('second'));
    throw new Error('sensitive activation details');
  } }]);
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'ACTIVATION_FAILED' }));
  expect(released).toEqual(['second', 'first']);
  expect(getTool(manifest.permissions[0])).toBeUndefined();
  expect(instance.list()[0]).toMatchObject({ state: 'failed', failure: { code: 'ACTIVATION_FAILED' } });
  expect(JSON.stringify(instance.list())).not.toContain('sensitive activation details');
  expect(() => retained.onDispose(jest.fn())).toThrow(expect.objectContaining({ code: 'MODULE_UNAVAILABLE' }));
});

test('rejects asynchronous activation, removes its exposure and observes a later rejection', async () => {
  const manifest = fixture();
  const continueActivation = deferred<void>();
  let retained!: TrustedModuleContextV1;
  const instance = host();
  instance.install([{ manifest, activate: (async (ctx: TrustedModuleContextV1) => {
    retained = ctx;
    module(manifest).activate(ctx);
    await continueActivation.promise;
    throw new Error('late private activation failure');
  }) as any }]);

  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'ACTIVATION_FAILED' }));
  expect(getTool(manifest.permissions[0])).toBeUndefined();
  expect(instance.list()[0]).toMatchObject({ state: 'failed', failure: { code: 'ACTIVATION_FAILED' } });
  expect(() => retained.onDispose(jest.fn())).toThrow(expect.objectContaining({ code: 'MODULE_UNAVAILABLE' }));

  continueActivation.resolve();
  await continueActivation.promise;
  await Promise.resolve();
  expect(JSON.stringify(instance.list())).not.toContain('late private activation failure');
});

test.each(['duplicate', 'missing', 'undeclared', 'permission'] as const)('rolls back a %s registration without leaving a callable tool', kind => {
  const manifest = fixture();
  const instance = host();
  instance.install([{ manifest, activate(ctx) {
    if (kind === 'missing') return;
    const command = kind === 'undeclared' ? `${manifest.id}.other` : manifest.contributions.commands[0];
    const def = { ...definition(manifest.permissions[0]), ...(kind === 'permission' ? { requiredPermissions: ['write_file'] } : {}) };
    ctx.registerTool(command, def, async () => ({ success: true }));
    if (kind === 'duplicate') ctx.registerTool(command, def, async () => ({ success: true }));
  } }]);
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: kind === 'duplicate' ? 'DUPLICATE_CONTRIBUTION' : 'UNDECLARED_CONTRIBUTION' }));
  expect(getTool(manifest.permissions[0])).toBeUndefined();
});

test('cannot overwrite a Core command or another module, including later Core registration', () => {
  const coreName = `core_fixture_${++serial}`;
  const coreHandler = jest.fn(async () => ({ success: true }));
  registerTool(coreName, definition(coreName), coreHandler);
  const manifest = fixture({ permissions: [coreName] });
  const instance = host();
  instance.install([module(manifest)]);
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'DUPLICATE_CONTRIBUTION' }));
  expect(getTool(coreName)?.handler).toBe(coreHandler);
  const owned = fixture();
  instance.install([module(owned)]);
  instance.enable(owned.id);
  expect(() => registerTool(owned.permissions[0], definition(owned.permissions[0]), coreHandler)).toThrow(expect.objectContaining({ code: 'DUPLICATE_CONTRIBUTION' }));
  const collision = fixture({ permissions: owned.permissions });
  instance.install([module(collision)]);
  expect(() => instance.enable(collision.id)).toThrow(expect.objectContaining({ code: 'DUPLICATE_CONTRIBUTION' }));
  expect(getToolOwner(owned.permissions[0])?.moduleId).toBe(owned.id);
});

test('removes exposure immediately, drains started work with resources intact, and never revives stale callbacks', async () => {
  const manifest = fixture();
  const finish = deferred<void>();
  const released = jest.fn();
  let runs = 0;
  const instance = host();
  instance.install([{ manifest, activate(ctx) {
    ctx.onDispose(released);
    ctx.registerTool(manifest.contributions.commands[0], definition(manifest.permissions[0]), async () => {
      runs++;
      await finish.promise;
      expect(released).not.toHaveBeenCalled();
      return { success: true };
    });
  } }]);
  instance.enable(manifest.id);
  const retained = getTool(manifest.permissions[0])!.handler;
  const running = retained({}, context);
  expect(instance.list()[0].activeCalls).toBe(1);
  const stopped = instance.disable(manifest.id);
  expect(instance.list()[0].state).toBe('draining');
  expect(getAllToolDefinitions().some(tool => tool.name === manifest.permissions[0])).toBe(false);
  expect(released).not.toHaveBeenCalled();
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'MODULE_BUSY' }));
  await expect(retained({}, context)).resolves.toMatchObject({ success: false, code: 'MODULE_UNAVAILABLE' });
  finish.resolve();
  await expect(running).resolves.toMatchObject({ success: true });
  await stopped;
  expect(released).toHaveBeenCalledTimes(1);
  instance.enable(manifest.id);
  instance.enable(manifest.id);
  expect(getAllToolDefinitions().filter(tool => tool.name === manifest.permissions[0])).toHaveLength(1);
  await expect(retained({}, context)).resolves.toMatchObject({ success: false, code: 'MODULE_UNAVAILABLE' });
  expect(runs).toBe(1);
});

test('stays draining until every asynchronous resource cleanup has finished', async () => {
  const manifest = fixture();
  const first = deferred<void>();
  const second = deferred<void>();
  const firstEntered = deferred<void>();
  const secondEntered = deferred<void>();
  const released: string[] = [];
  const instance = host();
  instance.install([{ manifest, activate(ctx) {
    module(manifest).activate(ctx);
    ctx.onDispose(async () => {
      firstEntered.resolve();
      await first.promise;
      released.push('onDispose');
    });
    return async () => {
      secondEntered.resolve();
      await second.promise;
      released.push('returned');
    };
  } }]);
  instance.enable(manifest.id);

  const stopped = instance.disable(manifest.id);
  await Promise.all([firstEntered.promise, secondEntered.promise]);
  expect(getTool(manifest.permissions[0])).toBeUndefined();
  expect(instance.list()[0].state).toBe('draining');
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'MODULE_BUSY' }));

  second.resolve();
  await second.promise;
  expect(instance.list()[0].state).toBe('draining');
  first.resolve();
  await stopped;

  expect(released).toEqual(['returned', 'onDispose']);
  expect(instance.list()[0]).toMatchObject({ state: 'disabled' });
  instance.enable(manifest.id);
  expect(getTool(manifest.permissions[0])).toBeDefined();
});

test('awaits every asynchronous cleanup after one rejects and makes disposal failure sticky', async () => {
  const manifest = fixture();
  const failing = deferred<void>();
  const remaining = deferred<void>();
  const failingEntered = deferred<void>();
  const remainingEntered = deferred<void>();
  const remainingFinished = jest.fn();
  const instance = host();
  instance.install([{ manifest, activate(ctx) {
    module(manifest).activate(ctx);
    ctx.onDispose(async () => {
      failingEntered.resolve();
      await failing.promise;
    });
    ctx.onDispose(async () => {
      remainingEntered.resolve();
      await remaining.promise;
      remainingFinished();
    });
  } }]);
  instance.enable(manifest.id);

  const stopped = instance.disable(manifest.id);
  await Promise.all([failingEntered.promise, remainingEntered.promise]);
  failing.reject(new Error('private asynchronous cleanup failure'));
  await expect(failing.promise).rejects.toThrow('private asynchronous cleanup failure');
  expect(instance.list()[0].state).toBe('draining');
  expect(remainingFinished).not.toHaveBeenCalled();

  remaining.resolve();
  await stopped;
  expect(remainingFinished).toHaveBeenCalledTimes(1);
  expect(instance.list()[0]).toMatchObject({ state: 'failed', failure: { code: 'DISPOSAL_FAILED' } });
  expect(JSON.stringify(instance.list())).not.toContain('private asynchronous cleanup failure');
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'DISPOSAL_FAILED' }));
  await instance.disable(manifest.id);
  expect(instance.list()[0]).toMatchObject({ state: 'failed', failure: { code: 'DISPOSAL_FAILED' } });
});

test('removes partial activation exposure and blocks retry until asynchronous rollback settles', async () => {
  const manifest = fixture();
  const rollback = deferred<void>();
  const rollbackEntered = deferred<void>();
  let activationFails = true;
  const instance = host();
  instance.install([{ manifest, activate(ctx) {
    ctx.onDispose(async () => {
      rollbackEntered.resolve();
      await rollback.promise;
    });
    module(manifest).activate(ctx);
    if (activationFails) throw new Error('private activation failure');
  } }]);

  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'ACTIVATION_FAILED' }));
  await rollbackEntered.promise;
  expect(getTool(manifest.permissions[0])).toBeUndefined();
  expect(instance.list()[0]).toMatchObject({ state: 'draining', failure: { code: 'ACTIVATION_FAILED' } });
  expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'MODULE_BUSY' }));

  activationFails = false;
  rollback.resolve();
  await instance.disable(manifest.id);
  expect(instance.list()[0]).toMatchObject({ state: 'failed', failure: { code: 'ACTIVATION_FAILED' } });
  instance.enable(manifest.id);
  expect(instance.list()[0].state).toBe('enabled');
  expect(getTool(manifest.permissions[0])).toBeDefined();
});

test('an old registry disposer cannot remove a replacement registration', () => {
  const name = `registry_fixture_${++serial}`;
  const owner = { moduleId: 'homebot.fixture', capabilityId: 'homebot.fixture.read', generation: 1 };
  const disposeOld = registerOwnedTool(owner, definition(name), async () => ({ success: true }));
  disposeOld();
  const disposeNew = registerOwnedTool({ ...owner, generation: 2 }, definition(name), async () => ({ success: true }));
  try {
    disposeOld();
    expect(getToolOwner(name)?.generation).toBe(2);
  } finally { disposeNew(); }
});

test('rechecks existing grant authority on invocation and fails closed when it is absent or throws', async () => {
  const manifest = fixture({ grants: ['homebot.fixture.paid'] });
  let granted = true;
  const ran = jest.fn(async () => ({ success: true }));
  const instance = host({ canUseGrants: () => granted });
  instance.install([module(manifest, ran)]);
  instance.enable(manifest.id);
  const handler = getTool(manifest.permissions[0])!.handler;
  await expect(handler({}, context)).resolves.toMatchObject({ success: true });
  granted = false;
  await expect(handler({}, context)).resolves.toMatchObject({ success: false, code: 'ENTITLEMENT_DENIED' });
  expect(ran).toHaveBeenCalledTimes(1);
  for (const canUseGrants of [undefined, () => { throw new Error('offline grant store unavailable'); }]) {
    const other = host({ canUseGrants });
    other.install([module(fixture({ grants: manifest.grants }))]);
    expect(() => other.enable(other.list()[0].manifest.id)).toThrow(expect.objectContaining({ code: 'ENTITLEMENT_DENIED' }));
    expect(other.list()[0].state).toBe('disabled');
  }
});

test('enforces dependency order and disposes dependents before their services', async () => {
  const base = fixture();
  const consumer = fixture({ dependencies: [{ id: base.id, version: { min: '1.0.0', maxExclusive: '2.0.0' } }] });
  const order: string[] = [];
  const instance = host();
  instance.install([base, consumer].map(manifest => ({ manifest, activate(ctx) {
    module(manifest).activate(ctx);
    return () => { order.push(manifest.id); };
  } })));
  expect(() => instance.enable(consumer.id)).toThrow(expect.objectContaining({ code: 'DEPENDENCY_DISABLED' }));
  instance.enable(base.id);
  instance.enable(consumer.id);
  await expect(instance.disable(base.id)).rejects.toMatchObject({ code: 'ACTIVE_DEPENDENTS' });
  await instance.disposeAll();
  expect(order).toEqual([consumer.id, base.id]);
  expect(() => instance.uninstall(base.id)).toThrow(expect.objectContaining({ code: 'ACTIVE_DEPENDENTS' }));
  instance.uninstall(consumer.id);
  instance.uninstall(base.id);
  expect(instance.list()).toEqual([]);
});

test.each([false, true])('continues cleanup after failure and prevents duplicate resources on retry (activation failure: %s)', async activationFails => {
  const manifest = fixture();
  const cleanup = jest.fn();
  const instance = host({ recordEvent: () => { throw new Error('logging unavailable'); } });
  instance.install([{ manifest, activate(ctx) {
    ctx.onDispose(cleanup);
    ctx.onDispose(() => { throw new Error('private cleanup error'); });
    module(manifest).activate(ctx);
    if (activationFails) throw new Error('start failed');
  } }]);
  const verify = () => {
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(getTool(manifest.permissions[0])).toBeUndefined();
    expect(instance.list()[0]).toMatchObject({ state: 'failed', failure: { code: 'DISPOSAL_FAILED' } });
    expect(() => instance.enable(manifest.id)).toThrow(expect.objectContaining({ code: 'DISPOSAL_FAILED' }));
  };
  if (activationFails) {
    expect(() => instance.enable(manifest.id)).toThrow();
  } else {
    instance.enable(manifest.id);
    await instance.disable(manifest.id);
  }
  verify();
  await instance.disable(manifest.id);
  verify();
});

test('a retained host service delegates to Core while enabled and rejects after restart', async () => {
  const manifest = fixture();
  const invokeTool = jest.fn(async () => ({ success: true, result: 'Core checked it' }));
  const instance = host({ invokeTool });
  let retained!: TrustedModuleContextV1;
  instance.install([{ manifest, activate(ctx) { retained = ctx; module(manifest).activate(ctx); } }]);
  instance.enable(manifest.id);
  const old = retained;
  const call = { name: 'read_file', arguments: { path: 'fixture' } };
  await expect(old.invokeTool(call, context)).resolves.toMatchObject({ success: true });
  expect(invokeTool).toHaveBeenCalledWith(call, context);
  await instance.disable(manifest.id);
  instance.enable(manifest.id);
  await expect(old.invokeTool(call, context)).rejects.toMatchObject({ code: 'MODULE_UNAVAILABLE' });
  expect(invokeTool).toHaveBeenCalledTimes(1);
});
