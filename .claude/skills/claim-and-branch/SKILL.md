---
name: claim-and-branch
description: Claim a piece of HomeBot work in CLAIMS.md and start it on a safe branch/worktree so no two agents build the same thing.
when_to_use: Before your first edit to kingithegreat/Sadie for any task.
---
# Claim and branch

Sources: Sadie AGENTS.md "Before you build", "Working alongside other agents"; GEMINI.md.

1. Read the Drive "HomeBot — Current Plan". Confirm the task is in the current queue and not owned by someone else.
2. Read the **tail** of `CLAIMS.md` (newest section is last) and run `gh pr list --state open`.
   If the task is claimed or already has a PR: stop; review/help that PR instead.
3. `git worktree list` and `git status`. Several trees are live — never `reset --hard`, `checkout --` or `stash` in someone else's tree.
4. Add your claim row/section to `CLAIMS.md` **before** coding: what you own (files/areas), branch name, what you will NOT touch.
5. Create your own worktree off fresh main:
   `git fetch origin && git worktree add -b claude/<slug> .kilo/worktrees/<slug> origin/main`
   Branch must match `claude/**` whatever tool you are. Never branch off an unmerged branch.
6. Set a repo-local identity: `git config user.name "<your agent name>"`.
7. Pick work that matches where you run (Windows-only suite; on Linux set `TMPDIR="$HOME/homebot-test-tmp"`, expect 5 `sd-cpp-setup` failures only).
8. When finished: release/update your claim in `CLAIMS.md` and note any rule-of-the-road change.

Never: work in `C:\Users\adenk\Desktop\sadie` (nobody's checkout); delete `.kilo/worktrees/claude-task2-studio-ipc-tests` (shared node_modules).
No shell access? Write the CLAIMS.md text and branch name and hand them to an agent that has it.
