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

    const moved = transition(job, to as MediaJobState, { by: 'chat', note: args.note ? String(args.note) : undefined });
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

export const mediaToolDefs: ToolDefinition[] = [
  createMediaJobDef,
  listMediaJobsDef,
  advanceMediaJobDef,
  approveMediaJobDef,
  rejectMediaJobDef,
];

export const mediaToolHandlers: Record<string, ToolHandler> = {
  media_create_job: createMediaJobHandler,
  media_list_jobs: listMediaJobsHandler,
  media_advance_job: advanceMediaJobHandler,
  media_approve_job: approveMediaJobHandler,
  media_reject_job: rejectMediaJobHandler,
};
