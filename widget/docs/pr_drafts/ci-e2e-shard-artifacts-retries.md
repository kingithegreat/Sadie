# PR: ci(e2e): shard Playwright tests + per-shard artifacts + retries

Summary
-------

This PR consolidates and documents the CI changes that make the Playwright E2E job more robust and faster in CI by:

- Sharding the Playwright tests into multiple shards so each CI job runs a subset of tests in parallel.
- Capturing per-shard artifacts (junit, Playwright trace, video, HTML report) into per-shard directories.
- Adding per-shard retries (Playwright retries = 1) and a job-level retry wrapper so flaky shards get retried without re-running the whole matrix.
- Adding cross-OS matrix coverage (ubuntu, macos, windows) with per-shard artifact uploads and cross-platform cache paths.

Why
---

The E2E tests exercise a full streaming pipeline that previously flaked and was slow in CI. Sharding reduces wall-clock time for E2E runs by parallelizing tests. Capturing per-shard artifacts and reliable uploads makes debugging failed shards much easier for maintainers.

Files changed
-------------

- `.github/workflows/widget-e2e.yml`  full sharding + retry wrapper + per-shard artifact directories + cache key improvements.
- `playwright.config.ts`  set retry to 1 (explicit per-shard retry) and reporters / traces defaults.

What I did not include
---------------------

- Local uncommitted working-tree edits were intentionally NOT included in this PR branch (the branch was created from origin/main). Keep experimental or partial local edits in a follow-up PR so reviews stay focused.

Testing done
------------

- Local Linux runs (Playwright E2E) passed after fixes (3 tests passing, traces/videos were generated locally).
- sse-proxy unit & integration tests pass locally.

How to push and open the PR (commands)
-------------------------------------

On your machine (PowerShell):

```powershell
# switch to branch (if not already)
git fetch origin; git checkout -b ci/e2e/shard-artifacts-retries origin/main

# add the draft file and commit (already done by the helper if using CI)
git add docs/pr_drafts/ci-e2e-shard-artifacts-retries.md
git commit -m "chore(ci): add PR draft for e2e sharding + per-shard artifacts + retries"

# push branch to remote
git push origin HEAD:refs/heads/ci/e2e/shard-artifacts-retries

# create PR using GitHub CLI (if you have gh installed)
gh pr create --base main --head ci/e2e/shard-artifacts-retries --title "ci(e2e): shard Playwright tests + per-shard artifacts + retries" --body-file docs/pr_drafts/ci-e2e-shard-artifacts-retries.md

# Alternatively open the PR from GitHub UI: https://github.com/kingithegreat/Sadie/compare/main...ci/e2e/shard-artifacts-retries
```

Reviewer notes / checklist
-------------------------

- Confirm the matrix OS changes and artifact upload paths are cross-platform safe.
- Verify the Playwright shard naming and artifact naming scheme in CI for race-free uploads.
- If you spot additional local test flakiness, let's add targeted retries for only the unstable tests to avoid masking real failures.

Notes
-----

This PR focuses only on CI improvements and deterministic artifact capture to help debug failures. The renderer and mock-upstream fixes remain in separate commits (as previously pushed to main), but this PR will point to the specific CI changes made here.
