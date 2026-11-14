/**
 * HomeBot chat <-> OpenRouter model router (src/model-router), main process only.
 *
 * - Chat routing is OFF unless Settings -> Advanced -> "Route chat through the
 *   OpenRouter model router" (settings.modelRouterEnabled) or
 *   HOMEBOT_MODEL_ROUTER=1. When off, the existing provider path is untouched.
 * - /code <task> (and, with the router on, a conservatively detected coding
 *   request in a set project) runs vibe-code: diff preview, Approve / Reject,
 *   and on approve a commit to a new homebot/vibe-* branch only.
 * - Provider calls and the spend ledger run here, in the main process. The
 *   ledger and cap are the same ones the CLI and local endpoint use
 *   (~/.homebot/model-router/), so chat and the coder share one monthly cap.
 * - Dry run unless live mode is on AND OPENROUTER_API_KEY is set.
 */

import defaultRouterConfig from '../../../config/model-router.json';
import { createRouter, routeChatTurn, type ChatTurnResult } from '../../../src/model-router/chat-route';
import type { ModelRouter } from '../../../src/model-router/client';
import { detectCodingIntent, parseCodeCommand, runVibeCodeTurn, type VibeTurnIO, type VibeTurnOutcome } from '../../../src/model-router/vibe-code';

export function isModelRouterChatEnabled(settings: { modelRouterEnabled?: boolean } | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (/^(1|true|yes|on)$/i.test((env.HOMEBOT_MODEL_ROUTER || '').trim())) return true;
  return settings?.modelRouterEnabled === true;
}

/** Built per call so an edited config, cap or key is picked up without a restart. */
export function getAppModelRouter(): ModelRouter {
  return createRouter({ fallback: defaultRouterConfig });
}

export async function routeChatThroughModelRouter(turn: {
  message: string;
  conversationId: string;
  systemPrompt?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
}, router: ModelRouter = getAppModelRouter()): Promise<ChatTurnResult> {
  return routeChatTurn(router, turn);
}

/**
 * Which vibe-code task this chat message asks for, or null.
 * /code always counts; plain-language intent only when the router is on and
 * the user has set a project explicitly.
 */
export function vibeCodeTaskFor(message: string, opts: { routerEnabled: boolean; explicitProject: boolean }): string | null {
  const command = parseCodeCommand(message);
  if (command !== null) return command;
  if (opts.routerEnabled && opts.explicitProject && detectCodingIntent(message)) return message.trim();
  return null;
}

export async function runVibeCodeChatTurn(options: {
  task: string;
  repoRoot: string | undefined;
  io: VibeTurnIO;
  router?: ModelRouter;
}): Promise<VibeTurnOutcome> {
  let router: ModelRouter;
  try {
    router = options.router ?? getAppModelRouter();
  } catch (e) {
    const error = (e as Error)?.message || String(e);
    options.io.send(`⚠️ Model router config error: ${error}`);
    return { status: 'error', error };
  }
  return runVibeCodeTurn({ task: options.task, repoRoot: options.repoRoot, router, io: options.io });
}
