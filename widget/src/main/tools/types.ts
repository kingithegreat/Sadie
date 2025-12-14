/**
 * SADIE Tool System - Type Definitions
 * 
 * Defines the schema for tools that SADIE can execute locally.
 * Compatible with Ollama's tool calling format.
 */

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  items?: { type: string };
  default?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
  // Whether this tool requires user confirmation before execution
  requiresConfirmation?: boolean;
  // Any named permissions this tool requires in addition to its own execution
  // e.g., a report generator may also require `write_file` permission.
  requiredPermissions?: string[];
  // Category for grouping tools
  category?: 'filesystem' | 'system' | 'web' | 'utility' | 'voice' | 'memory' | 'document';
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
  // For confirmable tools, this indicates the operation is pending user approval
  pendingConfirmation?: boolean;
  confirmationId?: string;
  // Indicates the tool batch requires user permission confirmation before proceeding
  status?: 'needs_confirmation';
  missingPermissions?: string[];
  reason?: string;
}

// Ollama tool format (for API calls)
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// Convert our tool definition to Ollama format
export function toOllamaTool(tool: ToolDefinition): OllamaTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

// Tool execution context - passed to tool handlers
export interface ToolContext {
  // Unique ID for this tool execution
  executionId: string;
  // User ID making the request
  userId?: string;
  // Conversation ID
  conversationId?: string;
  // Callback to request user confirmation
  requestConfirmation?: (message: string) => Promise<boolean>;
  // Callback to send progress updates
  onProgress?: (message: string) => void;
  // Transient list of permissions or tool names that are allowed for this execution
  // (used for "allow once" flows during E2E and permission escalation).
  overrideAllowed?: string[];
}

// Type for tool handler functions
export type ToolHandler = (
  args: Record<string, any>,
  context: ToolContext
) => Promise<ToolResult>;

// Registry entry for a tool
export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}
