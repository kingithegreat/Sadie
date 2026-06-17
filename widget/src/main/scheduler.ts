/**
 * HomeBot Scheduler
 *
 * Manages named recurring jobs that fire while the app is open.
 * Two trigger modes:
 *   - intervalMinutes: fires every N minutes
 *   - dailyTime ("HH:MM"): fires once per day at that wall-clock time
 *
 * When a job fires it sends 'homebot:reminder-fired' to the renderer, which
 * injects it into the chat as a system message (reuses existing reminder infra).
 *
 * Jobs are persisted to <userData>/scheduled-jobs.json so they survive restarts.
 */

import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScheduledJob {
  id: string;
  name: string;
  /** Message injected into chat when the job fires */
  message: string;
  /** How often to fire, in minutes. Ignored when dailyTime is set. */
  intervalMinutes: number;
  /** Optional "HH:MM" for a daily job (fires once per day at this time) */
  dailyTime?: string;
  enabled: boolean;
  lastFiredAt?: number;
  createdAt: number;
}

// ── Persistence ────────────────────────────────────────────────────────────────

function jobsFilePath(): string {
  return path.join(app.getPath('userData'), 'scheduled-jobs.json');
}

let jobs: ScheduledJob[] = [];
const timers = new Map<string, ReturnType<typeof setInterval>>();

function saveJobs(): void {
  try {
    fs.writeFileSync(jobsFilePath(), JSON.stringify(jobs, null, 2), 'utf8');
  } catch (e) {
    console.error('[Scheduler] Failed to save jobs:', e);
  }
}

// ── Fire logic ─────────────────────────────────────────────────────────────────

function fireJob(id: string): void {
  const job = jobs.find(j => j.id === id);
  if (!job || !job.enabled) return;

  const windows = BrowserWindow.getAllWindows();
  if (!windows.length) return;
  const win = windows[0];
  if (win.isDestroyed()) return;

  win.webContents.send('homebot:reminder-fired', { message: job.message, label: job.name });
  job.lastFiredAt = Date.now();
  saveJobs();
  console.log(`[Scheduler] Fired job "${job.name}"`);
}

// ── Timer helpers ──────────────────────────────────────────────────────────────

function stopTimer(id: string): void {
  const t = timers.get(id);
  if (t !== undefined) {
    clearInterval(t);
    timers.delete(id);
  }
}

function startTimer(job: ScheduledJob): void {
  stopTimer(job.id);
  if (!job.enabled) return;

  if (job.dailyTime) {
    // Poll every 60 s; fire when wall-clock matches and hasn't fired today yet
    const [targetHour, targetMinute] = job.dailyTime.split(':').map(Number);
    const timer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === targetHour && now.getMinutes() === targetMinute) {
        const lastDate = job.lastFiredAt ? new Date(job.lastFiredAt).toDateString() : null;
        if (lastDate !== new Date().toDateString()) {
          fireJob(job.id);
        }
      }
    }, 60_000);
    timers.set(job.id, timer);
  } else {
    const ms = Math.max(job.intervalMinutes, 1) * 60_000;
    const timer = setInterval(() => fireJob(job.id), ms);
    timers.set(job.id, timer);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function initScheduler(): void {
  try {
    const raw = fs.readFileSync(jobsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) jobs = parsed;
  } catch {
    jobs = [];
  }

  for (const job of jobs) {
    if (job.enabled) startTimer(job);
  }

  console.log(`[Scheduler] Initialized — ${jobs.length} job(s) loaded`);
}

export function listJobs(): ScheduledJob[] {
  return jobs;
}

export function addJob(input: Omit<ScheduledJob, 'id' | 'createdAt'>): ScheduledJob {
  const job: ScheduledJob = {
    ...input,
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  jobs.push(job);
  saveJobs();
  if (job.enabled) startTimer(job);
  return job;
}

export function removeJob(id: string): boolean {
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return false;
  stopTimer(id);
  jobs.splice(idx, 1);
  saveJobs();
  return true;
}

export function toggleJob(id: string, enabled: boolean): ScheduledJob | null {
  const job = jobs.find(j => j.id === id);
  if (!job) return null;
  job.enabled = enabled;
  saveJobs();
  if (enabled) {
    startTimer(job);
  } else {
    stopTimer(id);
  }
  return job;
}
