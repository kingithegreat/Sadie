# FINISH-FIRST-RUN-CONNECTION-1 — keep Online checks tied to the current choice

Baseline: fresh main `5af9d592e357fe773ae5dbd087af54fabba37c94`.
Private branch: `claude/finish-first-run-connection-20261004`.
Scope: FirstRunModal, its existing React suite, the owned claim and this task.

The first-run Online screen lets people change the provider, subscription or API
key while a connection check is pending. Its original handler accepted the old
reply unconditionally. A successful reply could mark the new, untested choice
Connected and save it with the old choice's model. Enter could also start a
duplicate check despite the disabled button.

The repair assigns each check a generation and tracks the current request
synchronously. Provider/key/path changes invalidate it, including A → B → A.
Only the current generation may publish success, failure, model, subscription
status or busy completion. Back, Skip, closing and unmounting invalidate pending
responses. Moving to the final step preserves an already verified result for
the existing save flow. Editing choices remains available during a slow check.

Root published and read back the canonical claim before edits. All other claims
and the previously tested package remain preserved. Dependencies are read-only
junctions to the root-owned private integration after four manifest/lock files
matched exactly; there is no installation, copy or native rebuild.

## Verification

The source-handler reproduction is preserved separately as
`.homebot/.kilo/first-run-stale-check-source-proof-1791107165839.json`; it is a
source simulation, not React or GUI acceptance.

Root executed the new deferred-IPC tests against the unchanged component:
8 failures, 2 passing current-result controls and 52 intentionally excluded
existing tests. The real Jest child exited 1. Receipt
`.kilo/baseline-1791107666692.json` and its log preserve the original component
SHA-256 `6C262338EE2C6AEC61B96E017A349F338D40B0C6AF865307599241D922A5420A`.
Failures cover provider/key/subscription changes, A → B → A, Back/return,
out-of-order success/finally, stale failure and duplicate Enter.

The same ten targeted tests pass after the repair; 52 existing cases remain
deliberately excluded in this focused run. The real Jest child exited 0.
`.kilo/fixed-1791107838414.json` and its log bind the repaired component SHA-256
`38FAEBF44E81B7C972F9D9D18AC4FCF82D69FA2BF935020E6CA2D1FA06CF7966`
and the same regression-test bytes as the baseline.

Independent read-only review found no defect in generation invalidation,
duplicate Enter prevention, stale catch/finally handling, unmount cleanup or
preservation of the successful result through Next and Finish.

The unfiltered related run passes all 4 suites / 81 tests: first-run wizard,
Settings privacy switch, cloud defaults and save acknowledgement. The real
child exited 0; `.kilo/related-1791107851099.json` and its log bind exactly the
same repaired component and test hashes. Root's scoped ESLint child for the
component and existing test suite exited 0 with no warnings or errors.
These checks use mocked IPC in jsdom, one Jest worker and no cache, under the
explicitly authorized light-test resource guard (1 GiB disk / 0.5 GiB RAM).
Local full TypeScript, build and GUI checks remain held by the unchanged heavy
resource guard (5 GiB disk / 2 GiB RAM); the lighter fixture guard does not
authorize them. Hosted CI/typecheck/build will run on a root-published draft PR.
Built Electron and visible Online acceptance remain separate gates; no GUI,
provider request, owner key/profile, package rebuild,
installation or canonical document write is claimed by this source lane.

Root owns review, publication, CI, serial integration and final delivery.
