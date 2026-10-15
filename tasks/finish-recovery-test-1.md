# FINISH-RECOVERY-TEST-1 — settle real recovery fixture readiness

## Exact failed context

PR #421 head 57af9efa4ba76d9d62b369cb8d332ebe67b55647 has two distinct CI executions:

- [Failed push widget job](https://github.com/kingithegreat/Sadie/actions/runs/36278812044/job/108506603378):
  Unit tests failed only error-recovery-ux.test.tsx's first case, “Ollama offline hint…”.
  triggerRecoveryCard line 71 expected sendStreamMessage at least once, received zero.
  Totals: 1 failed / 4,683 passed / 31 skipped tests; 348 passed suites.
- [Successful pull-request widget job](https://github.com/kingithegreat/Sadie/actions/runs/36278818067/job/108506620849):
  same head SHA, unit tests, build and overlay acceptance succeeded.

The voice commit changes neither App, its send path, nor this recovery test. Voice suites passed
in the failed run. Its failure is not evidence that voice cancellation failed.
The full failed log is preserved locally in the original voice worktree's ignored
voice-widget-failure.log. No CI rerun was requested during this investigation.

## Source mechanism and controls

The old fixture rendered App and clicked Send synchronously before its startup promise settled,
then started a default waitFor deadline on a request that had not yet completed. App's bootstrap
awaits settings/conversations; its send handler awaits inventory and conversation creation before
calling the stream bridge. fireEvent.click does not await those promises.

Read-only unchanged local control: all 8 recovery tests passed; the first took 685 ms.
Thus the exact CI timeout was not reproduced locally, and load-related deadline expiry remains
an inference. CI console output is buffered until suite reporting: timestamps in that output
must not be treated as measured dispatch latency or proof of cross-test bridge leakage.

Two deterministic controls on the corrected fixture established the actual unsafe boundaries:

1. Restore synchronous render while keeping the production readiness assertion: the first case
   fails with data-hydrated missing instead of true. No recovery error is injected.
2. Restore synchronous Send while keeping the exact request assertion: the first case fails with
   zero sendStreamMessage calls. The queued send continuation is not yet settled.

Both controls were restored before final validation. They establish barrier necessity, not a
claim to have recreated the CI runner's wall-clock load. Logs: widget/recovery-readiness-negative.log
and widget/recovery-send-negative.log (ignored local evidence).

## Bounded correction

Only error-recovery-ux.test.tsx changes executable code. The fixture explicitly supplies firstRun=false,
the local model, disabled advisory routing, and mocked conversation/inventory APIs. It mounts the real
App inside async act and asserts its production data-hydrated attribute. Send runs inside async act;
the test asserts the exact message, conversation ID and stream ID before injecting partial chunks
or errors. Existing recovery-card, Retry, Start Ollama and Pull Model assertions remain intact.

No longer test timeouts, sleeps, skips, test-only production hooks or application behavior changes.

[PR #423](https://github.com/kingithegreat/Sadie/pull/423) was reviewed before editing. It owns shared
per-file temp-root isolation in setupTests and its guard, not this renderer readiness boundary.
The scopes do not duplicate each other; root coordinates their common CLAIMS documentation and
integration. This fresh branch starts at origin/main e4628326 and does not stack on the voice fix.

## Verification and limits

Final **8/8 recovery tests pass**, no skips or retries, normal Jest exit. Widget TypeScript --noEmit,
changed-file ESLint and git diff --check exit 0. Final ignored logs:
widget/recovery-fixture-final.log and widget/recovery-fixture-typecheck.log.

No full suite, app build, Electron launch, real profile, API provider or shared dependency rebuild.
The original voice feature worktree and commit remain unchanged. Root owns independent review,
publication, failed-context disposition and coordinated full checks.
