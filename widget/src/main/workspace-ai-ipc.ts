import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { approveWorkspacePlan, prepareWorkspacePlan, validateWorkspaceRoot } from './workspace-context';
import { compareWorkspaceCheckpoint, compareWorkspaceCheckpointRun, listWorkspaceCheckpointRuns, listWorkspaceCheckpoints, restoreWorkspaceCheckpoint, restoreWorkspaceCheckpointRun } from './workspace-checkpoints';
import { readWorkspaceRules, searchWorkspaceCode } from './workspace-code-context';
import { getMcpStatus, loadMcpConfig } from './mcp-client';
import { getSettings } from './config-manager';
import { completeWorkspaceCode } from './workspace-completion';
import { getMainWindow } from './window-manager';
import { listTrustedWorkspaceFolders, revokeTrustedWorkspaceFolder } from './workspace-trust';

export const WORKSPACE_AI_CHANNELS = {
  SESSION: 'homebot:workspace-ai:session', SAVE_SESSION: 'homebot:workspace-ai:save-session',
  PREPARE_PLAN: 'homebot:workspace-ai:prepare-plan', APPROVE_PLAN: 'homebot:workspace-ai:approve-plan',
  RULES: 'homebot:workspace-ai:rules', SEARCH: 'homebot:workspace-ai:search',
  CHECKPOINTS: 'homebot:workspace-ai:checkpoints', CHECKPOINT_DIFF: 'homebot:workspace-ai:checkpoint-diff', RESTORE: 'homebot:workspace-ai:restore', MCP: 'homebot:workspace-ai:mcp',
  COMPLETE: 'homebot:workspace-ai:complete',
  COMPARE_RUN: 'homebot:workspace-ai:compare-run', RESTORE_RUN: 'homebot:workspace-ai:restore-run',
  TRUSTED_FOLDERS: 'homebot:workspace-ai:trusted-folders', REVOKE_FOLDER: 'homebot:workspace-ai:revoke-folder',
} as const;
function sessionFile(root: unknown) {
  const canonical = validateWorkspaceRoot(root), digest = createHash('sha256').update(canonical).digest('hex');
  return path.join(app.getPath('userData'), 'ide-conversations', `${digest}.json`);
}
export function registerWorkspaceAiHandlers() {
  for (const channel of Object.values(WORKSPACE_AI_CHANNELS)) ipcMain.removeHandler(channel);
  const safe = (run: (...args: any[]) => any) => async (...args: any[]) => {
    try {
      const event = args[0], window = getMainWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return { success: false, error: 'Open this action in the HomeBot IDE.' };
      return { success: true, ...(await run(...args)) };
    }
    catch (error) { return { success: false, error: (error as Error).message }; }
  };
  ipcMain.handle(WORKSPACE_AI_CHANNELS.SESSION, safe((_event, root) => {
    const file = sessionFile(root);
    if (getSettings().saveConversationHistory === false) return { turns: [], persistent: false };
    if (!fs.existsSync(file)) return { turns: [] };
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('This conversation exceeds the recovery limit.');
    const turns = JSON.parse(fs.readFileSync(file, 'utf8')).turns;
    if (!Array.isArray(turns) || turns.length > 100 || turns.some(turn => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.id !== 'string' || typeof turn.text !== 'string')) throw new Error('The saved conversation is invalid. Its original file was preserved.');
    return { turns };
  }));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.SAVE_SESSION, safe((_event, root, turns) => {
    const file = sessionFile(root);
    if (getSettings().saveConversationHistory === false) return { persistent: false };
    if (!Array.isArray(turns) || turns.length > 100 || Buffer.byteLength(JSON.stringify(turns)) > 1_000_000) throw new Error('Conversation limit reached. Clear older history before continuing.');
    const clean = turns.map((turn: any) => {
      if (!turn || !['user', 'assistant'].includes(turn.role) || typeof turn.text !== 'string' || typeof turn.id !== 'string') throw new Error('Invalid conversation turn.');
      return { id: turn.id, role: turn.role, text: turn.text, error: !!turn.error, context: Array.isArray(turn.context) ? turn.context.filter((item: unknown) => typeof item === 'string').slice(0, 30) : undefined };
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temporary, JSON.stringify({ turns: clean }), { mode: 0o600 }); fs.renameSync(temporary, file);
    return {};
  }));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.PREPARE_PLAN, safe((event, root, text) => prepareWorkspacePlan(root, text, event.sender.id)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.APPROVE_PLAN, safe((event, root, id) => approveWorkspacePlan(root, id, event.sender.id)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.RULES, safe((_event, root) => ({ rules: readWorkspaceRules(root) })));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.SEARCH, safe((_event, root, query, semantic) => searchWorkspaceCode(root, query, semantic === true)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.COMPLETE, safe((_event, root, prefix, suffix) => completeWorkspaceCode(root, prefix, suffix)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.CHECKPOINTS, safe((_event, root) => ({ checkpoints: listWorkspaceCheckpoints(root), runs: listWorkspaceCheckpointRuns(root) })));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.CHECKPOINT_DIFF, safe((_event, root, id) => compareWorkspaceCheckpoint(root, id)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.RESTORE, safe((_event, root, id, options) => restoreWorkspaceCheckpoint(root, id, options)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.COMPARE_RUN, safe((_event, root, id) => compareWorkspaceCheckpointRun(root, id)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.RESTORE_RUN, safe((_event, root, id, options) => restoreWorkspaceCheckpointRun(root, id, options)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.TRUSTED_FOLDERS, safe(() => ({ roots: listTrustedWorkspaceFolders() })));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.REVOKE_FOLDER, safe((event, root) => revokeTrustedWorkspaceFolder(event, root)));
  ipcMain.handle(WORKSPACE_AI_CHANNELS.MCP, safe(() => {
    const connected = getMcpStatus(), configuration = loadMcpConfig();
    return { servers: (configuration.servers || []).map(server => connected.find(item => item.name === server.name) || { name: server.name, type: server.type, connected: false, toolCount: 0 }) };
  }));
}
