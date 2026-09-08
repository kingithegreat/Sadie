/**
 * Lets the assistant take the user somewhere in the app.
 *
 * `shared/modes.ts` has described this tool since it was written — "main (the
 * navigate_to_mode tool validates against this list before forwarding)" — but
 * the tool itself never existed. HomeBot could open a *web browser*
 * (`open_url`, `open_in_browser`) and could not move you anywhere inside
 * itself; asked for something a panel does, the best it managed was describing
 * where the button was.
 *
 * It carries a payload deliberately. A redirect into an empty panel leaves the
 * user to set up again what they just finished explaining in chat, which is the
 * same dead end with extra steps.
 */

import { BrowserWindow } from 'electron';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { APP_MODES } from '../../shared/modes';
import {
  MODE_INFO,
  NAV_CHANNEL,
  describeModes,
  parseNavRequest,
} from '../../shared/navigation';

/**
 * The window to navigate.
 *
 * Looked up rather than cached, matching voice.ts: tools are registered once at
 * startup and the window can be recreated underneath them, so a held reference
 * goes stale where a lookup does not.
 */
function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ?? null;
}

export const navigateToModeDef: ToolDefinition = {
  name: 'navigate_to_mode',
  description:
    'Take the user to another part of HomeBot, carrying context with them. Use this when what ' +
    'they are asking for lives in a panel rather than in chat — building an automation, making ' +
    'a video, generating an image, working through documents. Prefer this over telling someone ' +
    'where a button is. Put anything already discussed into `payload` so the destination opens ' +
    `ready to go rather than empty. Destinations: ${describeModes()}.`,
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: [...APP_MODES],
        description: 'Which part of the app to open.',
      },
      payload: {
        type: 'object',
        description:
          'Context for the destination to open with — the idea for a video, draft instructions ' +
          'for an automation, the topic for a quiz. For Media Studio (mode="media"), supports ' +
          '`workspace` ("storyboard"|"timeline"|"stage"|"router"|"ap"), `projectId` (storyboard slug), ' +
          '`title`, `format` ("short"|"long"), `source` ("ancient-pathways"|"podcast"|"chat"), ' +
          '`episodeId`, `feedUrl`, and `jobId`. Omit only if there is genuinely nothing to carry over.',
      },
      reason: {
        type: 'string',
        description:
          'One short sentence, shown to the user, explaining why their screen changed. Write it ' +
          'for them, not for yourself.',
      },
    },
    required: ['mode'],
  },
};

export const navigateToModeHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const parsed = parseNavRequest(args);
  if (!parsed.ok) {
    return { success: false, error: parsed.error };
  }

  const window = getMainWindow();
  if (!window) {
    return { success: false, error: 'No app window is open to navigate.' };
  }

  window.webContents.send(NAV_CHANNEL, parsed.request);

  // Surfacing the window matters as much as the switch — navigating a window
  // the user cannot see is exactly the dead end this tool exists to remove.
  if (window.isMinimized()) window.restore();
  window.show();

  const { label } = MODE_INFO[parsed.request.mode];
  return {
    success: true,
    result: {
      mode: parsed.request.mode,
      label,
      carriedContext: Boolean(parsed.request.payload),
      message: `Opened ${label}.`,
    },
  };
};

export const navigationToolDefs = [navigateToModeDef];

export const navigationToolHandlers: Record<string, ToolHandler> = {
  navigate_to_mode: navigateToModeHandler,
};
