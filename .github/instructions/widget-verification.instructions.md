---
applyTo: "widget/**"
---

# Verifying a change in `widget/`

`widget/` is the actual Electron app. Root-level CI does not test it: `ci.yml`'s
`build` job runs at the repo root, whose tsconfig covers only root `src/` and
whose package has no lint or build script, so `--if-present` silently skips both.
A green root job says nothing about whether the app compiles.

## The command

```bash
cd widget
TMPDIR="$HOME/homebot-test-tmp" npx tsc --noEmit \
  && npm run lint \
  && TMPDIR="$HOME/homebot-test-tmp" npx jest --config=jest.config.ts --runInBand --no-coverage
```

## Why TMPDIR is not optional on Linux

43 test files under `widget/src` write their fixtures to `os.tmpdir()`. The
main-process file tools refuse any path outside `os.homedir()` —
`main/tools/git.ts`, `main/tools/diff.ts`, `main/workspace-ipc.ts`, all through
`main/utils/home-boundary.ts`. On Windows `os.tmpdir()` already sits under the
profile root, so the two coincide and nobody notices. On Linux `os.tmpdir()` is
`/tmp` and home is `/home/runner`, so every fixture path is denied.

`ci.yml` records what that costs: *"The first run of this job on ubuntu failed 92
tests across 10 suites for exactly that reason."* Those 92 failures are
environmental. They are not bugs, and chasing them is worse than running nothing.

`os.tmpdir()` honours `TMPDIR` on Linux, so pointing it inside `$HOME` makes the
suite meaningful. `.github/workflows/copilot-setup-steps.yml` also exports it,
but export it on the command line anyway — a silent fallback to `/tmp` is
indistinguishable from real breakage.

## When you cannot run it

HomeBot ships Windows-only, and `ci.yml` runs the widget job on `windows-latest`
because that is the only platform the suite passes on. A handful of suites assert
on literal `C:\...` paths and may still behave oddly on Linux even with `TMPDIR`
set.

So if the suite will not run, **say so in the PR body in plain words** — "typecheck
clean, unit tests not run in this environment" — and never write "tests passing"
or "verified" for something you did not execute. An honest *unverified* is useful.
A false green costs a reviewer more than the change was worth.
