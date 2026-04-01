// Paste this as the FINAL Code node in every n8n tool workflow
// Inputs from previous node: toolName, requestId, result OR error
// startTime must be set in the FIRST Code node of each workflow:
//   const startTime = Date.now();
//   $workflow.staticData.currentRequestStart = startTime;

const startTime = $workflow.staticData.currentRequestStart || Date.now();
const now = Date.now();
const durationMs = now - startTime;

const toolName = $json.toolName || 'unknown';
const requestId = $json.requestId || $input.first().json.requestId || 'no-id';
const result = $json.result ?? null;
const error = $json.error ?? null;

// Clear the start time after use
delete $workflow.staticData.currentRequestStart;

return [
  {
    json: {
      success: !error,
      tool: toolName,
      requestId,
      durationMs,
      result: error ? null : result,
      error: error
        ? {
            code: error.code || 'EXECUTION_ERROR',
            message: error.message || String(error),
            retryable: typeof error.retryable === 'boolean' ? error.retryable : true,
          }
        : null,
    },
  },
];
