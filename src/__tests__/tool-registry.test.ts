/**
 * ToolRegistry Unit Tests
 *
 * Covers the core ToolRegistry class from src/toolRegistry.ts:
 *  - register / execute / listTools
 *  - allowlist enforcement
 *  - AJV input schema validation
 *  - Hash-chaining and verifyChain / tamper detection
 *  - Context freezing and propagation
 *  - Execution error handling
 */
import { ToolRegistry } from '../toolRegistry';
import type { ToolExecutionResult } from '../toolRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEchoTool(name = 'echo') {
  return {
    name,
    description: 'Echoes back its input',
    category: 'test',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    } as const,
    execute: async (input: { message: string }) => ({ echo: input.message }),
  };
}

function makeThrowingTool(name = 'thrower') {
  return {
    name,
    description: 'Always throws',
    category: 'test',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' } },
      required: ['x'],
    } as const,
    execute: async (_: { x: number }) => {
      throw new Error('Intentional failure');
    },
  };
}

// ---------------------------------------------------------------------------
// register / execute
// ---------------------------------------------------------------------------
describe('ToolRegistry — register & execute', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
  });

  test('successful execution returns success=true and output', async () => {
    const result = await registry.execute('echo', { message: 'hello' });
    expect(result.success).toBe(true);
    expect((result.output as any).echo).toBe('hello');
    expect(result.error).toBeUndefined();
  });

  test('result includes required audit fields', async () => {
    const result = await registry.execute('echo', { message: 'audit' });
    expect(result.actionId).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
    expect(result.inputHash).toBeTruthy();
    expect(result.outputHash).toBeTruthy();
    expect(result.entryHash).toBeTruthy();
    expect(result.toolName).toBe('echo');
  });

  test('context is frozen and attached to the result', async () => {
    const ctx = { userId: 'u1', role: 'admin' };
    const result = await registry.execute('echo', { message: 'ctx' }, ctx);
    expect(result.context).toEqual(ctx);
    // frozen — adding a property should throw in strict mode or silently fail
    expect(() => {
      (result.context as any).injected = 'bad';
    }).toThrow();
  });

  test('identical inputs produce different entryHashes (due to unique actionId)', async () => {
    const r1 = await registry.execute('echo', { message: 'same' });
    const r2 = await registry.execute('echo', { message: 'same' });
    expect(r1.entryHash).not.toBe(r2.entryHash);
  });
});

// ---------------------------------------------------------------------------
// Allowlist enforcement
// ---------------------------------------------------------------------------
describe('ToolRegistry — allowlist', () => {
  test('blocked tool returns success=false with "Tool not allowed"', async () => {
    const registry = new ToolRegistry([]); // empty allowlist
    registry.register(makeEchoTool());
    const result = await registry.execute('echo', { message: 'blocked' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool not allowed');
  });

  test('setAllowlist adds a tool to the allowed set', async () => {
    const registry = new ToolRegistry([]);
    registry.register(makeEchoTool());
    registry.setAllowlist(['echo']);
    const result = await registry.execute('echo', { message: 'now allowed' });
    expect(result.success).toBe(true);
  });

  test('unregistered tool returns error "Tool not found"', async () => {
    const registry = new ToolRegistry(['missing_tool']);
    const result = await registry.execute('missing_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool not found');
  });
});

// ---------------------------------------------------------------------------
// AJV schema validation
// ---------------------------------------------------------------------------
describe('ToolRegistry — input schema validation', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
  });

  test('invalid input (wrong type) returns "Input validation failed"', async () => {
    const result = await registry.execute('echo', { message: 42 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Input validation failed');
  });

  test('missing required property returns "Input validation failed"', async () => {
    const result = await registry.execute('echo', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Input validation failed');
  });

  test('extra properties with additionalProperties:false are rejected', async () => {
    const result = await registry.execute('echo', { message: 'ok', extra: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Input validation failed');
  });

  test('validation failure surfaces structured AJV validationErrors', async () => {
    const result = await registry.execute('echo', { message: 42 });
    expect(result.error).toBe('Input validation failed');
    expect(Array.isArray(result.validationErrors)).toBe(true);
    expect(result.validationErrors!.length).toBeGreaterThan(0);
    // AJV reports the offending instance path for the wrong-typed field.
    expect(result.validationErrors![0].instancePath).toBe('/message');
  });

  test('missing required property is named in validationErrors', async () => {
    const result = await registry.execute('echo', {});
    expect(result.error).toBe('Input validation failed');
    expect(result.validationErrors!.some(e => e.keyword === 'required')).toBe(true);
  });

  test('successful execution has no validationErrors', async () => {
    const result = await registry.execute('echo', { message: 'ok' });
    expect(result.success).toBe(true);
    expect(result.validationErrors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Execution errors
// ---------------------------------------------------------------------------
describe('ToolRegistry — execution errors', () => {
  test('throwing execute() returns success=false', async () => {
    const registry = new ToolRegistry(['thrower']);
    registry.register(makeThrowingTool());
    const result = await registry.execute('thrower', { x: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool execution failed');
  });
});

// ---------------------------------------------------------------------------
// listTools
// ---------------------------------------------------------------------------
describe('ToolRegistry — listTools', () => {
  test('returns empty array when no tools registered', () => {
    const registry = new ToolRegistry();
    expect(registry.listTools()).toHaveLength(0);
  });

  test('returns all registered tool names', () => {
    const registry = new ToolRegistry(['a', 'b']);
    registry.register(makeEchoTool('a'));
    registry.register(makeEchoTool('b'));
    expect(registry.listTools()).toEqual(expect.arrayContaining(['a', 'b']));
    expect(registry.listTools()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Hash chaining & verifyChain
// ---------------------------------------------------------------------------
describe('ToolRegistry — hash chaining', () => {
  test('first entry has previousHash undefined', async () => {
    const registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
    const result = await registry.execute('echo', { message: 'first' });
    expect(result.previousHash).toBeUndefined();
  });

  test('second entry previousHash equals first entry entryHash', async () => {
    const registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
    const r1 = await registry.execute('echo', { message: 'one' });
    const r2 = await registry.execute('echo', { message: 'two' });
    expect(r2.previousHash).toBe(r1.entryHash);
  });

  test('verifyChain returns true for an untampered chain', async () => {
    const registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
    const entries: ToolExecutionResult[] = [];
    entries.push(await registry.execute('echo', { message: 'a' }));
    entries.push(await registry.execute('echo', { message: 'b' }));
    entries.push(await registry.execute('echo', { message: 'c' }));
    expect(registry.verifyChain(entries)).toBe(true);
  });

  test('verifyChain returns false when outputHash is tampered', async () => {
    const registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
    const entries: ToolExecutionResult[] = [];
    entries.push(await registry.execute('echo', { message: 'a' }));
    entries.push(await registry.execute('echo', { message: 'b' }));
    // Tamper
    entries[0] = { ...entries[0], outputHash: 'aaaaaaaaaa' };
    expect(registry.verifyChain(entries)).toBe(false);
  });

  test('verifyChain returns false when previousHash chain is broken', async () => {
    const registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
    const entries: ToolExecutionResult[] = [];
    entries.push(await registry.execute('echo', { message: 'p' }));
    entries.push(await registry.execute('echo', { message: 'q' }));
    // Break the chain
    entries[1] = { ...entries[1], previousHash: 'wrong-hash' };
    expect(registry.verifyChain(entries)).toBe(false);
  });

  test('verifyChain returns true for an empty array', () => {
    const registry = new ToolRegistry();
    expect(registry.verifyChain([])).toBe(true);
  });

  test('verifyChain returns true for a single entry', async () => {
    const registry = new ToolRegistry(['echo']);
    registry.register(makeEchoTool());
    const entry = await registry.execute('echo', { message: 'solo' });
    expect(registry.verifyChain([entry])).toBe(true);
  });

  test('inputHash is deterministic for same input', async () => {
    // Two different registry instances — same input should produce same inputHash
    const r1 = new ToolRegistry(['echo']);
    r1.register(makeEchoTool());
    const r2 = new ToolRegistry(['echo']);
    r2.register(makeEchoTool());
    const e1 = await r1.execute('echo', { message: 'deterministic' });
    const e2 = await r2.execute('echo', { message: 'deterministic' });
    expect(e1.inputHash).toBe(e2.inputHash);
  });
});
