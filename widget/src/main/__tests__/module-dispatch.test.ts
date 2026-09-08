/**
 * A confirmation prompt is an asynchronous boundary. Disabling and re-enabling
 * a module while that prompt is open must invalidate the handler captured by
 * both the single-call executor and the batch executor's allow-once branch.
 */

const mockAssertPermission = jest.fn((_name: string, _defaultValue?: boolean) => true);
let mockUserDataDir = require('os').tmpdir();

jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config-manager', () => ({
  ...jest.requireActual('../config-manager'),
  assertPermission: (name: string, defaultValue?: boolean) => mockAssertPermission(name, defaultValue),
  hasStandingConsent: jest.fn(() => false),
}));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => mockUserDataDir),
    getAppPath: jest.fn(() => mockUserDataDir),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

import { TrustedModuleHost, type TrustedModuleDefinitionV1 } from '../modules/host';
import { executeTool, executeToolBatch } from '../tools';
import { getTool, registerOwnedTool, registerTool } from '../tools/registry';

const MODULE_ID = 'homebot.test-dispatch';
const MODULE_TOOL = 'test_module_dispatch_confirmed_v1';
const CORE_TOOL = 'test_core_dispatch_ordinary_v1';
const CAPABILITY_ID = `${MODULE_ID}.${MODULE_TOOL}`;

let moduleRuns = 0;
let coreRuns = 0;

const reviewedModule: TrustedModuleDefinitionV1 = {
  manifest: {
    schemaVersion: 1,
    id: MODULE_ID,
    publisher: 'HomeBot Tests',
    version: '1.0.0',
    hostApi: { min: '1.0.0', maxExclusive: '2.0.0' },
    display: { name: 'Dispatch Test Module', description: 'Exercises trusted dispatch boundaries.' },
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
    optionalIntegrations: [],
    contributions: { commands: [CAPABILITY_ID], views: [], settings: [], providers: [] },
    // Registration authority includes the public tool name.
    permissions: [MODULE_TOOL],
    grants: [],
    resources: { gpu: 'none' },
    dataSchemaVersion: 1,
  },
  activate(context) {
    context.registerTool(CAPABILITY_ID, {
      name: MODULE_TOOL,
      description: 'Perform a reviewed action after confirmation.',
      category: 'system',
      requiresConfirmation: true,
      parameters: { type: 'object', properties: {}, required: [] },
    }, async () => {
      moduleRuns++;
      return { success: true, result: 'module ran' };
    });
  },
};

const host = new TrustedModuleHost({
  platform: process.platform,
  registerTool: registerOwnedTool,
  invokeTool: (call, context) => executeTool(call, context),
  canUseGrants: () => true,
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const moduleCall = () => ({ name: MODULE_TOOL, arguments: {} });

function ensureModuleEnabled(): void {
  const state = host.list().find(item => item.manifest.id === MODULE_ID)?.state;
  if (state !== 'enabled') host.enable(MODULE_ID);
}

beforeAll(() => {
  host.install([reviewedModule]);
  host.enable(MODULE_ID);
  registerTool(CORE_TOOL, {
    name: CORE_TOOL,
    description: 'Read ordinary Core state.',
    category: 'system',
    parameters: { type: 'object', properties: {}, required: [] },
  }, async () => {
    coreRuns++;
    return { success: true, result: 'core ran' };
  });
});

beforeEach(() => {
  ensureModuleEnabled();
  moduleRuns = 0;
  coreRuns = 0;
  mockAssertPermission.mockReset();
  mockAssertPermission.mockReturnValue(true);
});

afterEach(() => { ensureModuleEnabled(); });

afterAll(async () => {
  await host.disable(MODULE_ID);
  host.uninstall(MODULE_ID);
});

test('a confirmed call executes while its module generation remains enabled', async () => {
  const result = await executeTool(moduleCall(), {
    executionId: 'confirmed-enabled',
    requestConfirmation: async () => true,
  });

  expect(result).toEqual({ success: true, result: 'module ran' });
  expect(moduleRuns).toBe(1);
});

test('missing confirmation stays denied', async () => {
  const result = await executeTool(moduleCall(), { executionId: 'no-confirmation-channel' });

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/confirmation/i);
  expect(moduleRuns).toBe(0);
});

test('declined confirmation stays denied', async () => {
  const result = await executeTool(moduleCall(), {
    executionId: 'confirmation-declined',
    requestConfirmation: async () => false,
  });

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/cancelled/i);
  expect(moduleRuns).toBe(0);
});

test('executeTool cannot run a handler captured before a disable and re-enable', async () => {
  const enteredConfirmation = deferred<void>();
  const approval = deferred<boolean>();
  const oldRegistration = getTool(MODULE_TOOL);
  const pending = executeTool(moduleCall(), {
    executionId: 'single-stale-generation',
    requestConfirmation: async () => {
      enteredConfirmation.resolve(undefined);
      return approval.promise;
    },
  });

  await enteredConfirmation.promise;
  await host.disable(MODULE_ID);
  host.enable(MODULE_ID);
  expect(getTool(MODULE_TOOL)).not.toBe(oldRegistration);
  approval.resolve(true);

  const result = await pending;
  expect(result).toMatchObject({ success: false, code: 'MODULE_UNAVAILABLE' });
  expect(moduleRuns).toBe(0);
});

test('batch allow-once cannot run a handler captured before a disable and re-enable', async () => {
  // The tool is denied by policy first. overrideAllowed represents the user's
  // one-use grant and selects executeToolBatch's separate direct-handler path.
  mockAssertPermission.mockReturnValue(false);
  const denied = await executeToolBatch(
    [moduleCall()],
    { executionId: 'batch-denied-first' },
  );
  expect(denied[0]).toMatchObject({ success: false, status: 'needs_confirmation' });

  const enteredConfirmation = deferred<void>();
  const approval = deferred<boolean>();
  const oldRegistration = getTool(MODULE_TOOL);
  const pending = executeToolBatch(
    [moduleCall()],
    {
      executionId: 'batch-stale-generation',
      requestConfirmation: async () => {
        enteredConfirmation.resolve(undefined);
        return approval.promise;
      },
    },
    { overrideAllowed: [MODULE_TOOL] },
  );

  await enteredConfirmation.promise;
  await host.disable(MODULE_ID);
  host.enable(MODULE_ID);
  expect(getTool(MODULE_TOOL)).not.toBe(oldRegistration);
  approval.resolve(true);

  const [result] = await pending;
  expect(result).toMatchObject({ success: false, code: 'MODULE_UNAVAILABLE' });
  expect(moduleRuns).toBe(0);
});

test('an ordinary Core tool still executes through the same real dispatcher', async () => {
  const result = await executeTool(
    { name: CORE_TOOL, arguments: {} },
    { executionId: 'ordinary-core' },
  );

  expect(result).toEqual({ success: true, result: 'core ran' });
  expect(coreRuns).toBe(1);
  expect(moduleRuns).toBe(0);
});
