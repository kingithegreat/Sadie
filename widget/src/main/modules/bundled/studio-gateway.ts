import type { IpcMainInvokeEvent } from 'electron';
import { ModuleContractError } from '../../../shared/modules/contracts';
import { getMainWindow } from '../../window-manager';
import { requestConfirmationFrom } from '../../message-router';
import { getTool, getToolOwner } from '../../tools/registry';
import type { ToolResult } from '../../tools/types';
import { bundledModuleHost, initializeBundledModules } from './index';
import { STUDIO_MODULE_ID } from './studio';
import { registerStudioIpc, StudioIpcGuard } from './studio-ipc';

/** Fixed channel identity belongs to main; renderer arguments cannot select a module. */
const signatures: Record<string, string[]> = {
  list: [], 'parse-feed': ['string'], create: ['object'], run: ['string', 'string', 'object?'],
  advance: ['string', 'string', 'string?'], approve: ['string', 'string?'], reject: ['string', 'boolean', 'string?'],
  'ffmpeg-status': [], 'ffmpeg-setup': [], 'mark-published': ['string', 'string', 'string?'], delete: ['string', 'boolean?'],
  'trim-clip': ['object'], 'splice-video': ['object'], 'ancient-pathways-episodes': [], 'ancient-pathways-status': [],
  'ancient-pathways-doctor': ['string'], 'ancient-pathways-run': ['string'], 'ancient-pathways-showrunner': ['object'],
  'movie:run': ['object'], 'movie:list-projects': [], 'storyboard:create': ['object'], 'storyboard:list': [],
  'storyboard:get': ['string'], 'storyboard:generate-frame': ['object'], 'storyboard:save': ['object'],
  'storyboard:render': ['object'], 'storyboard:breakdown': ['object'],
  'youtube:status': [], 'youtube:import': [], 'youtube:connect': [],
  'youtube:refresh': [], 'youtube:cancel': [], 'youtube:remove': [],
};

function validArgs(channel: string, args: unknown[]): boolean {
  const signature = signatures[channel.slice('homebot:media:'.length)];
  if (!signature || args.length > signature.length) return false;
  return signature.every((type, index) => {
    const value = args[index];
    if (type.endsWith('?') && value === undefined) return true;
    return type.startsWith('object')
      ? !!value && typeof value === 'object' && !Array.isArray(value)
      : typeof value === type.replace('?', '');
  });
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const window = getMainWindow();
  return !!window && !window.isDestroyed() && event?.sender === window.webContents &&
    !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
}

const studioGuard: StudioIpcGuard = (channel, handler) => async (event, ...args) => {
  if (!trustedSender(event)) return { ok: false, code: 'INVALID_SENDER', error: 'Open Production Studio in the HomeBot window.' };
  if (!validArgs(channel, args)) return { ok: false, code: 'INVALID_ARGUMENT', error: 'That Studio request is incomplete or invalid.' };
  try { return await bundledModuleHost.invoke(STUDIO_MODULE_ID, () => handler(event, ...args)); }
  catch (error) {
    if (error instanceof ModuleContractError) return { ok: false, code: error.code, error: error.message };
    return { ok: false, code: 'STUDIO_REQUEST_FAILED', error: 'Production Studio could not complete that request.' };
  }
};

/** Same batch permission authority as chat; any one-use grant is acquired by main. */
async function invokeStudioTool(event: IpcMainInvokeEvent, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  bundledModuleHost.assertEnabled(STUDIO_MODULE_ID);
  const owner = getToolOwner(name);
  const registered = getTool(name);
  if (!registered || owner?.moduleId !== STUDIO_MODULE_ID) return { success: false, code: 'MODULE_UNAVAILABLE', error: 'That Studio action is unavailable.' };
  const { executeToolBatch } = await import('../../tools');
  const call = { name, arguments: args };
  const context = { executionId: `studio-${name}-${Date.now()}`, requestConfirmation: (message: string) => requestConfirmationFrom(event.sender, message) };
  const result = (await executeToolBatch([call], context))[0];
  if (!result) return { success: false, code: 'STUDIO_REQUEST_FAILED', error: 'That Studio action returned no result.' };
  if (result.status !== 'needs_confirmation') return result;
  const approved = await context.requestConfirmation(`Allow this Studio action once?\n${registered.definition.description}\n${JSON.stringify(args)}`);
  if (!approved) return { success: false, code: 'PERMISSION_DENIED', error: 'Operation cancelled by user.' };
  // Consent is tied to this registration and these arguments, never a replacement handler.
  bundledModuleHost.assertEnabled(STUDIO_MODULE_ID);
  if (getTool(name) !== registered) return { success: false, code: 'MODULE_UNAVAILABLE', error: 'That Studio action changed while waiting for approval.' };
  const results = await executeToolBatch([call], { executionId: context.executionId }, { overrideAllowed: result.missingPermissions });
  return results[0] || { success: false, code: 'STUDIO_REQUEST_FAILED', error: 'That Studio action returned no result.' };
}

export function registerBundledStudioIpc(): void {
  initializeBundledModules();
  registerStudioIpc(studioGuard, invokeStudioTool, () => bundledModuleHost.assertEnabled(STUDIO_MODULE_ID));
}
