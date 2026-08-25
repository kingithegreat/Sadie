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
import { automationsFilePath, fireAutomationById } from './tools/automation';

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

/**
 * Shape of the fields this module reads from automations.json. The full
 * StoredAutomation lives in tools/automation.ts — kept loose here so the
 * scheduler never imports the tool layer's Electron side; only these three
 * fields decide whether a watcher exists.
 */
interface WatchableAutomation {
  id: string;
  trigger: string;
  enabled: boolean;
  watchPath?: string;
  watchPattern?: string;
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

  // Arm file-watch automation triggers. Failure must not take the reminder
  // scheduler down with it — a missing folder or an unwritable userData is a
  // per-automation condition, not a scheduler-wide one.
  try {
    initFileWatchTriggers();
  } catch (e) {
    console.error('[Scheduler] File-watch triggers failed to start:', e);
  }
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

// ══ File-watch automation triggers ═══════════════════════════════════════════
//
// The third trigger type: an automation with trigger="file" runs when a file
// appears (or changes) inside its watched folder. This is the firing half —
// a trigger type without it would be a UI promise the app never keeps.
//
// Design mirrors how scheduled automations stay decoupled from their writers:
// nothing here needs to be told when automations.json changes. The store is
// shared by chat tools, IPC handlers and hand edits, so this engine watches
// the FILE'S FOLDER for writes to automations.json itself and re-syncs the
// per-automation watchers from what it reads — same "resync from disk"
// pattern as the 60s schedule loop in ipc-handlers.ts, just event-driven.
//
// Watching the folder rather than the file is deliberate: writeAutomations
// saves atomically via temp-file + rename, which orphans a watch handle on
// the old file object after the very first save.

const WATCH_STORE_FILE = 'automations.json';

const watchers = new Map<string, { watcher: fs.FSWatcher; sig: string; dir: string }>();
let storeWatcher: fs.FSWatcher | null = null;
let storeResync: ReturnType<typeof setTimeout> | null = null;
// Safety net for a missed directory event — the atomic temp+rename save can
// lose one on some platforms. Same reasoning as ipc-handlers' 60s schedule
// resync: eventual consistency, cheap because the reconcile is diffed.
let periodicResync: ReturnType<typeof setInterval> | null = null;

/** Coalesce the burst of events one file operation produces into one run. */
const pendingRuns = new Map<string, ReturnType<typeof setTimeout>>();
/** Automations currently executing — a slow run must not stack up repeats. */
const runningNow = new Set<string>();

/**
 * Filename filter: `*` and `?` wildcards on the base name, case-insensitive.
 * Anything else in the pattern is literal.
 */
function matchesWatchPattern(fileName: string, pattern?: string): boolean {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(fileName);
}

function desiredFileWatches(): Map<string, string> {
  const wanted = new Map<string, string>();
  try {
    const raw = fs.readFileSync(automationsFilePath(), 'utf8');
    const parsed: WatchableAutomation[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return wanted;
    for (const a of parsed) {
      if (a.trigger === 'file' && a.enabled && a.watchPath) {
        wanted.set(a.id, `${a.watchPath}|${a.watchPattern || ''}`);
      }
    }
  } catch {
    // Unreadable store: keep current watchers rather than guessing. The next
    // successful save re-syncs.
  }
  return wanted;
}

function notifyRenderer(message: string, label: string): void {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('homebot:reminder-fired', { message, label });
    }
  } catch { /* renderer not up yet */ }
}

async function runWatchedAutomation(id: string, dir: string, pattern?: string): Promise<void> {
  // Freshness check at the engine, not just the runner: the watcher may have
  // armed seconds ago and the automation deleted since. Reading the shared
  // store here is the same move the scheduled-timer loop makes per tick.
  const current = readAutomationRecord(id);
  if (!current || !current.enabled) {
    console.log(`[Scheduler] File trigger for ${id} skipped — automation gone or disabled`);
    return;
  }
  if (runningNow.has(id)) {
    console.log(`[Scheduler] File trigger for ${id} skipped — previous run still in flight`);
    return;
  }
  runningNow.add(id);
  try {
    let fileName: string | undefined;
    try {
      // Newest matching entry wins — good enough to name the culprit.
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile() && matchesWatchPattern(e.name, pattern))
        .map(e => ({ name: e.name, m: fs.statSync(path.join(dir, e.name)).mtimeMs }))
        .sort((a, b) => b.m - a.m);
      fileName = entries[0]?.name;
    } catch { /* folder vanished mid-run; fire anyway */ }

    const res = await fireAutomationById(id, fileName ? { fileName } : undefined);
    if (res.fired) {
      console.log(`[Scheduler] File trigger fired "${current.name}"${fileName ? ` on ${fileName}` : ''} → ${res.success ? 'ok' : `error: ${res.error}`}`);
      notifyRenderer(
        `Automation "${current.name ?? id}" ran on ${fileName || 'a new file'}: ${res.success ? 'done' : res.error || 'failed'}`,
        current.name ?? id,
      );
    }
  } finally {
    runningNow.delete(id);
  }
}

function readAutomationRecord(id: string): WatchableAutomation & { name?: string } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(automationsFilePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed.find((a: any) => a.id === id) : undefined;
  } catch { return undefined; }
}

function scheduleRun(id: string, dir: string, pattern?: string): void {
  const existing = pendingRuns.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingRuns.delete(id);
    void runWatchedAutomation(id, dir, pattern);
  }, 300);
  (t as any).unref?.();
}

/** Record why a watcher could not arm where the UI already looks. */
function recordWatchFailure(id: string, message: string): void {
  try {
    const file = automationsFilePath();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) {
      const auto = parsed.find((a: any) => a.id === id);
      if (auto) {
        auto.lastStatus = 'error';
        auto.lastResult = `Trigger could not start: ${message}`;
        fs.writeFileSync(file, JSON.stringify(parsed, null, 2), 'utf8');
      }
    }
  } catch { /* store unreadable — the resync will retry on next change */ }
}

function stopWatch(id: string): void {
  const w = watchers.get(id);
  if (w) {
    try { w.watcher.close(); } catch { /* already closed */ }
    watchers.delete(id);
  }
}

/** Reconcile active watchers with what automations.json asks for right now. */
export function resyncFileWatchTriggers(): void {
  const wanted = desiredFileWatches();

  for (const [id, existing] of watchers) {
    if (wanted.get(id) !== existing.sig) stopWatch(id);
  }

  for (const [id, sig] of wanted) {
    if (watchers.has(id)) continue;
    const [dir, pattern] = sig.split('|');
    try {
      // Throws ENOENT etc. when the folder is gone — say so on the record
      // instead of leaving an automation that silently never fires.
      fs.accessSync(dir, fs.constants.W_OK);
      const watcher = fs.watch(dir, { persistent: false }, (_event, fileName) => {
        if (fileName && !matchesWatchPattern(String(fileName), pattern)) return;
        scheduleRun(id, dir, pattern);
      });
      watchers.set(id, { watcher, sig, dir });
      console.log(`[Scheduler] Watching "${dir}" for automation ${id}${pattern ? ` (${pattern})` : ''}`);
    } catch (e: any) {
      console.warn(`[Scheduler] Could not watch "${dir}" for automation ${id}:`, e?.message || e);
      recordWatchFailure(id, e?.message || String(e));
    }
  }
}

/**
 * Start the engine. Safe to call twice and safe when no automations exist
 * yet — it arms again automatically on the first save to automations.json.
 */
export function initFileWatchTriggers(): void {
  if (storeWatcher) return;
  const storeDir = path.dirname(automationsFilePath());
  try {
    storeWatcher = fs.watch(storeDir, { persistent: false }, (_event, fileName) => {
      if (fileName && String(fileName) !== WATCH_STORE_FILE) return;
      if (storeResync) clearTimeout(storeResync);
      storeResync = setTimeout(resyncFileWatchTriggers, 250);
      (storeResync as any).unref?.();
    });
    storeWatcher.on('error', () => {
      // Folder watch died (userData removed under us?) — allow a future init.
      try { storeWatcher?.close(); } catch { /* ignore */ }
      storeWatcher = null;
    });
  } catch (e: any) {
    console.warn('[Scheduler] Could not watch automations.json for changes:', e?.message || e);
    return;
  }
  periodicResync = setInterval(resyncFileWatchTriggers, 30_000);
  (periodicResync as any).unref?.();
  resyncFileWatchTriggers();
}

/** Stop everything — used by tests so jest can exit, and safe to re-init after. */
export function stopFileWatchTriggers(): void {
  for (const id of [...watchers.keys()]) stopWatch(id);
  if (storeResync) { clearTimeout(storeResync); storeResync = null; }
  if (periodicResync) { clearInterval(periodicResync); periodicResync = null; }
  if (storeWatcher) { try { storeWatcher.close(); } catch { /* ignore */ } storeWatcher = null; }
  for (const t of pendingRuns.values()) clearTimeout(t);
  pendingRuns.clear();
}
