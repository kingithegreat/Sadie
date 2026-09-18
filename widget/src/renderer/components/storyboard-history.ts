/**
 * Storyboard undo/redo and crash-safe drafts (MS-10).
 *
 * Editing a storyboard is the one place in Studio where a slip loses work the
 * user typed: shot text, duration, camera, characters. Two guarantees:
 *
 *  - every edit can be undone, and redone, in the order it happened;
 *  - edits survive closing the app — they are kept beside the project and
 *    offered back on the next open, never silently applied over what is saved.
 *
 * Pure functions plus an injectable storage, so both are tested without a
 * browser. Typing coalesces: one undo removes a word, not a letter, because a
 * per-keystroke history makes undo useless in a text field.
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** What produced `present`: same key inside the window coalesces. */
  lastKey?: string;
  lastAt?: number;
}

/** Keeps memory bounded on a long editing session; older steps fall off. */
export const MAX_HISTORY = 100;
/** Same field, edited again within this, is one step. */
export const COALESCE_MS = 700;

export function initialHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export interface RecordOptions {
  /** e.g. `shot:shot_01:narration` — edits to the same thing coalesce. */
  key?: string;
  now?: number;
}

/** Record an edit. Returns the same history object when nothing changed. */
export function record<T>(history: History<T>, next: T, options: RecordOptions = {}): History<T> {
  if (Object.is(next, history.present)) return history;
  const now = options.now ?? Date.now();
  const coalesce = options.key !== undefined
    && options.key === history.lastKey
    && history.lastAt !== undefined
    && now - history.lastAt < COALESCE_MS;
  if (coalesce) {
    return { ...history, present: next, future: [], lastAt: now };
  }
  const past = [...history.past, history.present];
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    future: [],
    lastKey: options.key,
    lastAt: now,
  };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const previous = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const next = h.future[0]!;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

/** Loading a different project starts a new history; the old steps are not its. */
export function reset<T>(present: T): History<T> {
  return initialHistory(present);
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface StoryboardDraft<T> {
  projectId: string;
  /** Identity of the SAVED storyboard this draft was edited from. */
  savedIdentity: string;
  savedAt: number;
  board: T;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DRAFT_PREFIX = 'homebot.storyboard.draft.';
const draftKey = (projectId: string) => `${DRAFT_PREFIX}${projectId}`;

/**
 * Browser storage throws in a private window, with site data blocked, and
 * during thumbnail capture. A draft is a convenience: never let it break
 * editing.
 */
export function browserDraftStorage(): DraftStorage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    return store;
  } catch {
    return null;
  }
}

export function saveDraft<T>(storage: DraftStorage | null, draft: StoryboardDraft<T>): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(draft.projectId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage | null, projectId: string): void {
  if (!storage) return;
  try { storage.removeItem(draftKey(projectId)); } catch { /* storage is optional */ }
}

/**
 * A draft is offered only when it belongs to this project, was edited from the
 * version that is on disk now, and actually differs from it. A draft from an
 * older version of the project is stale: the saved file won, so drop it.
 */
export function loadDraft<T>(
  storage: DraftStorage | null,
  projectId: string,
  savedIdentity: string,
  currentIdentity: (board: T) => string,
): StoryboardDraft<T> | null {
  if (!storage) return null;
  let raw: string | null;
  try { raw = storage.getItem(draftKey(projectId)); } catch { return null; }
  if (!raw) return null;
  let draft: StoryboardDraft<T>;
  try { draft = JSON.parse(raw) as StoryboardDraft<T>; } catch { clearDraft(storage, projectId); return null; }
  if (!draft || draft.projectId !== projectId || !draft.board) { clearDraft(storage, projectId); return null; }
  if (draft.savedIdentity !== savedIdentity) { clearDraft(storage, projectId); return null; }
  if (currentIdentity(draft.board) === savedIdentity) { clearDraft(storage, projectId); return null; }
  return draft;
}

/** "3 minutes ago", for the restore prompt. */
export function describeDraftAge(savedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
