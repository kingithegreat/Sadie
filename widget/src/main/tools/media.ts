/**
 * media.ts — Media Studio jobs, drivable from chat.
 *
 * Phase 1 of the Media Studio plan. The state machine lives in
 * ../media-studio.ts (pure rules, no I/O); this file adds persistence and the
 * tool surface, so the pipeline is reachable the same way everything else in
 * HomeBot is: by asking for it.
 *
 * The approval gate is enforced in the state machine, not here. That is
 * deliberate — a guardrail implemented in the tool layer would be bypassed by
 * the next caller that talks to the store directly.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import {
  createJob,
  transition,
  allowedNext,
  describeProgress,
  isValidState,
  type MediaJob,
  type MediaJobState,
  type MediaFormat,
} from '../media-studio';

// ---- Store (mirrors automation.ts: atomic write, corrupt-file backup) ----

function jobsFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'media-jobs.json');
  } catch {
    // app.getPath is absent in tests.
    return path.join(process.env.TEMP || '/tmp', 'homebot-media-jobs.json');
  }
}

export function readJobs(): MediaJob[] {
  try {
    const file = jobsFilePath();
    if (!fs.existsSync(file)) return [];
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    // Back up rather than discard — the next write would otherwise overwrite
    // recoverable work, and a media job can represent hours of rendering.
    try {
      const file = jobsFilePath();
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    } catch { /* best effort */ }
    console.error('[Media Studio] media-jobs.json unreadable:', e);
    return [];
  }
}

export function writeJobs(jobs: MediaJob[]): void {
  const file = jobsFilePath();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Test seam — clears the store so suites do not leak into each other. */
export function __resetMediaJobsForTests(): void {
  try { fs.unlinkSync(jobsFilePath()); } catch { /* already gone */ }
}

function upsert(job: MediaJob): void {
  const jobs = readJobs();
  const i = jobs.findIndex(j => j.id === job.id);
  if (i >= 0) jobs[i] = job; else jobs.push(job);
  writeJobs(jobs);
}

function findJob(idOrTitle: string): MediaJob | undefined {
  const jobs = readJobs();
  const needle = (idOrTitle || '').trim().toLowerCase();
  return jobs.find(j => j.id.toLowerCase() === needle)
    ?? jobs.find(j => j.title.toLowerCase() === needle)
    ?? jobs.find(j => j.title.toLowerCase().includes(needle));
}

/**
 * Per-job asset folder. Under userData rather than temp, because a rendered
 * narration is work product that should survive a reboot — temp is swept.
 */
function mediaAssetsDir(jobId: string): string {
  try {
    return path.join(app.getPath('userData'), 'media-assets', jobId);
  } catch {
    return path.join(process.env.TEMP || '/tmp', 'homebot-media-assets', jobId);
  }
}

function summarise(j: MediaJob): string {
  return `${j.title} [${j.format}] — ${describeProgress(j)} (id: ${j.id})`;
}

// ---- Tool definitions ----

export const createMediaJobDef: ToolDefinition = {
  name: 'media_create_job',
  description:
    'Start a new video in the Media Studio pipeline. Creates the job at the "idea" stage; ' +
    'it then moves through research, scripting, QA, production and render before reaching ' +
    'you for approval. Nothing is ever published without your explicit approval.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Working title, e.g. "One-Minute Bible: Jonah"' },
      format: { type: 'string', description: '"short" (30-60s) or "long" (5-12 min). Defaults to short.', enum: ['short', 'long'] },
      brief: { type: 'string', description: 'Optional topic or angle for the video' },
    },
    required: ['title'],
  },
};

export const listMediaJobsDef: ToolDefinition = {
  name: 'media_list_jobs',
  description:
    'List videos in the Media Studio, with the stage each has reached. Use this to answer ' +
    '"what videos are in progress", "what is waiting for approval", or "what failed".',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'Optional filter, e.g. "awaiting_approval", "failed", "published"' },
    },
    required: [],
  },
};

export const advanceMediaJobDef: ToolDefinition = {
  name: 'media_advance_job',
  description:
    'Move a video to its next pipeline stage. Refuses illegal jumps, and cannot approve a ' +
    'video — approval is a separate human decision made with media_approve_job.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job id or title' },
      to: { type: 'string', description: 'Target stage, e.g. "researching", "script_draft", "awaiting_approval"' },
      note: { type: 'string', description: 'Optional reason, recorded in the job history' },
    },
    required: ['job', 'to'],
  },
};

export const approveMediaJobDef: ToolDefinition = {
  name: 'media_approve_job',
  description:
    'Approve a video that is waiting for review, allowing it to be scheduled and published. ' +
    'This is the human approval gate — only use it when the user has clearly said to approve.',
  category: 'media',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job id or title' },
      note: { type: 'string', description: 'Optional note recorded with the approval' },
    },
    required: ['job'],
  },
};

export const rejectMediaJobDef: ToolDefinition = {
  name: 'media_reject_job',
  description:
    'Reject a video waiting for review, or send it back for revision. Use reason="revise" to ' +
    'send it back for another pass, or reason="reject" to close it.',
  category: 'media',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job id or title' },
      reason: { type: 'string', description: '"revise" to send back, "reject" to close', enum: ['revise', 'reject'] },
      note: { type: 'string', description: 'What was wrong — recorded in the job history' },
    },
    required: ['job'],
  },
};

// ---- Handlers ----

const ok = (result: any): ToolResult => ({ success: true, result } as ToolResult);
const err = (error: string): ToolResult => ({ success: false, error } as ToolResult);

const createMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = createJob({
      title: String(args.title || ''),
      format: (args.format === 'long' ? 'long' : 'short') as MediaFormat,
      brief: args.brief ? String(args.brief) : undefined,
    });
    upsert(job);
    return ok(`Created "${job.title}" (${job.format}) at the idea stage. id: ${job.id}`);
  } catch (e: any) {
    return err(`media_create_job failed: ${e.message}`);
  }
};

const listMediaJobsHandler: ToolHandler = async (args) => {
  try {
    let jobs = readJobs();
    const filter = args.state ? String(args.state).trim().toLowerCase() : '';
    if (filter) jobs = jobs.filter(j => j.state === filter);
    if (jobs.length === 0) {
      return ok(filter ? `No videos are at "${filter}".` : 'No videos in the Media Studio yet.');
    }
    return ok(jobs.map(summarise).join('\n'));
  } catch (e: any) {
    return err(`media_list_jobs failed: ${e.message}`);
  }
};

const advanceMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = findJob(String(args.job || ''));
    if (!job) return err(`No media job matching "${args.job}".`);

    const to = String(args.to || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!isValidState(to)) {
      return err(`"${args.to}" is not a pipeline stage. From "${job.state}" you can go to: ${allowedNext(job.state).join(', ') || '(nowhere — terminal)'}.`);
    }

    // The kill switch is read from settings here rather than defaulted true,
    // so "publishing is off" is a real user setting and not a flag a caller
    // can forget. transition() refuses the publishing states without it.
    const { getSettings } = await import('../config-manager');
    const publishingEnabled = !!(getSettings() as any)?.mediaPublishingEnabled;

    const moved = transition(job, to as MediaJobState, {
      by: 'chat',
      note: args.note ? String(args.note) : undefined,
      publishingEnabled,
    });
    upsert(moved);
    return ok(`"${moved.title}" → ${describeProgress(moved)}`);
  } catch (e: any) {
    // The state machine's messages already name the allowed next states.
    return err(e.message);
  }
};

const approveMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = findJob(String(args.job || ''));
    if (!job) return err(`No media job matching "${args.job}".`);
    if (job.state !== 'awaiting_approval') {
      return err(`"${job.title}" is at ${describeProgress(job)}, not waiting for approval.`);
    }
    const moved = transition(job, 'approved', {
      by: 'human', humanDecision: true, note: args.note ? String(args.note) : undefined,
    });
    upsert(moved);
    return ok(`Approved "${moved.title}". It can now be scheduled and published.`);
  } catch (e: any) {
    return err(e.message);
  }
};

const rejectMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = findJob(String(args.job || ''));
    if (!job) return err(`No media job matching "${args.job}".`);
    const revise = String(args.reason || 'reject').toLowerCase() === 'revise';
    const target: MediaJobState = revise ? 'needs_revision' : 'rejected';
    const moved = transition(job, target, {
      by: 'human', humanDecision: true, note: args.note ? String(args.note) : undefined,
    });
    upsert(moved);
    return ok(revise
      ? `Sent "${moved.title}" back for revision.`
      : `Rejected "${moved.title}".`);
  } catch (e: any) {
    return err(e.message);
  }
};

export const writeMediaScriptDef: ToolDefinition = {
  name: 'media_write_script',
  description:
    'Research a video and write its narration script, using the model already configured. ' +
    'Moves the job to script_draft and reports any problems found (over-length, unverified ' +
    'claims). Does not approve or publish anything.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job id or title' },
    },
    required: ['job'],
  },
};

const writeMediaScriptHandler: ToolHandler = async (args) => {
  try {
    const job = findJob(String(args.job || ''));
    if (!job) return err(`No media job matching "${args.job}".`);
    if (job.state !== 'idea' && job.state !== 'researching' && job.state !== 'needs_revision') {
      return err(`"${job.title}" is at ${describeProgress(job)} — scripting runs from idea, researching or needs_revision.`);
    }

    // Imported here rather than at module load: this pulls in the LLM client,
    // and media.ts is loaded during tool registration at startup.
    const { generateResearch, generateScript, checkScript, estimateSpokenSeconds } =
      await import('../media-generate');

    const research = await generateResearch(job);
    const script = await generateScript(job, research.text);

    // Record the work first, then move the job — so a failed transition never
    // loses a script that cost real generation time.
    let updated: MediaJob = {
      ...job,
      script: script.text,
      sources: research.text.split('\n').filter(l => l.trim()).slice(0, 12),
    };
    if (updated.state !== 'researching') {
      updated = transition(updated, 'researching', { by: 'script stage' });
    }
    updated = transition(updated, 'script_draft', { by: 'script stage', note: `written by ${script.via}` });
    upsert(updated);

    const problems = checkScript(updated, script.text);
    const seconds = estimateSpokenSeconds(script.text);
    return ok([
      `Wrote a script for "${updated.title}" using ${script.via} (~${seconds}s spoken).`,
      problems.length ? `Worth checking:\n- ${problems.join('\n- ')}` : 'No problems found.',
      '',
      script.text,
    ].join('\n'));
  } catch (e: any) {
    return err(`Could not write the script: ${e.message}`);
  }
};

export const narrateMediaJobDef: ToolDefinition = {
  name: 'media_narrate',
  description:
    'Record the narration for a video whose script is ready, using the same voice HomeBot ' +
    'speaks with. Produces an audio file and moves the job to media_production. No account ' +
    'or API key is needed.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job id or title' },
      voice: { type: 'string', description: 'Optional voice name; defaults to HomeBot\'s configured voice' },
    },
    required: ['job'],
  },
};

const narrateMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = findJob(String(args.job || ''));
    if (!job) return err(`No media job matching "${args.job}".`);
    if (!job.script?.trim()) {
      return err(`"${job.title}" has no script yet — run media_write_script first.`);
    }
    if (job.state !== 'script_draft' && job.state !== 'script_qa') {
      return err(`"${job.title}" is at ${describeProgress(job)} — narration runs from script_draft or script_qa.`);
    }

    // Imported lazily: voice.ts pulls in the TTS engine, and media.ts loads
    // during tool registration at startup.
    const { renderNarrationToFile } = await import('./voice');
    const { estimateSpokenSeconds } = await import('../media-generate');

    const dir = mediaAssetsDir(job.id);
    const out = path.join(dir, 'narration.mp3');
    const audio = await renderNarrationToFile(job.script, out, {
      voice: args.voice ? String(args.voice) : undefined,
    });

    // Record the audio before transitioning, so a failed transition cannot
    // discard a render that took real time.
    let updated: MediaJob = { ...job, narrationPath: audio.path };
    if (updated.state === 'script_draft') {
      updated = transition(updated, 'script_qa', { by: 'narration stage' });
    }
    updated = transition(updated, 'media_production', { by: 'narration stage' });
    upsert(updated);

    const kb = Math.round(audio.bytes / 1024);
    return ok(
      `Recorded narration for "${updated.title}" (~${estimateSpokenSeconds(job.script)}s, ${kb} KB).\n${audio.path}`,
    );
  } catch (e: any) {
    return err(`Could not record the narration: ${e.message}`);
  }
};

export const mediaToolDefs: ToolDefinition[] = [
  writeMediaScriptDef,
  narrateMediaJobDef,
  createMediaJobDef,
  listMediaJobsDef,
  advanceMediaJobDef,
  approveMediaJobDef,
  rejectMediaJobDef,
];

export const mediaToolHandlers: Record<string, ToolHandler> = {
  media_write_script: writeMediaScriptHandler,
  media_narrate: narrateMediaJobHandler,
  media_create_job: createMediaJobHandler,
  media_list_jobs: listMediaJobsHandler,
  media_advance_job: advanceMediaJobHandler,
  media_approve_job: approveMediaJobHandler,
  media_reject_job: rejectMediaJobHandler,
};
