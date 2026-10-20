---
name: pr-handoff-evidence
description: Open, land and hand off a Sadie PR with acceptance evidence that another agent or Aden can check.
when_to_use: When your change is ready for a PR, when handing work to another agent, or when claiming something is done.
---
# PR handoff and acceptance evidence

Sources: Sadie CLAUDE.md rules 1, 12, 13, 15; AGENTS.md "Landing under strict branch protection"; Drive plan entries.

## Before opening
- Run local checks: `cd widget && npx tsc --noEmit && npm run lint && npx jest --config=jest.config.ts --runInBand --no-coverage` then `cd .. && npx jest && npm run docs:check`. Preload/IPC changes: `npm run docs:write` at repo root.
- Answer "what reaches this?" — name the button/command/utterance that exercises the change.

## PR body / handoff block (copy this)
```
Task: <Drive plan item / USER_TESTING_PLAN ID>   Claim: CLAIMS.md <section>
Change: <one paragraph>
Reachability: <user path that hits it>
Verification level: <unit | integration | native UI | owner-accepted>
Evidence: <commands run + results; artifact paths; SHA-256 of outputs; frames inspected>
Not verified / limits: <honest list>
Not touched: <owner areas left alone, e.g. AP rig, paid APIs>
Next step: <who, what>
```

## Landing
1. Bot PR checks stuck at `action_required`? approve runs (AGENTS.md loop). Only Aden can toggle the repo setting.
2. Enumerate required contexts from `gh api repos/kingithegreat/Sadie/branches/main/protection --jq '.required_status_checks'`; each must be **present** and green (absent ≠ pass). As of 2026-08-26: build, duplicate-export-guard, ESLint (React Hooks), Permissions smoke test, widget, e2e-all — re-read, don't trust this list.
3. Green but `BEHIND` → `gh pr update-branch <n>`. One agent drives the merge queue at a time.
4. To hold: draft **and** disable auto-merge (auto-merge.yml re-arms on every claude/** push).
5. After merge: `gh pr view <n> --json state`, then `git diff <tested-head> origin/main` = 0 lines (squash merge: verify content, not SHA ancestry).
6. Update Drive (skill drive-plan-update) and CLAIMS.md.

Never say "merged"/"pushed" without confirming (`git ls-remote`).
