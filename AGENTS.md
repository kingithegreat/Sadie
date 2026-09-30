# Working on HomeBot — start here

Any agent, any tool: Claude Code, Cline, GitHub Copilot, Codex, Antigravity. Several of us work
this repo at the same time, often within minutes of each other. Read this before your first edit.

## Planning authority and repository state

| File | What it holds |
|---|---|
| [HomeBot current Drive plan](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit) | **The single live priority queue**, per Aden's later instruction: "drive is now the new brain." |
| `CLAUDE.md` | **The contract.** Non-negotiable operating rules. It overrides this file. |
| `CLAIMS.md` | **Who is building what right now**, plus rules of the road that changed recently. Read the tail first — newest section is last. |
| `docs/USER_TESTING_PLAN.md` | **The shared work queue to user testing** (2026-09-17): gates, Media Studio, providers, Code mode vs Cursor, release. Pick items by ID, one item per PR, put the ID in the PR title. |
| `C:\Users\adenk\Documents\Brain\Ai-Brain\01_Projects\HomeBot\Plan.md` | Historical project context and earlier tracks. Outside the repo, readable directly; not a competing live queue. |

The vault at `C:\Users\adenk\Documents\Brain\Ai-Brain` is Aden's notes, not repo content. **Read it
freely; never copy it into the repo** — it holds project history that does not belong in git.
Useful paths: `01_Projects/HomeBot/` (Plan, Bugs, Decisions, Testing_Log),
`03_Memory/Lessons_Learned.md`, `04_Daily_Logs/`.

## Before you build

**Drive cadence (supersedes the earlier Notion cadence):** read the current
HomeBot Drive plan before each task and check for changed requirements/priorities.
After meaningful verified progress, update that plan with evidence and the next
step; re-read before writing to preserve concurrent edits. Retain Notion pages
as reference history, not an active queue, and do not write them merely to mirror
Drive. If Drive is unavailable, report that limitation rather than silently
switching authority. Use the shared Google Drive skill for this workflow.
Continue already-authorized work; keep existing publication/credential boundaries.

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

## CI tests the app; unit tests do not prove a reachable feature

Verified 2026-09-08: `ci.yml` has a root `build` job AND a Windows `widget` job that
typechecks the app, runs its full Jest suite, builds Electron, and tests overlays in the
real renderer. Separate jobs check lint and permissions. `widget-e2e-ci.yaml` runs the
three-OS E2E matrix; its `e2e-all` aggregate is required by main's branch protection.
Re-read that live protection before relying on it. Every required context must be present
and green. Neither unit tests nor a green PR prove that a media provider produced a real
video or that a user can reach a capability. Trace and exercise that path too.
Run the relevant local checks before publishing:

```bash
cd widget && npx tsc --noEmit && npm run lint && npx jest --config=jest.config.ts --runInBand --no-coverage
cd .. && npx jest && npm run docs:check
```

### Widget tests that do real I/O need an explicit timeout

A widget unit test that runs a **real handler against a loopback HTTP server** (e.g. the
ComfyUI server in `storyboard-frame-provider.test.ts`, which renders frames through a real
socket and reads files) can legitimately take multiple seconds. The Jest default is
**5000 ms**, which such tests brush right up against — that test measured ~4.6s locally and
flaked as a timeout under CI load, taking the whole `widget` job red on several PRs at once
(because they all ran the same suite). The fix was `jest.setTimeout(15_000)` in that file.

Rule: **any test that does real loopback HTTP generation or real subprocess/file work gets an
explicit `jest.setTimeout(...)` above the 5s default** (15s is fine), not the default. A
timeout on such a test is a CI-load symptom, not a product bug, and it will appear as a bare
"exceeded 5000 ms" with no failing assertion. Before believing a `widget` job is red for a
real reason, check whether it is one such timeout.

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

## Working alongside other agents — what collided on 2026-09-15/16

Two Claude sessions built the same Media Studio fixes in parallel (a video-clip validator twice),
and a non-Claude agent re-investigated three Ancient Pathways quality-check failures that were
already fixed and logged. Each was avoidable with a two-second look.

- **Check open PRs, not just `CLAIMS.md`.** Before building, run `gh pr list --state open`. If a PR
  already covers your task, review it or help land it — do not write a second version.
- **Work in your own worktree:** `git worktree add -b claude/<name> .kilo/worktrees/<name> origin/main`.
  `C:\Users\adenk\Desktop\sadie` is nobody's checkout.
- **Never delete `.kilo/worktrees/claude-task2-studio-ipc-tests`.** It holds the only real
  `node_modules`; the main checkout, the preview and every worktree link to it through junctions.
  Before removing any worktree, remove its junctions first
  (`cmd /c rmdir "<worktree>\widget\node_modules"`, and the root one) and check the target still
  exists. A recursive delete that follows a junction wipes the dependencies for every checkout.
- **Landing under strict branch protection:**
  - a green PR that is `BEHIND` never merges on its own — run `gh pr update-branch <n>`;
  - every merge puts the other open PRs behind again, so **one agent drives the merge queue at a
    time** and lands PRs one by one;
  - all six required contexts must be *present* and green: `build`, `duplicate-export-guard`,
    `ESLint (React Hooks)`, `Permissions smoke test`, `widget`, `e2e-all`;
  - a red check is not "flaky" until you have read the failing test and confirmed it does not touch
    your change;
  - to **hold** a PR, make it a draft *and* disable auto-merge — `auto-merge.yml` re-arms auto-merge
    on every push to `claude/**`;
  - after merge, verify the content arrived: `git diff <tested-head> origin/main` should be 0 lines,
    because a squash merge never makes your SHA an ancestor.
- **The widget typecheck is yours to run.** `tsc` caught errors this week that the Jest run did not.
  Preload/IPC changes also need `npm run docs:write` **at the repo root**, not in `widget/`.
- **Shared skills.** Lessons that cost real time live as skills shared by every agent on this PC:
  `~/.claude/skills` (Claude) and `~/.agents/skills` (Codex, Gemini CLI); Antigravity reads
  `~/.gemini/config/skills`. Add one as `<name>/SKILL.md`, then run
  `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\adenk\.agents\sync-shared-skills.ps1`
  to share it. Never put a credential in a skill.
- **The sibling repo `C:\Users\adenk\Desktop\Ancient Pathways` has stricter rules** (its own
  `CLAUDE.md`): commit locally and never push, never `git add -A`, one render at a time
  (`workspace/render.lock`), never edit pipeline code during a render, and hand-placed
  `_mouth_anchors` are locked — never re-measure them or re-slice a Season 1 character without
  Aden. Log what you verified in its `COORDINATION.md`.

## When you finish

Update `CLAIMS.md` — release your claim, and add a note if you changed a rule of the road. It is
the only channel every agent provably sees.
