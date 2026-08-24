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

**Measured on Linux, 2026-08-24**, same tree, same command, only `TMPDIR` differing:

| | Suites failed | Tests failed |
|---|---|---|
| without `TMPDIR` | 4 | 79 |
| `TMPDIR="$HOME/homebot-test-tmp"` | 1 | 5 |

The 74 tests that flip are environmental — `codebase-tool`, `edit-file-tool` and
`filesystem`, all denied by the home boundary. They are not bugs, and chasing
them is worse than running nothing. (`ci.yml` records 92 across 10 suites from an
older tree; expect the shape, not the exact count.)

`os.tmpdir()` honours `TMPDIR` on Linux, so pointing it inside `$HOME` makes the
suite meaningful. `.github/workflows/copilot-setup-steps.yml` also exports it,
but export it on the command line anyway — a silent fallback to `/tmp` is
indistinguishable from real breakage.

## The 5 that remain are supposed to fail here

All of them are `src/main/__tests__/sd-cpp-setup.test.ts`, and all share one
cause — `sd-cpp-setup.ts:177` refuses by design:

```
if (process.platform !== 'win32') {
  throw new Error('Automatic setup currently supports Windows only.');
}
```

That is a real product decision, not a broken test. **On Linux, 5 failed in
`sd-cpp-setup.test.ts` is the clean result.** Do not "fix" them, and do not
report them as a regression. Anything beyond those 5 is yours.

## When you cannot run it

HomeBot ships Windows-only, and `ci.yml` runs the widget job on `windows-latest`
because that is the only platform the suite passes on. A handful of suites assert
on literal `C:\...` paths and may still behave oddly on Linux even with `TMPDIR`
set.

So if the suite will not run, **say so in the PR body in plain words** — "typecheck
clean, unit tests not run in this environment" — and never write "tests passing"
or "verified" for something you did not execute. An honest *unverified* is useful.
A false green costs a reviewer more than the change was worth.
