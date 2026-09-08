/**
 * Moving the user around the app, and what travels with them.
 *
 * Chat is meant to be the front door to everything: either it happens in the
 * conversation, or the conversation takes you to the place that does it with
 * what you were discussing already loaded. `modes.ts` already named the
 * destinations and promised a `navigate_to_mode` tool would validate against
 * them — but no such tool existed, `setMode` had exactly one caller family (the
 * keyboard shortcuts in App.tsx), and nothing could carry context across a
 * switch. This file is the missing half.
 *
 * The mode list deliberately lives in `modes.ts` and is imported, not restated.
 * Adding a panel stays one edit in one place.
 */

import { APP_MODES, isAppMode, type AppMode } from './modes';

/**
 * What each destination is called in front of a user, and what it is for.
 *
 * Not the internal names: 'media' is "Media Studio" and 'dashboard' is "Home",
 * because the model writes these into sentences a person reads. The purposes
 * are what the model chooses a destination *from*, so they describe what the
 * panel does rather than what it is called.
 */
export const MODE_INFO: Record<AppMode, { label: string; purpose: string }> = {
  chat: { label: 'Chat', purpose: 'ordinary conversation' },
  automation: { label: 'Automations', purpose: 'create, edit, schedule and run automations' },
  image: { label: 'Images', purpose: 'generate and edit images' },
  documents: { label: 'Documents', purpose: 'read, search and ask questions about files' },
  quiz: { label: 'Quiz', purpose: 'generate practice questions from material' },
  dashboard: { label: 'Home', purpose: 'the overview screen' },
  media: { label: 'Media Studio', purpose: 'turn an idea into a visual storyboard, narrated video, animate Ancient Pathways episodes, or recap podcasts' },
  browser: { label: 'Browser', purpose: 'browse the web inside the app' },
  code: { label: 'Code', purpose: 'explore, edit and run code in the workspace' },
  feeds: { label: 'Feeds', purpose: 'read and search news and RSS feeds' },
  connections: { label: 'Connections', purpose: 'connect HomeBot to outside services such as Notion, GitHub or Slack' },
};

/**
 * A request to move the user somewhere.
 *
 * `payload` is what makes this a handoff rather than a redirect. A destination
 * reads the keys it understands and ignores the rest, so a panel can start
 * accepting context without every caller changing at once.
 *
 * `reason` is for the user, not the model — someone whose screen just changed
 * is owed a sentence saying why.
 */
export interface NavRequest {
  mode: AppMode;
  payload?: Record<string, unknown>;
  reason?: string;
}

/** IPC channel main uses to push a navigation to the renderer. */
export const NAV_CHANNEL = 'homebot:navigate-to-mode';

/** Human-readable destination list, for tool descriptions and error messages. */
export function describeModes(): string {
  return APP_MODES.map(m => `"${m}" — ${MODE_INFO[m].purpose}`).join('; ');
}

/**
 * Coerce anything into a NavRequest, or explain why it isn't one.
 *
 * The model supplies these, so the mode arrives as free text and is wrong often
 * enough to matter. Rejecting it *with the list of real destinations* lets the
 * model correct itself on the next turn; an opaque error does not.
 */
export function parseNavRequest(input: unknown): { ok: true; request: NavRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Navigation request must be an object.' };
  }

  const raw = input as Record<string, unknown>;
  const mode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : '';

  if (!isAppMode(mode)) {
    return {
      ok: false,
      error: `"${String(raw.mode ?? '')}" is not somewhere this app can go. Valid destinations: ${describeModes()}.`,
    };
  }

  const request: NavRequest = { mode };

  // An explicit null payload is a normal way to say "no context", so only a real
  // object is carried forward. A malformed payload is dropped rather than
  // rejected — it should not block an otherwise valid destination.
  if (raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)) {
    request.payload = raw.payload as Record<string, unknown>;
  }

  if (typeof raw.reason === 'string' && raw.reason.trim()) {
    request.reason = raw.reason.trim();
  }

  return { ok: true, request };
}
