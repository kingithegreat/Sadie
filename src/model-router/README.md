# HomeBot OpenRouter model router

One place to send HomeBot's coding agents and (optionally) HomeBot chat through
OpenRouter, with cheap / mid / top tiers, model fallbacks, prompt caching, a
local spend ledger and a hard monthly cap.

**Dry run is the default.** No request leaves the machine unless live mode is
switched on **and** `OPENROUTER_API_KEY` is set. In dry run every caller gets a
clearly labelled mock reply and a mock cost estimate.

Rules and model choices come from the research note
`coding-agent-options-2026-11-10.md` ("Concrete OpenRouter setup" and
"Minimal router sketch").

## Files

| File | What it does |
| --- | --- |
| `config/model-router.json` | Tier models, fallbacks, `max_tokens`, `provider.max_price`, list prices, monthly cap, chat tier policy |
| `pick-tier.ts` | `pickTier(task, files, diffLines, failed)` and `pickChatTier` |
| `config.ts` | Loads and validates the config; decides dry run vs live |
| `client.ts` | `ModelRouter`: OpenRouter chat completions, escalation, cost |
| `ledger.ts` | Shared spend ledger and the monthly cap |
| `chat-route.ts` | `createRouter()` (used by every caller) and `routeChatTurn` for HomeBot chat |
| `vibe-code.ts`, `git.ts` | `/code` vibe-coding: diff proposal, preview, approve to a `homebot/vibe-*` branch |
| `server.ts` | Optional OpenAI-compatible endpoint on `127.0.0.1` |
| `cli.ts` | The `npm run router` entry point |

The Electron side is `widget/src/main/model-router-chat.ts` (main process only).

## Tiers (defaults)

| Tier | Primary | Fallback | max_tokens | provider.max_price (USD / 1M, prompt / completion) |
| --- | --- | --- | --- | --- |
| cheap | `qwen/qwen3.7-flash` | `deepseek/deepseek-v4.1-flash` | 4096 | 0.1 / 0.7 |
| mid | `anthropic/claude-sonnet-5.5` | `openai/gpt-6.1-terra` | 8192 | 2 / 10 |
| top | `anthropic/claude-opus-5.5` | `openai/gpt-6.1-sol` | 16384 | 4 / 20 |

Edit `config/model-router.json`, or copy it to
`~/.homebot/model-router/config.json` so the CLI and the app share your
version. Nothing about models is hardcoded.

## How a tier is picked

- **top** if the task mentions architecture, redesign, migration, auth,
  security, SSR, hydration, Firebase rules, race, flaky, deadlock, data loss,
  root cause, performance cliff, production incident/outage, payment, PII, or a
  cross-cutting change (shared module, interceptor, guard, Cloud Run), or
  touches 8+ files, or expects a 400+ line diff.
- **cheap** only if it has a mechanical keyword (typo, rename, comment, format,
  lint, tests only, changelog, add import, boilerplate, CSS tweak, copy change)
  **and** 2 or fewer files **and** an 80-line or smaller diff, and no hard or
  "regression" words. Unknown sizes never count as cheap.
- **mid** for everything else, including unclear tasks.
- `failed = true` moves the pick up one tier.

## What each request looks like

- `models: [primary, ...fallbacks]` (OpenRouter's fallback list)
- `session_id`: stable for the task (or chat conversation), so sticky routing keeps the cache warm
- `cache_control: { type: "ephemeral" }` when the primary is `anthropic/` or `qwen/` (set `cacheTtl: "1h"` for long sessions)
- `max_tokens` and `provider: { max_price, require_parameters }` from the tier
- `usage: { include: true }` so the response carries `usage.cost`

If an attempt fails (5xx, 429, network error, empty completion), the router
retries the same prompt **one tier up**, at most once per tier, and never goes
past top. 401 / 402 / 403 (bad key, no credits, OpenRouter key limit) stop
straight away, because another tier would fail the same way.

## Spend ledger and monthly cap

Every live response's `usage.cost` is added to
`~/.homebot/model-router/ledger.json`. If a response has no cost, the router
estimates one from the config `pricing` and marks it `estimated`. Once this
month's total (by UTC month) reaches `monthlyCapUsd` (default **$35**), every
call is refused with a `SpendCapExceededError` before anything is sent. Dry runs
are refused too, so you see a capped month before going live. A corrupt ledger
is an error, never a silent reset.

**Chat, the CLI coder, the local endpoint and vibe-code all use the same ledger
and the same cap.** They all build their router with `createRouter()`, which
reads one config (`MODEL_ROUTER_CONFIG`, then `~/.homebot/model-router/config.json`,
then the repo default) and one ledger path.

Also set a matching key limit on OpenRouter (Key limit, monthly) as a second
line of defence.

## CLI

```bash
npm run router -- pick  --task "fix typo in README" --files 1 --diff 2
npm run router -- run   --task "add a field to the User interface" --files 1 --diff 10
npm run router -- run   --task-file task.md --json
npm run router -- code  --repo . --task "add a CONTRIBUTING note"            # preview only
npm run router -- code  --repo . --task "add a CONTRIBUTING note" --approve  # commit to homebot/vibe-*
npm run router -- spend
npm run router -- config
npm run router -- serve --port 8787
```

Add `--live` to any command to request a real call (still needs the key).
Exit codes: 0 ok, 1 refused or failed (cap, config, upstream), 2 bad usage.

## Local endpoint (OpenAI-compatible)

`npm run router -- serve` listens on `http://127.0.0.1:8787` only.

- `POST /v1/chat/completions`: `model: "auto"` picks a tier from the last user
  message. `"router/cheap"`, `"router/mid"` or `"router/top"` force one.
  Optional `router: { files, diffLines, failed }` feeds `pickTier`. `session_id`
  (or an `x-session-id` header) is passed through. `stream: true` is not supported.
- `GET /v1/models`, `GET /health` (mode and this month's spend).
- A capped month returns **402** with `code: "SPEND_CAP_EXCEEDED"`.

Point any OpenAI-style agent's base URL at `http://127.0.0.1:8787/v1`.

## HomeBot chat through the router

Off by default. Turn it on in **Settings → Advanced → "Route chat through the
OpenRouter model router"** (or set `HOMEBOT_MODEL_ROUTER=1`). When it's off,
chat uses the existing provider settings exactly as before.

When it's on, plain chat turns use the **cheap** tier (`chat.defaultTier`). Hard
topics follow the same keyword rules but are capped at **mid**
(`chat.maxTier`). A failed attempt escalates one tier at a time, the same as
coder calls. Every reply ends with a line showing the model, tier and cost,
plus this month's spend against the cap. In dry run the cost says
`mock estimate, dry run, nothing was sent or billed`.

Image, document and inline-draft turns keep the existing provider path. Tools
are not offered on the router path yet.

## Vibe code from chat

Type `/code <what to change>` in HomeBot chat. With the router on and a project
set (`/project <path>` or an open Workspace), a plain request that names a
source file ("fix the typo in src/app.ts") also triggers it. The detection is
deliberately strict.

1. The router picks a tier and the model proposes a unified diff.
2. Chat shows the diff, the model, the tier and the cost. The diff is checked
   against `HEAD` before you are asked.
3. An **Approve / Reject** dialog appears. Reject (or no answer within 10
   minutes) writes nothing.
4. Approve commits the diff to a **new** branch `homebot/vibe-<UTC timestamp>`
   based on your current `HEAD`. The patch goes through a temporary git index
   (`read-tree`, `apply --cached`, `commit-tree`, `update-ref`), so your
   working tree, staged changes, current branch and `main` are never touched,
   and nothing is pushed. Run `git switch homebot/vibe-…` to try it.

## Going live (Aden)

1. Put the key in your environment, never in a file in the repo:
   - PowerShell, current session: `$env:OPENROUTER_API_KEY = "sk-or-..."`
   - Persist for your user: `setx OPENROUTER_API_KEY "sk-or-..."` (open a new terminal afterwards; restart HomeBot)
2. Turn live mode on: `MODEL_ROUTER_LIVE=1` (or `"live": true` in your config, or `--live` on the CLI).
3. Check that the six default model IDs exist on https://openrouter.ai/models and adjust the config if any were renamed.
4. Pick your cap: set `monthlyCapUsd` (default 35) and the same limit on the OpenRouter key.
5. Check: `npm run router -- config` shows `"mode": "live"`, then try one small call with `npm run router -- run --task "fix typo in README" --files 1 --diff 1 --live`.

## Try vibe-code in dry run (free)

1. Start HomeBot from this branch and set a project: `/project C:\path\to\some\git\repo`.
2. Send `/code add a note about the router`.
3. Chat shows a mock diff that adds `homebot-vibe-dry-run.md`, labelled
   `mock estimate, dry run, nothing was sent or billed`.
4. Click **Reject**. `git status` and `git branch` in that repo are unchanged.
5. Send it again and click **Approve**. `git branch` now lists
   `homebot/vibe-<timestamp>`, your current branch and working tree are
   unchanged, and `git show homebot/vibe-<timestamp>` shows the mock file.
6. Delete the test branch afterwards if you like: `git branch -D homebot/vibe-<timestamp>`.

Without the app: `npm run router -- code --repo <repo> --task "add a note"`, then add `--approve`.

## Tests

`npx jest src/model-router` (root) and
`npx jest src/main/__tests__/model-router-chat.test.ts` (widget). Every test uses
a mocked fetch. A guard makes any real `fetch` throw.
