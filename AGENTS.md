# Working on HomeBot — start here

Any agent, any tool: Claude Code, Cline, GitHub Copilot, Codex, Antigravity. Several of us work
this repo at the same time, often within minutes of each other. Read this before your first edit.

## The three files that hold the state

| File | What it holds |
|---|---|
| `CLAUDE.md` | **The contract.** Non-negotiable operating rules. It overrides this file. |
| `CLAIMS.md` | **Who is building what right now**, plus rules of the road that changed recently. Read the tail first — newest section is last. |
| `C:\Users\adenk\Documents\Brain\Ai-Brain\01_Projects\HomeBot\Plan.md` | **The plan** — tracks A–I, owners, and what Aden has actually asked for, in his words. Outside the repo, on this machine, readable directly. |

The vault at `C:\Users\adenk\Documents\Brain\Ai-Brain` is Aden's notes, not repo content. **Read it
freely; never copy it into the repo** — it holds project history that does not belong in git.
Useful paths: `01_Projects/HomeBot/` (Plan, Bugs, Decisions, Testing_Log),
`03_Memory/Lessons_Learned.md`, `04_Daily_Logs/`.

## Before you build

1. `git worktree list` and `git status` — **three trees are live at once.** `reset --hard`,
   `checkout --` and `stash` will destroy another agent's uncommitted work.
2. Read the tail of `CLAIMS.md`. If your feature is claimed, pick something else.
3. **Claim your row in the track table in `CLAIMS.md` before you start**, not after.
4. Branch off fresh `origin/main`. Never off an unmerged branch.
5. Name it `claude/**` — CI and auto-merge gate on that glob regardless of which tool you are.

## The defect this codebase actually produces

Not crashes. **Capability that exists, works, is exported, is tested — and that nothing a user can
reach ever calls.** Every bug found in one recent full-day session was this shape: a safety
whitelist whose every caller threw before reaching it, a privacy switch that rendered only after a
failed fetch, a QA stage that inspected nothing, web tools the model was never handed, a model
downloader with no delete button, and an entire coding pillar with no button in the mode bar.

Type checkers, linters and unit tests are all green for every one of these, because the code
genuinely works.

**So before you finish anything, ask: what reaches this?** Trace outward until you arrive at
something a person can click, type or say. If you cannot, you have built another one.

## Three traps that cost real hours here

- **A control added to `AdvancedSettingsTab` is invisible by default.** Settings opens in Simple.
  This shipped a live bug — Aden could not find the Claude subscription option after a refactor.
  Decide deliberately which view a new setting belongs in.
- **Bot-opened PRs park every check at `action_required` and nothing tells you.** Required checks
  simply never report and it reads as slow CI. Ten runs were held in one day, five for three days:

  ```bash
  gh api "repos/kingithegreat/Sadie/actions/runs?status=action_required&per_page=30" \
    --jq '.workflow_runs[].id' |
    while read id; do gh api -X POST "repos/kingithegreat/Sadie/actions/runs/$id/approve"; done
  ```

  That loop is the workaround, not the fix. Copilot's PRs are held because it is treated as an
  outside contributor; GitHub added a repo setting to skip that approval, which only Aden can
  toggle. Until it is on, run the loop after every bot push.

- **A filter that matches nothing looks exactly like a clean pass.** Before believing any zero —
  a grep, a `:not()` list, a "no results found" — feed it something it *should* match. A recent
  button-grep returned two hits from a 710-line panel that actually offered six actions.

## CI does not test the app

`ci.yml` runs at the **root**. The Electron app lives in `widget/`, and of its **248** test suites
(~3,487 tests across 151 main, 79 renderer, 17 shared, 1 root) CI runs **one** smoke file. A green
PR means: root typecheck, ~205 root tests, widget eslint, one smoke file. It does **not** mean
the app compiles or its tests pass. Run these yourself:

```bash
cd widget && npx tsc --noEmit && npm run lint && npx jest --config=jest.config.ts --runInBand --no-coverage
cd .. && npx jest && npm run docs:check
```

### `npm ci` needs both packages, then native rebuilds

`widget/src/main/tools/crm.ts` imports `../../../../src/crm/store` — a **root-package** file — and
`src/crm/store.ts:54` does `require('better-sqlite3')`, which Node resolves from the **root's**
`node_modules/`. Installing only `widget/` leaves 10 CRM and email tests failing on a module that
is present in widget's tree but not where the importer looks for it. `ci.yml:80-103` does this
in order; mirror it locally:

```bash
# from the repo root
npm ci --ignore-scripts                # root package (CRM store lives here)
cd widget && npm ci --ignore-scripts   # widget
npm rebuild better-sqlite3             # widget binding for Node ABI
cd .. && npm rebuild better-sqlite3    # root binding
```

`--ignore-scripts` skips electron-builder's `install-app-deps` (slow, builds against Electron's
ABI which Jest does not use). The explicit `npm rebuild better-sqlite3` after the install is
what produces the Node-ABI binary the CRM store actually loads. Without these four steps the
local `jest` run will report `crm-tools.test.ts` and `email-tool.test.ts` as failing on
`Cannot find module 'better-sqlite3' from '../src/crm/store.ts'` — and that is the same single
root cause for all 10 failures, not 10 separate bugs.

### Not every tool can run that

HomeBot ships Windows-only, and `ci.yml` runs the widget job on `windows-latest` because that is
the only platform the suite passes on. 43 test files write fixtures to `os.tmpdir()` while the
main-process file tools refuse any path outside `os.homedir()` — the same directory on Windows,
`/tmp` versus home on Linux. Measured on Linux 2026-08-24, same tree, only `TMPDIR` differing:
**79 failures across 4 suites without it, 5 in 1 suite with it.** Those last 5 are all
`sd-cpp-setup.test.ts`, which refuses on non-Windows by design (`sd-cpp-setup.ts:177`) — on Linux
that is the clean result, not a regression.

| Tool | Runs on | Can run the widget suite |
|---|---|---|
| Cline, Claude Code (local) | Aden's Windows box | Yes — no excuse for an unverified claim |
| Copilot coding agent | Linux Actions runner | Yes with `TMPDIR="$HOME/homebot-test-tmp"` — expect 5 failures in `sd-cpp-setup.test.ts`, nothing else |
| Claude Code on the web | Linux container | Same as Copilot; often no `node_modules` at all |

`.github/workflows/copilot-setup-steps.yml` installs both packages and exports `TMPDIR` for the
Copilot agent. Set it on the command line regardless — a silent fallback to `/tmp` is
indistinguishable from 92 real bugs.

**So pick work that matches where you run.** Linux-bound agents are better spent on the root
package, pure modules in `src/`, docs, CI and n8n workflows than on `widget/` UI they cannot
exercise. And if you could not run the suite, write "unit tests not run in this environment"
rather than implying green. An honest unverified is useful; a false green costs a reviewer more
than the change was worth.

## Standing rules from `CLAUDE.md` worth repeating

- **Prove the symptom is gone.** Reproduce, fix, then demonstrate. Never claim a fix you cannot
  show. Never claim a push that did not happen — confirm with `git ls-remote`.
- **Verify where the code RUNS**, not on your box. A container, a CI runner and a user's machine
  are different environments.
- **Never bypass the privacy kill-switch** (`useCustomLLM` / `allowCloud`). It fails closed.
- **Credentials, accounts, payments and signing keys are Aden's.** Never enter an API key, create
  an account, or rotate a token. Flag it and stop.
- **If an action fails twice the same way, stop.** Change approach or escalate — do not retry.
- **Sign your commits as yourself.** Set a repo-local `git config user.name` before your first
  commit. 686 commits share one identity, so `git log --author` and `git blame` cannot answer "who
  wrote this?" after a regression — and a track owner's record cannot be checked at all.
- Non-technical users are the audience. The first-run screen says "On this PC" and "Online", not
  "Ollama" and "Cloud API".

## When you finish

Update `CLAIMS.md` — release your claim, and add a note if you changed a rule of the road. It is
the only channel every agent provably sees.
