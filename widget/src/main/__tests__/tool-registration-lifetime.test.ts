import { registerTool, registerOwnedTool, getTool, hasTool, getAllToolDefinitions, getToolOwner } from '../tools/registry';
import type { ToolDefinition } from '../tools/types';

let mockDenial: string | undefined;
jest.mock('../workspace-context', () => ({ currentWorkspace: () => undefined, workspaceToolError: () => mockDenial }));
jest.mock('../workspace-trust', () => ({ checkedTrustedWorkspacePath: jest.fn() }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));

const definition = (name: string): ToolDefinition => ({ name, description: 'Lifetime fixture', parameters: { type: 'object', properties: {}, required: [] } });
const context = { executionId: 'registration-lifetime-fixture' };
const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); mockDenial = undefined; });

test('disposing a registration removes advertised definitions and its executable entry', async () => {
  const name = 'mcp_fixture_lifetime', handler = jest.fn(async () => ({ success: true, result: 'actual handler' }));
  const dispose = registerTool(name, definition(name), handler); disposers.push(dispose);
  expect(getAllToolDefinitions().some(tool => tool.name === name)).toBe(true);
  expect(await getTool(name)!.handler({}, context)).toMatchObject({ success: true, result: 'actual handler' });
  dispose(); dispose();
  expect(hasTool(name)).toBe(false); expect(getTool(name)).toBeUndefined();
  expect(getAllToolDefinitions().some(tool => tool.name === name)).toBe(false);
  expect(handler).toHaveBeenCalledTimes(1);
});

test('an old disposer cannot remove a replacement even with identical definition and handler references', async () => {
  const name = 'mcp_fixture_replaced', sameDefinition = definition(name), sameHandler = jest.fn(async () => ({ success: true }));
  const oldDispose = registerTool(name, sameDefinition, sameHandler); disposers.push(oldDispose);
  const newDispose = registerTool(name, sameDefinition, sameHandler); disposers.push(newDispose);
  const replacement = getTool(name); oldDispose(); oldDispose();
  expect(getTool(name)).toBe(replacement); expect(getAllToolDefinitions()).toContain(sameDefinition);
  expect(await getTool(name)!.handler({}, context)).toMatchObject({ success: true });
  newDispose(); expect(hasTool(name)).toBe(false);
});

test('core disposers cannot remove later module ownership or bypass its duplicate guard', () => {
  const name = 'mcp_fixture_module', oldDispose = registerTool(name, definition(name), async () => ({ success: true })); disposers.push(oldDispose);
  oldDispose();
  const moduleDispose = registerOwnedTool({ moduleId: 'module-fixture', capabilityId: 'capability', generation: 1 }, definition(name), async () => ({ success: true })); disposers.push(moduleDispose);
  const moduleEntry = getTool(name); oldDispose();
  expect(getTool(name)).toBe(moduleEntry); expect(getToolOwner(name)?.moduleId).toBe('module-fixture');
  expect(() => registerTool(name, definition(name), async () => ({ success: true }))).toThrow(/belongs to module-fixture/);
  moduleDispose(); expect(hasTool(name)).toBe(false); expect(getToolOwner(name)).toBeUndefined();
});

test('registration disposal preserves the authoritative workspace handler guard', async () => {
  const name = 'mcp_fixture_guard', handler = jest.fn(async () => ({ success: true }));
  disposers.push(registerTool(name, definition(name), handler));
  mockDenial = 'Tools unavailable in reviewed draft';
  expect(await getTool(name)!.handler({}, context)).toEqual({ success: false, error: mockDenial }); expect(handler).not.toHaveBeenCalled();
  mockDenial = undefined;
  expect(await getTool(name)!.handler({}, context)).toEqual({ success: true }); expect(handler).toHaveBeenCalledTimes(1);
});
