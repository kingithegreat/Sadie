/**
 * @deprecated This module is unused. All n8n communication goes through the
 * main process via IPC (see ipc-handlers.ts and message-router.ts) which
 * attaches the required X-HOMEBOT-Auth header automatically.
 *
 * Renderer code should use window.electron.sendMessage() instead.
 */
export {};
