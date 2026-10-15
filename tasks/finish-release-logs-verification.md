# FINISH-RELEASE-LOGS-1 verification

Fresh-main branch: `claude/finish-release-logs-20260927`, base `e4628326`.

## Problem and change

The private Sharp package preparation successfully built but the existing release preflight rejected `[DIAG]` in the compiled main process. Runtime NODE_ENV guards had not been folded, and the deterministic E2E stream implementation remained in production output. An unconditional duplicate diagnostic also recorded the request in production.

`build:release` sets the internal `HOMEBOT_RELEASE_BUILD=1` flag. The Vite config then replaces NODE_ENV with literal production in main and preload. Ordinary builds preserve runtime NODE_ENV for CI and opt-in E2E. `dist` and `release` use the explicit build. The deterministic mock has a production guard, and the unconditional duplicate request diagnostic is removed. Privacy and routing flags, release scanner, and renderer build remain unchanged.

## Verified 2026-09-27 on Windows

Evidence root: `C:\Users\adenk\Desktop\homebot\.kilo\finish-20260927`.

- Ordinary build succeeded (`release-logs-normal-build.log`). Compiled positive control: DIAG 10, E2E-MOCK 5, mock starting-stream sentinel 1, mock interval sentinel 1 (`release-logs-normal-control.json`). Unchanged artifact scanner rejected that build, exit 1 (`release-logs-normal-scanner.log`).
- Existing `streams chunks to UI` Electron spec passed 1/1 without retries in 36.2 s (`release-logs-normal-mock-selected.log`, `release-mock-junit.xml`). Fresh disposable profile, isolated HOME, AP marker fixture, loopback upstream only; actual assistant contained chunk-1 through chunk-5. Electron processes exited. This proves the normal built deterministic mock is reachable, not a real model response. The first anchored CLI selector discovered no tests; retained separately as `release-logs-normal-mock.log` and corrected before claiming a pass.
- Explicit release build succeeded (`release-logs-explicit-build.log`). All four compiled marker counts zero (`release-logs-explicit-control.json`). Existing `--require-production --scan-artifacts` passed (`release-logs-explicit-scanner.log`). The true mock-body sentinels provide a control beyond stripping log labels.
- Widget and root typechecks passed; widget lint passed with seven existing warnings. Focused env/router tests 55/55 and root module-boundary tests 8/8 passed; docs check in sync. Logs: `release-logs-widget-tsc.log`, `release-logs-root-tsc.log`, `release-logs-lint.log`, `release-logs-focused.log`, `release-logs-root-focused.log`. These checks preceded the final one-line mock guard; built positive/negative controls above include it.

## Limits

No installer installation, signing, owner account/profile access, paid provider, or model download. Native packaged Sharp/CRM and export proof is a separate private preparation using tested Sharp commit `ad2a2d61` plus this release overlay, not yet an integrated release claim. The earlier failed package preflight remains `package-preflight.log`.

## Current-main integration — 28 September 2026

Merged current `origin/main` (`acc7ff82`, including #434 and #431) into the existing branch without changing the five-file release fix. The worktree remained clean after the merge and `git diff --check origin/main...HEAD` passed. On Windows, widget and root TypeScript checks, widget lint (zero errors, seven existing warnings), root docs check (247 preload methods), and the three focused router/environment suites (55/55) passed.

The normal built output contained 10 `[DIAG]` and five `[E2E-MOCK]` markers plus one each of the mock starting-stream and interval sentinels; the unchanged artifact scanner rejected it. The explicit `build:release` output contained zero of all four markers, and `preflight-env-check.js --require-production --scan-artifacts` passed. The first sandboxed explicit build could not read the Vite config through the shared dependency junction; the same command succeeded outside that restriction, so that access error is not a product-build failure. Full current-head CI, packaged restart and fresh-profile installer acceptance remain separate gates.
