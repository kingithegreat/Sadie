

import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import crypto from 'crypto';
import stringify from 'json-stable-stringify';

export interface ExecutionContext {
  userId?: string;
  role?: string;
  workflowId?: string;
  requestId?: string;
}

export interface Tool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: object;  // loose schema type
  execute: (input: TInput, context?: ExecutionContext) => Promise<TOutput>;
}


interface RegisteredTool<TInput = any, TOutput = any> {
  tool: Tool<TInput, TOutput>;
  validate: ValidateFunction<any>;
}

export interface ToolExecutionResult<TInput = any, TOutput = any> {
  timestamp: string;
  toolName: string;
  actionId: string;
  success: boolean;
  inputHash: string;
  outputHash?: string;
  previousHash?: string;
  entryHash: string;
  output: TOutput | null;
  error?: string;
  context?: ExecutionContext;
}


export class ToolRegistry {
  private tools = new Map<string, RegisteredTool<any, any>>();
  private allowlist: Set<string>;
  private ajv = new Ajv();
  private previousHash: string | undefined = undefined;

  constructor(allowlist: string[] = []) {
    this.allowlist = new Set(allowlist);
  }

  register<TInput, TOutput>(tool: Tool<TInput, TOutput>) {
    const validate = this.ajv.compile(tool.inputSchema);
    this.tools.set(tool.name, { tool, validate });
  }

  setAllowlist(names: string[]) {
    this.allowlist = new Set(names);
  }

  async execute<TInput, TOutput>(
    toolName: string,
    input: TInput,
    context?: ExecutionContext
  ): Promise<ToolExecutionResult<TInput, TOutput>> {
    const reg = this.tools.get(toolName);
    const timestamp = new Date().toISOString();
    const actionId = crypto.randomUUID();
    const inputHash = sha256Hash(stableStringify(input));
    let output: TOutput | null = null;
    let outputHash: string | undefined = undefined;
    let error: string | undefined = undefined;
    let success = false;
    const safeContext = context ? Object.freeze({ ...context }) : undefined;
    const previousHash = this.previousHash;

    if (!reg) {
      error = 'Tool not found';
    } else if (!this.allowlist.has(toolName)) {
      error = 'Tool not allowed';
    } else if (!reg.validate(input)) {
      error = 'Input validation failed';
    } else {
      try {
        output = await reg.tool.execute(input, safeContext);
        outputHash = sha256Hash(stableStringify(output));
        success = true;
      } catch {
        error = 'Tool execution failed';
      }
    }

    // Hash chaining: entryHash = SHA256(previousHash + inputHash + outputHash + timestamp + toolName + actionId)
    const entryHash = sha256Hash(
      [
        previousHash || '',
        inputHash,
        outputHash || '',
        timestamp,
        toolName,
        actionId
      ].join('|')
    );

    const result: ToolExecutionResult<TInput, TOutput> = {
      timestamp,
      toolName,
      actionId,
      success,
      inputHash,
      outputHash,
      previousHash,
      entryHash,
      output,
      error,
      context: safeContext
    };

    this.previousHash = entryHash;
    return result;
  }

  // Verifies a chain of execution log entries. Returns true if valid, false if tampered.
  verifyChain<TInput = any, TOutput = any>(
    entries: Array<ToolExecutionResult<TInput, TOutput>>
  ): boolean {
    let prevHash = undefined;
    for (const entry of entries) {
      const expectedEntryHash = sha256Hash(
        [
          entry.previousHash || '',
          entry.inputHash,
          entry.outputHash || '',
          entry.timestamp,
          entry.toolName,
          entry.actionId
        ].join('|')
      );
      if (entry.previousHash !== prevHash) return false;
      if (entry.entryHash !== expectedEntryHash) return false;
      prevHash = entry.entryHash;
    }
    return true;
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}


function sha256Hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function stableStringify(obj: any): string {
  return stringify(obj) ?? '';
}

// Example usage:
// import stringify from 'json-stable-stringify';
// const registry = new ToolRegistry();
// registry.register({
//   name: 'echo',
//   description: 'Echoes input',
//   inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
//   execute: async ({ message }) => message,
// });
// registry.setAllowlist(['echo']);
// registry.execute('echo', { message: 'Hello' }, { userId: 'u1' }).then(console.log);
