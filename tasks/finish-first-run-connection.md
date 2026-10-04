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

## Hosted compiled-UI regression preparation

The approved follow-up adds one Windows regression to the existing
`first-run.e2e.spec.ts`, using its existing `launchElectronApp` and the workflow's
fresh electron-vite build. It asserts actual `out/main` execution, the compiled
renderer file URL, hydrated UI and explicit disposable userData/HOME/USERPROFILE/
APPDATA/LOCALAPPDATA/TEMP/TMP/CODEX/AP/projects paths. Only the model-discovery
IPC map entry is replaced with deferred dummy responses; the original preload,
wizard and settings save/load remain unchanged. All dummy payloads are retained.

The UI starts Groq/key-A, switches to OpenAI/key-B, starts the current request
and then receives the old success. It must remain Checking with Next disabled
until the current response arrives. Finishing must persist the current provider
and model; when secureStorage is available the dummy key is encrypted on disk.
The unchanged settings-load IPC must recover key-B.

Postlaunch transport denial has five Node fetch/http/https positive controls
and one Chromium-session control via Electron net. The renderer's actual CSP
would block an external fetch before the session callback, so it is not weakened
or counted as a transport hit. Complete observed blocks are retained; only the
fixture-provider destinations are asserted absent. This is bounded postlaunch
coverage, not startup or blanket privacy. Handler restoration and normal child
close are independently bounded, with original proof and separate cleanup errors
retained. Denial remains active until the owned child terminates; success also
requires its actual exit code 0 and no signal.

At initial preparation this regression had not run locally or in hosted CI. Historical
source head `2f8445ce` CI is not green: the macOS shard-3 dependency installation
failed with ECONNRESET before Build widget/E2E. Root retained job 111412065869's
log separately. The upcoming amended head requires fresh exact-head CI;
historical source-test receipts are preserved rather than relabeled.

The compiled-UI case is restricted to Windows GitHub Actions and deliberately
skips normal local runs. Development RAG eagerly imports
`path.resolve(out/main, '../../../../memory/rag-index.json')`, which is outside
the fixture HOME/userData. This is an explicit CI-workspace import read
exception; the test records the exact path and its before-launch/after-native-
termination absence or SHA-256 equality. It performs no RAG or chat action and
must prove no RAG write. The profile claims therefore cover the named fixture
stores, not universal per-store isolation. PASS also requires native exit 0 and
no signal. No product hook or compiled-tree copy was introduced.

Both success screenshots and the final JSON receipt are explicitly attached
with their PNG/JSON content types so the existing per-OS Playwright HTML report
upload retains them. A JSON attachment failure preserves any original proof or
teardown error; otherwise it fails the test. No workflow or scenario changed.
The attachment-only update passes scoped ESLint (native exit 0, no warnings);
actual hosted artifact retention remains pending.

## Hosted launch-instrument failure and bounded correction

Exact head `8ff66604`, run `37194870580`, Windows shard-1 job
`111414537576` failed all six executions before the model fixture or UI race.
The harness incorrectly treated `process.argv[1]` as the compiled entry;
Playwright prepends `--inspect=0`. This is an instrument failure, not evidence
of a production race failure. The first outer attempt's three failures remain
in the raw job log; the uploaded HTML report retains the final outer attempt's
three JSON receipts. Each retained receipt records native exit 0/null and an
absent, unchanged legacy RAG file. Model responses and the six transport
controls did not execute, and there are no success screenshots for this case.

Artifact `11301430699` is preserved with digest
`4dba8618973bae8d5f674fef10a465fd1e66db4a258a67d0db0eeed744126b10`.
Independent semantic review is retained in
`.kilo/hosted-first-run-failure-review-1791110412033.json`. Full source-tree
equality between reviewed `8ff66604` and actual synthetic checkout `9faa3f32`
is separately retained; it is not UI acceptance.

The correction changes only launch verification: capture full live argv and
require a unique exact absolute compiled entry, then bind Electron's actual
appPath to its directory. After the unchanged renderer URL/hydration checks,
inspect the real CommonJS cache via Node's builtin createRequire at that actual
appPath; require the loaded module's actual filename and loaded flag. Installed
Playwright and Electron default-app source establish the flag injection and
independent appPath resolution. No positional argv or process.mainModule
availability assumption remains. Independent review accepted the correction;
component/unit bytes, race scenario, network guards, attachments and cleanup
remain unchanged. Fresh exact-head hosted execution is required; no local GUI
or build has run.

While corrected head `0ef4405e` was executing in hosted run `37196190037`,
root's source audit identified a second instrument issue: the Online path
card's accessible name includes its icon, description and possible recommendation
badge. The scoped exact `Online` role query would not match that name. A one-line
correction uses the same scoped nonexact name query as the existing first-run
case. Other exact locators were checked against current JSX: OpenAI has no free
badge; Test Connection/Checking, Next and Get Started render only their expected
button text; the success status has the expected plain text. This is a
source-derived locator correction, not a new production defect or an executed
race result. The `0ef4405e` run and any cancellation/failure evidence remain
separate; the next published head requires fresh hosted execution.

Root's lightweight React role probe passes one case with 62 intentionally
excluded tests, native exit 0/null. Exact Online is absent; /Online/ finds the
path card and clicking it exposes the key input. Testing Library defaults to
exact string matching, whereas this Playwright locator defaults to substring
matching. Two initial private-probe failures (module resolution and string
matching semantics) remain preserved; only that private runner was corrected.
Receipt `.kilo/online-accessibility-1791111536558/receipt.json` records the
actual proof. Scoped E2E ESLint also exits 0/null with no errors. Component and
unit-test hashes remain unchanged; no hosted Electron success is inferred.
