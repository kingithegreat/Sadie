**Tool Permissions: requiredPermissions and Batch Execution**

This note explains the two permission mechanisms used by the tool execution system:

- **`requiredPermissions` (ToolDefinition)**
  - Declared on a tool's definition (e.g. `requiredPermissions: ['write_file']`).
  - Enumerates any named permissions the tool or its internal operations may require.
  - Used by `executeToolBatch()` to perform a preflight permission check for all tools in a batch.
  - If any required permission is missing, the batch returns a single `needs_confirmation` result
    (no tool is executed) so the caller can prompt the user once and either `allow_once` or
    `always_allow` for the missing permissions.

- **Batch precheck behaviour**
  - All tools in the requested batch are inspected for missing permissions before any execution.
  - The batch fails fast with `status: 'needs_confirmation'` and a `missingPermissions` list when
    any permission would be denied. This prevents partial side-effects (e.g. folder created but
    file write blocked).

- **`overrideAllowed` (ToolContext)**
  - Transient list of names (permissions or tool names) passed into a tool execution when the
    caller has performed an "Allow once" action.
  - Applied only to the current retry/execution; it is never persisted to settings.
  - Tools that internally assert permissions should consult `context.overrideAllowed` so
    "Allow once" semantics are honored for nested operations.

Guidelines
  - Prefer declaring `requiredPermissions` in the tool definition instead of prompting or
    enforcing permission checks ad-hoc inside tool handlers.
  - The batch executor (and router) owns prompting the user and persisting any "Always allow"
    decisions to settings.

Small example

Tool definition (concept):
```
{ name: 'generate_sports_report', requiredPermissions: ['write_file'], parameters: { /* ... */ } }
```

Execution flow:
  1. `sadie:__e2e_invoke_tool_batch` calls `executeToolBatch(calls)`.
  2. `executeToolBatch()` inspects `requiredPermissions` and returns `needs_confirmation` if any
     permission is missing.
  3. The message router displays the permission modal; user chooses `allow_once` or `always_allow`.
  4. On `allow_once` the router re-invokes `executeToolBatch()` with `options.overrideAllowed`.

This short note should help future contributors understand when to declare permissions and how
the batch/override model avoids subtle permission and partial-effect bugs.
