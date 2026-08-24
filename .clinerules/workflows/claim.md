# /claim — start work without colliding with another agent

Several agents work this repo at once, and more than one has lost uncommitted
work to another's `reset --hard`. Do this before the first edit.

## 1. Look before touching git

```bash
git worktree list
git status
```

Three trees can be live. If `git status` shows changes you did not make, they
belong to someone else — do not `reset --hard`, `checkout --`, or `stash`. Stop
and say what you found.

## 2. Branch off fresh main

```bash
git fetch origin main
git checkout -B claude/<short-slug> origin/main
```

Name it `claude/**` whatever tool you are: CI and `auto-merge.yml` gate on that
glob. Never stack on unmerged work — build off `main` and merge stacks
bottom-first.

## 3. Claim your row

Add a row to the track table in `CLAIMS.md` before writing code:

| Feature | Branch | Status | Notes |
|---|---|---|---|
| what you are building | `claude/<short-slug>` | In progress | files you expect to touch, and what you will NOT touch |

The "will NOT touch" half is the useful part — it is what lets another agent
start safely in the same hour. Update the row to "Ready for integration" when
pushed and self-tested.

## 4. Check nobody built it already

```bash
grep -rl <concept> src widget/src
```

Two source trees exist: root `src/` for pure testable modules, `widget/src/` for
the Electron app. Check both. CI's `duplicate-export-guard` will fail the build
if a new file exports an identifier that already exists elsewhere — usually the
sign of a parallel build that skipped this step.

## 5. After pushing

`claude/**` pushes open a PR and enable auto-merge, so the PR number is not
durable — the first commit can squash-merge and close the PR while you are still
pushing. Re-check state after every push:

```bash
git ls-remote origin <your-branch>
```

Confirm work landed by grepping for the CONTENT on `origin/main`, not by SHA —
squash-merge means your original commit is never an ancestor of main.
