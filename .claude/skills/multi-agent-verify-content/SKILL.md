---
name: multi-agent-verify-content
description: Verify that another agent's (or your own) work actually landed in a squash-merge repo where PR numbers and commit SHAs are both unreliable. Use after any auto-merge fires, when asked "did X ship?", when checking whether a collision with another session was resolved correctly, and before building on top of recently merged work. Covers content-grep verification, the modes.ts collision case study, and the held-runs approval loop.
---

# Verify merged CONTENT, not SHAs or PR numbers

In `kingithegreat/Sadie`, auto-merge squash-merges: the original commit SHA is never an
ancestor of main, the PR number is not durable (a re-push can spawn a new PR), and several
agents ship to main within the same hour. "The PR says merged" proves nothing about what
landed.

## The verification that counts

```bash
git fetch origin
# Does the SYMBOL exist in main's version of the file?
git grep -c "'code'" origin/main -- widget/src/shared/modes.ts
git grep -c "navContext" origin/main -- widget/src/renderer/components/workspace/WorkspaceShell.tsx
```

A count ≥ 1 for every symbol your change introduced = landed. Zero = it didn't, whatever the
PR page claims. For multi-file changes, check one distinctive symbol per file.

## Collision resolution — the modes.ts case (2026-08-23)

Two sessions independently added entries to `shared/modes.ts`, `shared/navigation.ts` and
`StatusIndicator.tsx` in the same window. Both survived because each change was one line in a
shared list. What made the merge clean:

- Each addition was **additive** (append to a list/record), never a rewrite of shared lines.
- After merge, re-read the file on main and confirm BOTH entries are present before continuing
  work in that area.
- If you and another session fixed the same bug independently (here: the same AppMode import
  fix), expect the second one to be dropped as redundant — don't re-apply it.

## The held-runs loop (every bot PR, every time)

Bot-opened PRs park their required checks at `action_required` silently; the check never
reports and the PR reads as slow CI. After EVERY push:

```bash
gh api "repos/kingithegreat/Sadie/actions/runs?status=action_required&per_page=30" \
  --jq '.workflow_runs[].id'
# then approve each id:
gh api -X POST "repos/kingithegreat/Sadie/actions/runs/<id>/approve"
```

Verify the sweep worked: `{"total_count":0,...}` means nothing is held. A non-zero total_count
with pending checks on YOUR pr = your merge is stalled on this.

## Tooling traps on this box

- `gh --jq` fails oddly with `==` inside double-quoted PowerShell strings (`function not
  defined`). Prefer `gh pr checks <n>` plain text, or write JSON to a temp file and parse with
  node.
- PowerShell treats git/gh stderr as errors (NativeCommandError noise) — exit code 1 often
  means nothing failed; read the actual output.
- `git checkout <branch>` fails if another worktree holds that branch.

## Worktree hygiene

Ten+ worktrees accumulate fast. Before any `reset --hard` / `checkout --` / `stash`:
`git worktree list`, then per-tree `git status --porcelain`. Clean trees on merged branches are
removal candidates; dirty trees hold someone's uncommitted scratch — ask, don't delete.
