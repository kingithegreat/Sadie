# HomeBot — start here (every agent, every model)

Applies to Claude Code, Codex, Cline, Copilot, Gemini, Antigravity, Grok Bot, ChatGPT and DeepSeek alike.
The non-negotiable rules are in [Contract](#contract) at the end of this file; they override everything else here.
Paste-in models (ChatGPT, DeepSeek): use [`PROJECT_INSTRUCTIONS.md`](PROJECT_INSTRUCTIONS.md). Drive/repo sync: [`SYNC.md`](SYNC.md).

## Source of truth — in this order
1. **Drive "HomeBot — Current Plan"** (folder `05_HomeBot`,
   https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit)
   — the single live priority queue ("drive is now the new brain"). Read before every task.
2. **This file + `.agents/skills/`** — the rules and how-tos. The repo is the source of truth for skills (see `SYNC.md`).
3. **`CLAIMS.md`** — who is building what right now. Read the tail first.
4. `docs/USER_TESTING_PLAN.md` (item IDs + done-when only), `docs/CURRENT_STATUS.md` (dated snapshot, not a queue).
Notion is reference history only. If Drive is unreachable, say so; never silently switch authority.

## Hard rules (short form — every model must obey)
- **MS-RIG-0 / Ancient Pathways rig:** never edit, render in, or re-slice the shared
  Ancient Pathways rig tree. Only its existing owner does. Never overwrite `_mouth_anchors`
  (252 hand-placed by Aden). Check AP `COORDINATION.md` and `workspace/render.lock` before any AP read-for-action.
- **Money:** no paid API call (Gemini/Imagen, OpenAI, GPU rental, fal, etc.) without Aden's explicit approval for that spend.
- **Art lane:** R1a is the ONLY character-art lane (Aden, 2026-10-20): no Pollinations, no paid Gemini/Imagen.
  R1a =: Colab SDXL + IP-Adapter (ControlNet only on identity drift), locked references, pure magenta `#FF00FF` ground. (`notebooks/colab_sdxl_ipadapter.ipynb`; Kaggle variant is an approved alternate host, Colab stays the lane.)
- **Claim first:** add your row to `CLAIMS.md` and check `gh pr list --state open` *before* touching anything.
- **Branch:** fresh `origin/main`, own worktree, name `claude/<slug>` (CI/auto-merge glob, any tool).
- **Done = proven:** reproduce → fix → prove; label verification level; never claim a push/merge you did not confirm (`git ls-remote`).
- **Ask what reaches it:** trace every capability to something a user can click/type/say.
- **Credentials, accounts, payments, signing, publishing are Aden's.** Flag and stop.
- Fails twice the same way → stop and change approach.
- No text in generated art; titles/captions are composited in code.
- **Mouths:** composited only on front-facing poses (owner decision 2026-09-02). Per-orientation mouth sets are PROPOSED, pending the AP owner (MS-RIG-0) — see `.agents/skills/mouth-viseme-matching`.

## Skills index (`.agents/skills/<slug>/SKILL.md`, mirrored to `.claude/skills/`)
| Skill | Use when |
|---|---|
| homebot-dev-workflow | building, testing or landing anything in Sadie |
| claim-and-branch | starting any change in Sadie |
| pr-handoff-evidence | opening/finishing a PR or handing work over |
| drive-plan-update | after verified progress, to record it in the Drive plan |
| character-art-spec | requesting, generating or reviewing character art |
| mouth-viseme-matching | anything about mouths, lip sync, visemes |
| art-asset-naming-and-folders | saving or referencing any character asset |
| episode-script-to-shots | turning an episode script into shots/tickets |
| qa-video-check | reviewing any rendered video before calling it done |

Skill format: YAML front-matter on line 1 (`name` = folder name, lowercase-hyphen, ≤64 chars; `description` ≤1024 chars; `when_to_use`), then plain-markdown
steps. No tool-specific syntax; a model without shell access follows the same steps and
asks a human/agent with access to run commands. Never put a credential in a skill.
Edit skills only in `.agents/skills/`; `.claude/skills/` is a generated copy — run `node scripts/sync-agent-skills.mjs` (`--check` verifies).

## Working on HomeBot — detail

Any agent, any tool: Claude Code, Cline, GitHub Copilot, Codex, Antigravity. Several of us work
this repo at the same time, often within minutes of each other. Read this before your first edit.

## Planning authority and repository state

| File | What it holds |
|---|---|
| [HomeBot current Drive plan](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit) | **The single live priority queue**, per Aden's later instruction: "drive is now the new brain." |
| [Contract](#contract) (below; `CLAUDE.md` points here) | **The contract.** Non-negotiable operating rules. It overrides the rest of this file. |
| `CLAIMS.md` | **Who is building what right now**, plus rules of the road that changed recently. Read the tail first — newest section is last. |
| `docs/USER_TESTING_PLAN.md` | Historical testing requirements and acceptance evidence (2026-09-17). Retain its item IDs and done-when criteria; the Drive master alone determines current priorities and ownership. |
| [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) | Dated technical snapshot of current source, verified delivery and remaining verification limits. Read it for source/package freshness; it is not another work queue. |
| `docs/FINISHING_HANDOVER.md` | Detailed earlier delivery receipts and ownership history. Its earlier current-source/package checkpoint is superseded by the dated technical snapshot; preserve its evidence and its owner's active edits. |
| `C:\Users\adenk\Documents\Brain\Ai-Brain\01_Projects\HomeBot\Plan.md` | Historical project context and earlier tracks. Outside the repo, readable directly; not a competing live queue. |

Older documents that describe themselves as a shared work queue, including
`USER_TESTING_PLAN.md`'s opening paragraph, are superseded by the Drive master.
Use their item IDs and acceptance criteria only after the current Drive queue
assigns that work. Read `docs/CURRENT_STATUS.md` for the dated technical checkpoint.

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

## Dev workflow detail → skill `homebot-dev-workflow`

The long procedures that used to sit here (the "what reaches this?" defect, three traps,
CI and local test setup, `npm ci` order, which tool can run the suite, standing rules,
working alongside other agents and landing under strict branch protection) moved
**verbatim** to [`.agents/skills/homebot-dev-workflow/SKILL.md`](.agents/skills/homebot-dev-workflow/SKILL.md).
Read it before building or landing anything. Headline: before finishing anything, ask
**what reaches this?** — trace it to something a person can click, type or say.

## When you finish

Update `CLAIMS.md` — release your claim, and add a note if you changed a rule of the road. It is
the only channel every agent provably sees.

## Contract

Moved verbatim from `CLAUDE.md` (2026-10-20). Non-negotiable; overrides the rest of this file.

### Operating Rules (read first)
Aden's later instruction, "drive is now the new brain," supersedes the earlier Notion cadence. Read and update the [current HomeBot Drive plan](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit) as the single live priority queue; re-read before writes and preserve concurrent edits. Existing Notion lessons and locked architecture records remain reference history, not a competing schedule or a required update destination. Save reusable lessons through the shared-skills workflow in AGENTS.md. Always follow these baked-in rules:
1. Verify-fix gate: done only when the symptom is proven gone (reproduce → fix → prove; honesty A/B). Label verification level. Never claim a push/merge that didn't happen — confirm pushes with `git ls-remote`.
2. No stacking on unmerged work — build off main; merge stacks bottom-first.
3. Loop-breaker: if an action fails ~2× the same way, stop and change approach or escalate.
4. No filler: if the only step is padding or needs Aden (manual merge / credential / account), say so.
5. Complex planning uses the top model (Opus/Fable).
6. Name auto-mergeable branches `claude/**` (some repos gate CI/auto-merge on that glob). Persist work durably — never leave it only in a temp dir.
7. Credentials/accounts/payments are Aden's — never enter Stripe keys, create Play/Apple accounts, rotate tokens, or handle signing keys; flag them. A key pasted into chat is in the transcript forever: use it in memory only, never write it to disk, say so, and confirm the rotation happened. An app that encrypts a secret at rest must save it through its own save path — writing the file directly stores plaintext.
8. Verify where the code RUNS, not on this box. A container, CI runner or user machine is a different environment: `docker exec` the same request, read the container's own execution log. A scraper verified from the host returned an empty result in production for weeks of work.
9. Ask what reaches it. The dominant defect here is a capability that exists, is exported, is unit-tested, and that no production path calls. Before building on something, check the chain end to end: does the request route to it, is the tool offered, does the model get a prompt, does the branch that runs actually contain the fix.
10. When a fix changes nothing measurable, stop fixing and instrument. Print the assembled request, extract a frame, ask the DOM what is at that pixel, read the execution record. Layered gates hide each other, so "no improvement" is not evidence the fix was wrong — and never ship a change you cannot demonstrate.
11. A test that leans on a `__e2e_`/test-only hook may be testing the hook. Assert the real effect — requests made, file written, state left — and delete the hook once the test covers the real path.
12. Judge a gate by its **history and its authority**, never by its existence. Two ten-second commands, before trusting OR ignoring any check: `gh api repos/kingithegreat/Sadie/branches/main/protection --jq '.required_status_checks'` and the last ~30 conclusions of that workflow. **Re-read them — do not trust this paragraph; it has already been wrong once.** As of 2026-08-26 the blocking set is `build`, `duplicate-export-guard`, `ESLint (React Hooks)`, `Permissions smoke test`, `widget` and `e2e-all`, with `strict: true`. `strict` means a PR whose every check is green still cannot merge while it is `BEHIND` main, and auto-merge does NOT rescue it — #231 and #213 sat fully green and unmergeable for a day for exactly this reason, and `gh pr update-branch <n>` released both. The e2e matrix used to be advisory and failed **28 of 30 runs, zero passes**, so nobody read it and 13 broken overlays shipped past a suite that ran on every PR. That has since been fixed properly: `e2e-all` in `widget-e2e-ci.yaml` aggregates the nine shards under `if: always()`, so a skipped or cancelled shard cannot wave the gate through, and it is now a required context — the last 27 concluded runs are 25 green, 2 failures. So read the history before dismissing a red e2e as the usual noise; it is now signal. Equally, read it before believing the red: on 2026-08-26 the one failing shard had run **zero tests** — `onnxruntime-node`'s postinstall could not reach `api.nuget.org`, which every shard hits at install time. One un-triaged failing test costs the entire suite: when a gate is red, find whether it is ONE test, an infrastructure flake, or many, before concluding the suite is unhealthy. Put a guard that must block inside a required job.
13. **A filter that matches nothing is indistinguishable from a clean pass.** A CSSOM sweep reported `total: 0` because every `CSSStyleRule` now has an empty-but-truthy `.cssRules` (CSS Nesting); a grep for Playwright's summary missed it because the line is ANSI-prefixed. Before believing a zero, feed the check something it *should* match. The same applies to a `:not()` list, an `--if-present`, a path filter, and any "no results found". **A required check that is ABSENT reads exactly like a passing one.** On 2026-08-26 a rollup of #231 and #232 showed zero failing and zero pending, which looks final — but `e2e-all` was not in the list at all, because its nine shards were still `queued` and no check run existed yet. Enumerate the required contexts from branch protection and assert each one is PRESENT and green; never conclude from "nothing is failing".
14. **Drive UI tests from a fresh profile.** A passing dev machine is the least representative environment there is — `document-summary.e2e` clicked a Send button that could never enable, and passed here for months only because this profile had `firstRun:false` saved. Use `HOMEBOT_E2E_USER_DATA_DIR=$(mktemp -d)` and `helpers/firstRun.ts`. And never write `if (await x.count())` to handle something that appears asynchronously — that is one instantaneous poll, and it is why the same commit passed CI in one run and timed out in another. Wait for the condition, then wait for its effect.
15. **Auto-merge means the PR number is not durable.** `claude/**` merges the moment checks go green, so the first commit can squash-merge and close the PR while you are still pushing; a new PR is then opened for the rest. `gh pr edit` succeeds on a merged PR and changes nothing anyone reads. After each push, re-check `gh pr view <n> --json state` and `gh pr list --head <branch>`. Confirm work landed with `git merge-base --is-ancestor <sha> origin/main` — squash-merge means the original SHA is never an ancestor, so verify the CONTENT arrived, not the commit. Expect `main` to move during any session over an hour, and expect other Claude sessions to be working the same repo.
16. **Overlays escape by leaving the tree, not by z-index.** `chatgpt-theme.css` has a blanket `.app-container > *:not(...)` at (0,12,0) that overrides `position: fixed` on any non-excluded child, and `.app-header`/`.chat-interface` set `container-type` and `backdrop-filter`, either of which traps `fixed` descendants so `overflow:hidden` clips them. Portal to `document.body` via `components/anchoredOverlay.tsx`; only extend the `:not()` list for something that must genuinely stay a child of `.app-container`.
