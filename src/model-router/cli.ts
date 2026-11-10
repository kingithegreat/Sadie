#!/usr/bin/env node
/**
 * HomeBot model-router CLI. Dry run unless --live (or MODEL_ROUTER_LIVE=1)
 * AND OPENROUTER_API_KEY is set.
 *
 *   npm run router -- pick  --task "fix typo in README" --files 1 --diff 2
 *   npm run router -- run   --task "add a field to the User interface" --files 1 --diff 10
 *   npm run router -- code  --repo . --task "add a CONTRIBUTING note"   (preview only)
 *   npm run router -- code  --repo . --task "..." --approve             (commit to homebot/vibe-*)
 *   npm run router -- spend
 *   npm run router -- serve --port 8787
 *   npm run router -- config
 */

import * as fs from 'node:fs';
import type * as http from 'node:http';
import { createRouter } from './chat-route';
import { RouterRequestError, formatRouteBadge, formatUsd, type FetchLike } from './client';
import { RouterConfigError, type Env } from './config';
import { SpendCapExceededError } from './ledger';
import { pickTier, tierSignals, TIER_ORDER, type Tier } from './pick-tier';
import { startRouterServer } from './server';
import { applyVibeProposal, formatVibePreview, proposeVibeChange } from './vibe-code';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env?: Env;
  fetch?: FetchLike;
  homeDir?: string;
  now?: () => Date;
  /** Receives the server handle for `serve` (tests close it). */
  onServer?: (server: http.Server, url: string) => void;
}

const USAGE = `Usage: router <command> [options]

Commands:
  pick   --task T [--files N] [--diff N] [--failed]   Show the tier and models for a task
  run    --task T | --task-file F [--files N] [--diff N] [--failed] [--tier cheap|mid|top] [--session ID] [--json]
  code   --repo DIR --task T [--approve]               Propose a diff; --approve commits it to a new homebot/vibe-* branch
  spend  [--json]                                      This month's spend against the cap
  serve  [--port 8787]                                 OpenAI-compatible endpoint on 127.0.0.1
  config                                               Print the resolved config (never prints keys)

Global: --config PATH, --live (still needs OPENROUTER_API_KEY in env). Default is DRY RUN.`;

interface Parsed {
  command: string;
  flags: Record<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(['failed', 'json', 'live', 'approve', 'help']);

export function parseArgs(argv: string[]): Parsed {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (eq !== -1) flags[name] = arg.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
    else {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
      flags[name] = value;
      i++;
    }
  }
  return { command, flags };
}

function num(flags: Parsed['flags'], name: string): number | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
  return n;
}

function str(flags: Parsed['flags'], name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  let parsed: Parsed;
  try { parsed = parseArgs(argv); } catch (e) { io.stderr(`${(e as Error).message}\n\n${USAGE}\n`); return 2; }
  const { command, flags } = parsed;
  if (command === 'help' || flags.help) { io.stdout(`${USAGE}\n`); return 0; }

  const env: Env = { ...(io.env ?? process.env) };
  if (flags.live) env.MODEL_ROUTER_LIVE = '1';

  try {
    const router = createRouter({ path: str(flags, 'config'), env, homeDir: io.homeDir, fetch: io.fetch, now: io.now });
    const mode = router.mode();
    if (flags.live && !mode.live) io.stderr(`warning: ${mode.reason}\n`);

    switch (command) {
      case 'pick': {
        const task = str(flags, 'task') ?? '';
        const files = num(flags, 'files') ?? -1;
        const diff = num(flags, 'diff') ?? -1;
        const tier = pickTier(task, files, diff, flags.failed === true);
        const t = router.config.tiers[tier];
        const signals = tierSignals(task, files, diff);
        io.stdout(`${JSON.stringify({ tier, models: [t.model, ...t.fallbacks], reasons: signals.reasons }, null, 2)}\n`);
        return 0;
      }
      case 'run': {
        const file = str(flags, 'task-file');
        const task = file ? fs.readFileSync(file, 'utf8') : str(flags, 'task');
        if (!task || !task.trim()) { io.stderr('run needs --task or --task-file\n'); return 2; }
        const tierFlag = str(flags, 'tier');
        if (tierFlag && !(TIER_ORDER as readonly string[]).includes(tierFlag)) { io.stderr('--tier must be cheap, mid or top\n'); return 2; }
        const result = await router.complete({
          task,
          files: num(flags, 'files'),
          diffLines: num(flags, 'diff'),
          failed: flags.failed === true,
          tier: tierFlag as Tier | undefined,
          sessionId: str(flags, 'session'),
          source: 'coder',
        });
        if (flags.json) {
          const { raw: _raw, ...rest } = result;
          io.stdout(`${JSON.stringify(rest, null, 2)}\n`);
        } else {
          io.stdout(`${result.dryRun ? `[${result.mode}]\n` : ''}${result.content}\n\n${formatRouteBadge(result)}\n`);
        }
        return 0;
      }
      case 'code': {
        const repo = str(flags, 'repo') ?? process.cwd();
        const task = str(flags, 'task') ?? '';
        const proposal = await proposeVibeChange({ router, repoRoot: repo, task });
        io.stdout(`${formatVibePreview(proposal)}\n`);
        if (!flags.approve) { io.stdout('\nPreview only. Re-run with --approve to commit it to a new homebot/vibe-* branch.\n'); return 0; }
        const result = await applyVibeProposal(proposal, (io.now ?? (() => new Date()))());
        io.stdout(`\nCommitted ${result.commit.slice(0, 8)} to ${result.branch} (working tree and ${result.baseBranch} untouched, nothing pushed).\n`);
        return 0;
      }
      case 'spend': {
        const s = router.ledger.summary();
        if (flags.json) io.stdout(`${JSON.stringify(s, null, 2)}\n`);
        else io.stdout(`${s.month}: ${formatUsd(s.spentUsd)} of $${s.capUsd.toFixed(2)} cap (${formatUsd(s.remainingUsd)} left, ${s.calls} calls). Ledger: ${s.ledgerPath}\n`);
        return 0;
      }
      case 'serve': {
        const port = num(flags, 'port') ?? 8787;
        const { server, url } = await startRouterServer(router, port);
        io.stdout(`HomeBot model router listening on ${url}/v1/chat/completions (${mode.reason})\n`);
        io.onServer?.(server, url);
        return 0;
      }
      case 'config': {
        const { tiers, monthlyCapUsd, live, ledgerPath, chat, source, cacheControlPrefixes, cacheTtl, baseUrl } = router.config;
        io.stdout(`${JSON.stringify({ source, mode: mode.reason, baseUrl, monthlyCapUsd, live, ledgerPath, chat, cacheControlPrefixes, cacheTtl, tiers }, null, 2)}\n`);
        return 0;
      }
      default:
        io.stderr(`Unknown command: ${command}\n\n${USAGE}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof SpendCapExceededError || e instanceof RouterConfigError || e instanceof RouterRequestError) {
      io.stderr(`${e.message}\n`);
      return 1;
    }
    io.stderr(`${(e as Error)?.message || String(e)}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2), {
    stdout: t => process.stdout.write(t),
    stderr: t => process.stderr.write(t),
  }).then(code => { if (code !== 0) process.exitCode = code; });
}
