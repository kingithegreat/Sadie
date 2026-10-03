# Codex autonomous build loop

This document defines the unattended development loop for HomeBot. It complements `AGENTS.md`, `CLAUDE.md`, and `CLAIMS.md`; those files remain authoritative when they conflict with this guide.

## Purpose

Use Notion as the planning source of truth, Codex as the implementation agent, GitHub Actions as the independent quality gate, and n8n as the scheduler/status glue.

The loop is intentionally **one task per Codex invocation**. n8n (or a human) starts the next invocation only after the previous one has produced a clear result. This prevents blind infinite agent loops and gives every task a checkpoint.

## Source-of-truth order

1. `CLAUDE.md` — non-negotiable repo rules.
2. `AGENTS.md` — operating guide for coding agents.
3. `CLAIMS.md` — live ownership/claim coordination.
4. Notion HomeBot plan/task records — priorities, acceptance criteria, business intent.
5. The code and tests — current implementation reality.

Do not copy private Notion/brain content into the repository. Only write concise implementation facts, acceptance criteria, and links that are appropriate for git.

## Task states

The orchestration layer should understand these states:

- `Backlog` — not eligible for autonomous work.
- `Ready` — eligible for selection.
- `In Progress` — currently owned by an agent.
- `Blocked` — cannot continue without a dependency, decision, credential, or human action.
- `Done` — implementation and required verification completed.

A task should contain, when available: project/repo, priority, acceptance criteria, dependencies, and relevant Notion/GitHub references.

## One-task execution contract

For each invocation Codex must:

1. Read `CLAUDE.md`, `AGENTS.md`, and the tail of `CLAIMS.md`.
2. Read the HomeBot plan/task source in Notion through the configured MCP connection.
3. Choose exactly one highest-priority eligible `Ready` task that is not already claimed.
4. Claim it before editing and set the Notion task to `In Progress`.
5. Work from a fresh branch/worktree based on `origin/main`, respecting the repository's current branch naming rules.
6. Implement only the selected task plus directly required fixes.
7. Run the smallest relevant checks first, then the required repository checks from `AGENTS.md` where the environment supports them.
8. Trace the feature to a reachable user path; a green unit test is not sufficient for an unreachable capability.
9. Review the diff for unrelated changes, secrets, privacy regressions, and destructive operations.
10. Commit successful work with a clear message and verify the commit exists remotely if a push is performed.
11. Update Notion with a short result: what changed, verification performed, commit/PR reference, and any remaining caveat.
12. Update/release the claim in `CLAIMS.md`.
13. Stop. Do not silently pick a second task in the same invocation.

## Definition of done

A task is `Done` only when all of the following that apply are true:

- Acceptance criteria are satisfied.
- Relevant typecheck/lint/unit tests pass.
- Required CI checks are green, or the task is explicitly recorded as awaiting CI.
- User reachability has been traced or exercised for user-facing functionality.
- No credentials/secrets were added to git.
- Notion has a concise evidence-backed completion note.
- The claim is released.

If CI is still running, prefer a state such as `In Progress`/`Awaiting CI` rather than falsely marking `Done`.

## Stop conditions

Codex must stop and mark the task `Blocked` when:

- A credential, account login, payment, signing key, or production secret is required.
- The next action would delete production data/resources, rewrite shared Git history, force-push, make a purchase, or change billing.
- Acceptance criteria are materially ambiguous and choosing would change product intent.
- The same operation fails twice for the same reason.
- The task conflicts with an active claim.
- Required validation cannot be performed and the risk is too high to ship unverified.

## Git strategy

- Never develop directly on `main`.
- Start from fresh `origin/main`.
- Use the branch convention required by `AGENTS.md`/CI.
- Keep one major task per branch/PR.
- Do not force-push or rewrite shared history autonomously.
- Prefer a PR + CI gate for changes that affect runtime behavior, permissions, packaging, releases, security, payments, or cloud connectivity.

## CI as independent verifier

Local test success is necessary but not sufficient. GitHub Actions is the independent gate. Codex should inspect the required checks for the current branch protection rather than relying on stale documentation.

For HomeBot, `AGENTS.md` currently documents the root build, Windows widget tests, lint/permissions checks, and the multi-OS E2E aggregate. Re-read the live workflow/protection before relying on those names.

## n8n orchestration contract

n8n is orchestration, not the coding brain. Its job is to trigger one Codex run, collect the result, check GitHub/CI state, update Notion, and decide whether another run is allowed.

Recommended flow:

1. Trigger: manual, schedule, or Notion-ready event.
2. Preflight: ensure no previous HomeBot Codex run is active.
3. Execute `scripts/run-codex-autopilot.ps1` on the Windows host.
4. Capture exit code and log path.
5. If a PR/commit was produced, query GitHub status.
6. Update the matching Notion task with the run result.
7. If result is `Blocked` or `Failed`, stop and surface the blocker.
8. If result is successful and the configured run budget permits, schedule the next one-task invocation.

Do not configure n8n to run multiple Codex writers concurrently against the same task/repo unless they are isolated in independent worktrees and claims.

## Standard Codex prompt

The Windows runner sends this intent to `codex exec`:

```text
Work exactly ONE eligible HomeBot task from my Notion plan autonomously.

Before editing: read CLAUDE.md, AGENTS.md, and the tail of CLAIMS.md. Use the configured Notion MCP connection to inspect the current HomeBot plan/tasks. Select the highest-priority unclaimed task whose status is Ready, claim it, and mark it In Progress.

Implement only that task and directly required fixes. Follow all repository branch/worktree, testing, privacy, security, and evidence rules. Trace user-facing work to a reachable path. Run the relevant checks supported by this environment. Never invent a passing test or completed push.

Do not expose secrets, make purchases, change billing, rotate credentials, force-push, rewrite shared history, delete production resources/data, or perform irreversible production actions. Stop and mark Blocked if one of those is required or if the same action fails twice for the same reason.

When finished, commit the work on the correct task branch, update CLAIMS.md, and update the matching Notion task with a concise evidence-backed result including verification and Git reference. Then STOP. Do not start a second task in this invocation.
```

## Runtime feedback (phase 2)

Once the autonomous build loop is stable, feed real runtime evidence into the backlog:

- **Sentry** for crashes/exceptions and release regression signals.
- **PostHog** (or equivalent lightweight product analytics) for feature reachability/usage events.

Do not auto-create high-priority tasks from every event. Aggregate/dedupe first, then create or promote tasks only when thresholds are met.

## Design workflow (phase 3)

For major Production Studio UI work, connect Figma only when there is an actual design source of truth. Link design nodes/components from the task so Codex can implement against concrete states rather than prose descriptions.

## Model routing

Use the strongest coding model for implementation, difficult debugging, architecture changes, and final review. Cheaper/faster agents may handle search, summarization, documentation triage, log clustering, and task decomposition, but they must not mark implementation complete without the same verification gates.

## Manual preflight checklist

Before leaving an unattended session running:

- Notion MCP works from Codex.
- GitHub authentication works.
- The repo is synced with `origin/main`.
- Existing claims/worktrees are understood.
- CI is operational.
- No production credentials are exposed to prompts/logs.
- The Windows host will remain awake and n8n/Docker are running if used.
- A sensible run budget/stop condition is configured in n8n.
