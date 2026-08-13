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

/**
 * What a model says when it means "the one we have been talking about".
 *
 * Driving the pipeline from chat, the second turn is "Write the script for
 * IT". The model passes that through verbatim, no title matched, and the whole
 * chain stopped at the first stage with a job sitting right there.
 */
const VAGUE_JOB_REFERENCES = new Set([
  '', 'it', 'that', 'this', 'the video', 'the job', 'the short', 'my video', 'current', 'latest',
]);

/** Most recently touched — what "it" means when more than one job is open. */
function mostRecent(jobs: MediaJob[]): MediaJob {
  return [...jobs].sort((a, b) => {
    const at = (j: MediaJob) => j.history[j.history.length - 1]?.at ?? '';
    return at(b).localeCompare(at(a));
  })[0];
}

function findJob(idOrTitle: string): MediaJob | undefined {
  const jobs = readJobs();
  if (!jobs.length) return undefined;
  const needle = (idOrTitle || '').trim().toLowerCase();

  const exact = jobs.find(j => j.id.toLowerCase() === needle)
    ?? jobs.find(j => j.title.toLowerCase() === needle);
  if (exact) return exact;

  // With one job in flight a pronoun is unambiguous; with several, the one
  // most recently worked on is what a person means.
  if (VAGUE_JOB_REFERENCES.has(needle)) {
    return jobs.length === 1 ? jobs[0] : mostRecent(jobs);
  }

  // Guarded: `includes('')` is true for every title, so an empty argument used
  // to select the first job silently.
  if (!needle) return undefined;
  return jobs.find(j => j.title.toLowerCase().includes(needle));
}

/**
 * The step after this one, named as the tool that performs it.
 *
 * Refusals already steer a model — "run media_write_script first" is enough to
 * redirect it. Successes said nothing, so a turn that had just advanced the
 * job left the model to infer the next stage from a pipeline it cannot see.
 * Measured driving this from chat: a 7B created the job and then wrote about
 * writing the script rather than calling the tool that writes it.
 *
 * One function, so the hint cannot drift away from the state machine the way a
 * sentence copied into six success messages would.
 */
function nextStepFor(job: MediaJob): string {
  switch (job.state) {
    case 'idea':
    case 'researching':
      return 'Next: write the script — media_write_script.';
    case 'script_draft':
    case 'script_qa':
      return 'Next: record the narration — media_narrate.';
    case 'media_production':
      return 'Next: render the video — media_render.';
    case 'render_qa':
      return 'Next: watch it, then approve with media_approve_job (or send it back with media_reject_job).';
    case 'awaiting_approval':
      return 'Waiting on a person: media_approve_job or media_reject_job. Nothing else may move it.';
    case 'needs_revision':
      return 'Next: revise the script — media_write_script.';
    case 'approved':
    case 'scheduled':
      return 'Publishing is a human decision and is switched off by default.';
    default:
      return '';
  }
}

/** Append the next step to a success message, when there is one to give. */
function withNextStep(lines: string[], job: MediaJob): string {
  const next = nextStepFor(job);
  return (next ? [...lines, '', next] : lines).join('\n');
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

/**
 * Not everything thrown is an Error.
 *
 * msedge-tts rejects with a bare string, so `e.message` is undefined and the
 * user was told "Could not record the narration: undefined" — a message that
 * names the stage and then says nothing at all. Found by running the pipeline
 * for real; every mocked test passed.
 */
function errText(e: any): string {
  if (typeof e === 'string') return e;
  return e?.message || String(e ?? 'unknown error');
}

const createMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = createJob({
      title: String(args.title || ''),
      format: (args.format === 'long' ? 'long' : 'short') as MediaFormat,
      brief: args.brief ? String(args.brief) : undefined,
    });
    upsert(job);
    return ok(withNextStep([`Created "${job.title}" (${job.format}) at the idea stage. id: ${job.id}`], job));
  } catch (e: any) {
    return err(`media_create_job failed: ${errText(e)}`);
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
    return err(`media_list_jobs failed: ${errText(e)}`);
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
    return ok(withNextStep([`"${moved.title}" → ${describeProgress(moved)}`], moved));
  } catch (e: any) {
    // The state machine's messages already name the allowed next states.
    return err(errText(e));
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
    return err(errText(e));
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
    return err(errText(e));
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
    return ok(withNextStep([
      `Wrote a script for "${updated.title}" using ${script.via} (~${seconds}s spoken).`,
      problems.length ? `Worth checking:\n- ${problems.join('\n- ')}` : 'No problems found.',
      '',
      script.text,
    ], updated));
  } catch (e: any) {
    return err(`Could not write the script: ${errText(e)}`);
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

    const dir = mediaAssetsDir(job.id);
    const out = path.join(dir, 'narration.mp3');
    const audio = await renderNarrationToFile(job.script, out, {
      voice: args.voice ? String(args.voice) : undefined,
    });

    // Captions come from the script we already have, timed against the real
    // audio length — no speech recognition, because we are not recovering
    // unknown text, only its timing. Written next to the audio so the render
    // stage finds them without a separate step anyone could forget.
    const { buildCaptions } = await import('../media-captions');
    const caps = buildCaptions(job.script, audio.bytes);
    const srtPath = path.join(dir, 'captions.srt');
    const vttPath = path.join(dir, 'captions.vtt');
    try {
      fs.writeFileSync(srtPath, caps.srt, 'utf8');
      fs.writeFileSync(vttPath, caps.vtt, 'utf8');
    } catch (e) {
      // Captions are not worth losing a finished narration over.
      console.error('[Media Studio] could not write captions:', e);
    }

    // Record the audio before transitioning, so a failed transition cannot
    // discard a render that took real time.
    let updated: MediaJob = {
      ...job,
      narrationPath: audio.path,
      captionsPath: fs.existsSync(srtPath) ? srtPath : undefined,
      durationSeconds: Math.round(caps.durationSeconds),
    };
    if (updated.state === 'script_draft') {
      updated = transition(updated, 'script_qa', { by: 'narration stage' });
    }
    updated = transition(updated, 'media_production', { by: 'narration stage' });
    upsert(updated);

    const kb = Math.round(audio.bytes / 1024);
    // Report the MEASURED duration, not the word-count estimate — the estimate
    // was only ever a stand-in until real audio existed.
    return ok(withNextStep([
      `Recorded narration for "${updated.title}" — ${Math.round(caps.durationSeconds)}s, ${kb} KB.`,
      `audio:    ${audio.path}`,
      updated.captionsPath ? `captions: ${updated.captionsPath} (${caps.cues.length} cues)` : 'captions: not written',
    ], updated));
  } catch (e: any) {
    return err(`Could not record the narration: ${errText(e)}`);
  }
};

export const setupMediaResearchDef: ToolDefinition = {
  name: 'media_setup_research',
  description:
    'Deploy the Media Studio research workflow to n8n, so scripts are written from real ' +
    'fetched sources instead of the model recalling facts. Optional — without it the ' +
    'research stage still works, just from the model alone. Also reports whether it is ' +
    'already deployed.',
  category: 'media',
  requiresConfirmation: true,
  parameters: { type: 'object', properties: {}, required: [] },
};

/**
 * Ask the deployed workflow one real question and check it answers with sources.
 *
 * A ping only proves something is registered on the path. This workflow
 * answered pings perfectly while returning an empty brief for every real
 * query, because the source it scraped served the n8n container a bot-check
 * page instead of results — so "deployed and answering" was true and useless
 * for the entire life of the feature.
 *
 * One query costs a couple of seconds at setup time and is the difference
 * between a health check and a health claim.
 */
async function researchActuallyReturnsSources(): Promise<{ ok: boolean; detail: string }> {
  try {
    const axios = (await import('axios')).default;
    const { MEDIA_RESEARCH_PATH } = await import('../n8n-media-workflows');
    const { getSettings } = await import('../config-manager');
    const base = String((getSettings() as any)?.n8nUrl || 'http://localhost:5678').replace(/\/$/, '');

    const res = await axios.post(
      `${base}/webhook/${MEDIA_RESEARCH_PATH}`,
      { topic: 'Book of Jonah' },
      { timeout: 45_000, validateStatus: () => true },
    );
    if (res.status !== 200) return { ok: false, detail: `the webhook answered HTTP ${res.status}` };

    const data: any = Array.isArray(res.data) ? res.data[0] : res.data;
    const sources = Array.isArray(data?.sources) ? data.sources : [];
    const text = String(data?.text || '').trim();
    if (!sources.length || !text) {
      return { ok: false, detail: `it returned ${sources.length} sources and ${text.length} characters of text` };
    }
    return { ok: true, detail: `a test query returned ${sources.length} sources` };
  } catch (e: any) {
    return { ok: false, detail: errText(e) };
  }
}

const setupMediaResearchHandler: ToolHandler = async () => {
  try {
    const { checkWebhook, describeWebhookStatus } = await import('../n8n-webhook-check');
    const { MEDIA_RESEARCH_PATH } = await import('../n8n-media-workflows');

    const before = await checkWebhook(MEDIA_RESEARCH_PATH, 'research for Media Studio scripts');
    if (before.status === 'n8n_unreachable') return err(describeWebhookStatus(before));

    if (before.status === 'available') {
      const proof = await researchActuallyReturnsSources();
      return proof.ok
        ? ok(`The research workflow is already deployed and working — ${proof.detail}`)
        : err(`The research workflow is deployed but returns nothing usable: ${proof.detail}`);
    }

    const { ensureMediaResearchWorkflow } = await import('../n8n-api');
    const res = await ensureMediaResearchWorkflow();
    if (!res.deployed) return err(`Could not deploy the research workflow: ${res.reason ?? 'unknown reason'}`);

    // Verify rather than assume: importing and activating can both succeed
    // while the webhook is still not registered until n8n reloads.
    const after = await checkWebhook(MEDIA_RESEARCH_PATH, 'research for Media Studio scripts');
    if (after.status !== 'available') {
      return ok(`Deployed, but the webhook is not answering yet (${after.status}). It usually registers once n8n reloads.`);
    }

    const proof = await researchActuallyReturnsSources();
    return proof.ok
      ? ok(`Research workflow deployed and working — ${proof.detail}. Scripts will now be written from fetched sources.`)
      : err(`Deployed and answering, but it returns nothing usable: ${proof.detail}`);
  } catch (e: any) {
    return err(`Could not set up the research workflow: ${errText(e)}`);
  }
};

const renderMediaJobDef: ToolDefinition = {
  name: 'media_render',
  description:
    'Render a narrated job into an actual video file: the narration audio over a background ' +
    'image with the captions burned in, sized for the format. Moves the job to render_qa. ' +
    'Needs ffmpeg installed; says so plainly if it is missing.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job id or title' },
      image: { type: 'string', description: 'Optional single background image path' },
      visuals: {
        type: 'string',
        enum: ['scenes', 'plain'],
        description: "'scenes' (default) generates a picture per scene from the script; 'plain' uses one backdrop",
      },
      style: { type: 'string', description: 'Optional art direction for generated scenes' },
      zoom: { type: 'boolean', description: 'Slow zoom, single-image renders only. Default true.' },
    },
    required: ['job'],
  },
};

const renderMediaJobHandler: ToolHandler = async (args) => {
  try {
    const job = findJob(String(args.job || ''));
    if (!job) return err(`No media job matching "${args.job}".`);
    if (!job.narrationPath || !fs.existsSync(job.narrationPath)) {
      return err(`"${job.title}" has no narration audio yet — run media_narrate first.`);
    }
    if (job.state !== 'media_production') {
      return err(`"${job.title}" is at ${describeProgress(job)} — rendering runs from media_production.`);
    }

    const {
      findFfmpeg, renderVideo, FFMPEG_MISSING_MESSAGE,
    } = await import('../media-render');

    const ffmpeg = await findFfmpeg();
    // Not an error in the job's sense: nothing is wrong with the video, a tool
    // is missing from the machine. Leave the job where it is so rendering can
    // simply be retried once ffmpeg is there.
    if (!ffmpeg) return err(FFMPEG_MISSING_MESSAGE);

    const image = args.image ? String(args.image) : null;
    if (image && !fs.existsSync(image)) {
      return err(`No image at ${image}.`);
    }

    const dir = mediaAssetsDir(job.id);
    const out = path.join(dir, 'video.mp4');
    const shape = job.format === 'long' ? 'long' : 'short';
    const captionsPath = job.captionsPath && fs.existsSync(job.captionsPath) ? job.captionsPath : null;

    // A picture per scene, unless asked for a plain backdrop or handed a
    // single image. Best-effort: every failure here degrades the look and
    // none of them stops the video being made.
    let concatPath: string | null = null;
    let visualNote = '';
    const wantScenes = String(args.visuals ?? 'scenes') === 'scenes' && !image;
    if (wantScenes && captionsPath) {
      const { groupCues, buildConcatFileContent, timelineFromCues, dimensionsFor } = await import('../media-render');
      const { generateSceneImages, fillMissingImages, seedForVideo } = await import('../media-visuals');
      const { parseSrtCues } = await import('../media-captions');

      const cues = parseSrtCues(fs.readFileSync(captionsPath, 'utf8'));
      const scenes = groupCues(cues, 5);
      if (scenes.length) {
        const { w, h } = dimensionsFor(shape);
        const images = await generateSceneImages({
          scenes,
          videoTitle: job.title,
          outDir: path.join(dir, 'scenes'),
          // Generators cap at 1024; the renderer scales and crops to fill.
          width: Math.min(w, 1024),
          height: Math.min(h, 1024),
          style: args.style ? String(args.style) : undefined,
          // One seed for the whole video, derived from its identity, so the
          // scenes look like each other and a re-render reproduces them.
          seed: seedForVideo(job.id),
        });
        const filled = fillMissingImages(images);
        const made = filled.filter(Boolean).length;
        if (made) {
          const timeline = timelineFromCues(scenes, i => filled[i]);
          concatPath = path.join(dir, 'scenes.txt');
          fs.writeFileSync(concatPath, buildConcatFileContent(timeline), 'utf8');
          const failed = images.filter(i => !i.path).length;
          visualNote = `${scenes.length} scenes` + (failed ? `, ${failed} image(s) failed and reuse a neighbour` : '');
        } else {
          visualNote = 'scene images all failed — rendered on the plain backdrop';
        }
      }
    }

    const rendered = await renderVideo({
      ffmpeg,
      audioPath: job.narrationPath,
      outputPath: out,
      shape,
      imagePath: image,
      captionsPath,
      concatPath,
      durationSeconds: job.durationSeconds || 60,
      zoom: args.zoom === undefined ? true : Boolean(args.zoom),
    });

    // Record the file before transitioning, so a failed transition cannot
    // discard a render that took real minutes.
    const updated = transition(
      { ...job, renderPath: rendered.path },
      'render_qa',
      { by: 'render stage' },
    );
    upsert(updated);

    const mb = (rendered.bytes / (1024 * 1024)).toFixed(1);
    return ok(withNextStep([
      `Rendered "${updated.title}" — ${mb} MB, ${job.durationSeconds || '?'}s${visualNote ? `, ${visualNote}` : ''}.`,
      `video: ${rendered.path}`,
      'Watch it before approving; nothing publishes on its own.',
    ], updated));
  } catch (e: any) {
    return err(`Could not render the video: ${errText(e)}`);
  }
};

export const mediaToolDefs: ToolDefinition[] = [
  writeMediaScriptDef,
  narrateMediaJobDef,
  renderMediaJobDef,
  setupMediaResearchDef,
  createMediaJobDef,
  listMediaJobsDef,
  advanceMediaJobDef,
  approveMediaJobDef,
  rejectMediaJobDef,
];

export const mediaToolHandlers: Record<string, ToolHandler> = {
  media_write_script: writeMediaScriptHandler,
  media_narrate: narrateMediaJobHandler,
  media_render: renderMediaJobHandler,
  media_setup_research: setupMediaResearchHandler,
  media_create_job: createMediaJobHandler,
  media_list_jobs: listMediaJobsHandler,
  media_advance_job: advanceMediaJobHandler,
  media_approve_job: approveMediaJobHandler,
  media_reject_job: rejectMediaJobHandler,
};
