/**
 * IPC for "Report a problem" (Settings). Gathers the real inputs and writes the
 * report with problem-report.ts; nothing is sent anywhere — the person decides
 * whether and where to share the file.
 */

import { app, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getSettings } from './config-manager';
import { platformFacts, tailFile, writeProblemReport, type ProblemReportInputs } from './problem-report';

export const PROBLEM_REPORT_CHANNELS = {
  CREATE: 'homebot:problem-report:create',
  SHOW: 'homebot:problem-report:show',
} as const;

export function problemReportFolder(): string {
  // Override for tests, so an automated run never writes into the owner's Documents.
  return process.env.HOMEBOT_PROBLEM_REPORT_DIR || path.join(app.getPath('documents'), 'HomeBot Problem Reports');
}

async function gatherInputs(note: string): Promise<ProblemReportInputs> {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  let logNames: string[] = [];
  try { logNames = fs.readdirSync(logsDir).filter(name => name.endsWith('.log')).sort(); } catch { /* no logs yet */ }

  // No Media Studio job summary: Core may not import Studio code (module-boundaries test).
  // Render errors still reach the report through the logs.

  let diagnostics: unknown;
  let gpus: string[] | undefined;
  try {
    const { runDiagnostics } = await import('./diagnostics');
    const settings = getSettings();
    diagnostics = await runDiagnostics({
      ollamaUrl: settings.ollamaUrl || 'http://127.0.0.1:11434',
      n8nUrl: settings.n8nUrl || 'http://localhost:5678',
    }, app.getPath('userData'));
    const gpu = (diagnostics as { hardware?: { gpuName?: string | null; vramGB?: number | null } })?.hardware;
    if (gpu?.gpuName) gpus = [`${gpu.gpuName}${gpu.vramGB ? `, ${gpu.vramGB} GB` : ''}`];
  } catch (err) {
    diagnostics = { error: `Health checks could not run: ${(err as Error).message}` };
  }

  return {
    appVersion: app.getVersion(),
    generatedAt: new Date(),
    platform: platformFacts(),
    gpus,
    settings: getSettings(),
    logs: logNames.map(name => ({ name, tail: tailFile(path.join(logsDir, name)) })),
    mediaJobs: [],
    diagnostics,
    note,
  };
}

export function registerProblemReportIpc(): void {
  for (const channel of Object.values(PROBLEM_REPORT_CHANNELS)) ipcMain.removeHandler(channel);

  ipcMain.handle(PROBLEM_REPORT_CHANNELS.CREATE, async (_e, note?: unknown) => {
    try {
      const text = typeof note === 'string' ? note.slice(0, 4000) : '';
      const file = writeProblemReport(await gatherInputs(text), problemReportFolder());
      return { success: true, path: file };
    } catch (err) {
      return { success: false, error: `Could not create the report: ${(err as Error).message}` };
    }
  });

  // Only a report this feature wrote can be revealed.
  ipcMain.handle(PROBLEM_REPORT_CHANNELS.SHOW, async (_e, file?: unknown) => {
    if (typeof file !== 'string') return { success: false, error: 'No report to show.' };
    const folder = problemReportFolder();
    const resolved = path.resolve(file);
    const rel = path.relative(folder, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(resolved)) {
      return { success: false, error: 'That report is not in the HomeBot Problem Reports folder.' };
    }
    shell.showItemInFolder(resolved);
    return { success: true };
  });
}
