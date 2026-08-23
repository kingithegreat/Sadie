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

- **A filter that matches nothing looks exactly like a clean pass.** Before believing any zero —
  a grep, a `:not()` list, a "no results found" — feed it something it *should* match. A recent
  button-grep returned two hits from a 710-line panel that actually offered six actions.

## CI does not test the app

`ci.yml` runs at the **root**. The Electron app lives in `widget/`, and of its ~181 test files CI
runs **one**. A green PR means: root typecheck, ~205 root tests, widget eslint, one smoke file. It
does **not** mean the app compiles or its tests pass. Run these yourself:

```bash
cd widget && npx tsc --noEmit && npm run lint && npx jest --config=jest.config.ts --runInBand --no-coverage
cd .. && npx jest && npm run docs:check
```

## Standing rules from `CLAUDE.md` worth repeating

- **Prove the symptom is gone.** Reproduce, fix, then demonstrate. Never claim a fix you cannot
  show. Never claim a push that did not happen — confirm with `git ls-remote`.
- **Verify where the code RUNS**, not on your box. A container, a CI runner and a user's machine
  are different environments.
- **Never bypass the privacy kill-switch** (`useCustomLLM` / `allowCloud`). It fails closed.
- **Credentials, accounts, payments and signing keys are Aden's.** Never enter an API key, create
  an account, or rotate a token. Flag it and stop.
- **If an action fails twice the same way, stop.** Change approach or escalate — do not retry.
- Non-technical users are the audience. The first-run screen says "On this PC" and "Online", not
  "Ollama" and "Cloud API".

## When you finish

Update `CLAIMS.md` — release your claim, and add a note if you changed a rule of the road. It is
the only channel every agent provably sees.
