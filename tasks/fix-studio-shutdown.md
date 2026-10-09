# FIX-STUDIO-SHUTDOWN-20261005

Fresh main: `c5e40cabc66440945d98faf4ac4b48239ece4793`.
Root owns serial integration/delivery. Release owns the bounded quit-barrier
repair and its existing tests; QA owns the existing Studio diagnostic; media
owns the separately reproduced Studio progress correction.

The historical Windows Studio diagnostic completed its UI observations, then
timed out after 180 seconds at the inferred `app.close()` boundary. A retry
passed. That does not identify a product cause. Preserve the original log and
read-only audit: `.homebot/.kilo/studio-close-flake-audit-1c-1791112781120.json`.

A separate concrete quit-barrier contract defect is reproduced: after blocking
native quit and marking cleanup pending, the main handler calls connector
shutdown before attaching promise error/finally handlers. A synchronous error
escapes, leaving repeated quits blocked. Root executed the actual main handler
transpiled into controlled Electron/cleanup fixtures: the original production
source gives 1 failed regression and 3 passing controls, native process exit
1/no signal. `quit-baseline-1791142242033.json` and its log retain source hashes;
the log SHA is `825A6EA946826C60D3663373DE1F10D49E678E9F9691EEBE410FF0DCD495782F`.

The proposed minimal repair invokes shutdown in a promise callback so both
synchronous exceptions and promise rejections reach the same error/finally
path. Keep once-only cleanup and native quit. Existing tests now provide the
actual workspace cleanup callback instead of accidentally catching an undefined
fixture reference. Root ran the fixed fixture: all 4 tests passed, native exit
0/no signal, with source/test hashes frozen across execution. The related MCP
quit, shutdown and client suites passed all 36 tests in 3 suites. Scoped ESLint
also exited 0/no signal. Receipts are `quit-fixed-1791142393906.json` (log SHA
`C02E1658CCB095ECA2BE59E8F5E6D036B1EF39CE03AF3CB88825E66A6805E350`)
and `quit-related-1791142396678.json` (log SHA
`CA85107C7A4CEA7DE489911AE682D73C4C9D77A31172E47E576FD5EE8BE05DC8`).
This controlled main-handler proof does not identify the historical Studio
timeout's cause or establish real Electron shutdown acceptance.

The Studio diagnostic is strengthened with a fresh fixture profile,
owned loopback model server, real stage error/persistence assertions, passive
quit/native-exit milestones and retained evidence. No real model, cloud request,
increased timeout, replaced close handler or forced native quit is approved.
Hosted-only execution preserves the declared legacy CI-workspace RAG read
exception. The initially published 26445c8 diagnostic source SHA was
`5DA40C9A833413B58C77F32D000EDE435B7CEA36ED9DB8D51B3AE56B69795969`.
At that checkpoint root scoped lint exited 0/no signal and Playwright listed
exactly 1 test in 1 file; no local Electron was launched. This runtime proof
remains pending. Source edits are complete and released to root serial
integration for exact-head hosted checks, evidence review and configured review.

## Retained hosted instrument failure and correction

PR #468's initial 26445c8 head is not accepted. Ubuntu job 111514805721 failed
all six executions at `app.process()` after normal `app.close()` had resolved:
Playwright had disposed its application handle. Its log SHA is
`D1D13858A27B76870EDF5F2969D214486AD43B00269B9C2C516D57A57D00C972`.
Mac job 111514805781 reported the same six post-close failures (log SHA
`38F4B08D96D3D4F952FA6A0200B9CB87C2B34C857236E4C7B18D7DE9E4367C21`).
Digest-bound Ubuntu artifact 11313133487 was downloaded and read by the guarded
reader. Three final-attempt receipts record functional stages passed, native
PIDs 10284/10377/10471 exit 0/no signal, and close resolving in 264/294/294 ms.
The extraction receipt SHA is
`997A25566C73CF03A544F560E7D8D399D49072828433D245CD45E7E88A0415D2`.
RAG-after and remaining assertions had not executed; this is not full acceptance.
Root viewed all three retry-0 images. Created-job and error captures were
offviewport; their executed DOM assertions qualified separately.

The instrument now retains the exact child captured while the handle is live,
then checks that same native object after unchanged normal close. Three scrolls
align the existing captures with the job/working/error UI. Configured review's
P2 also identified two opt-in MCP tests checking the old emitted promise-chain
spelling. Only that obsolete assertion was removed in each; compiled provenance,
real fixtures and native/connector exit-ordering assertions remain intact.
Independent source review accepts these corrections; opt-in execution is not
claimed. The previous failed head and review are preserved; a new published
head requires fresh full CI/runtime evidence and configured review.

## Reproduced Studio progress defect

The actual Working image shows Export in progress during Write script. Parent
source passes generic job busy to export status, also affecting narration and
output-settings saves. Root ran seven new deferred parent-component cases
against unchanged panel SHA AFD6B5DDE8225A2F62145A2E00FD0F87806D587D12F92DB0F610180BD0B4C079:
script/narration/settings negatives fail on that exact wrong heading, while
actual render plus three persisted active-export controls pass. Seven existing
cases also pass: actual result 3 failed/11 passed/14 total, native exit 1/null.
Receipt `studio-progress-baseline-1791143583558.json` retains test/source identity;
log SHA `989EF3505BC2CABD261AEBD09A476492A89804CDB64CA05EDFF894D61F2B3C88`.
Minimal explicit render-operation tracking is authorized after this reproduction.
Generic busy disabling, all five actual render callers, persisted active
attempts and prior-good previews remain. Root's fixed real-component fixture
passes 14/14; the related render-action, preview and export-status suites pass
25/25 in 3 suites, native exits 0/null. Frozen panel SHA is
`5DEC214A49AA4E55DF3D8A0259DDDDC85C878D8CA8FF40703DE2B34672C7BD48`;
test SHA `0D7D7D57BDEC0E57F3D4167019FB2BFCB0C09DC78810FBF1C1D6FA17CB8DA40E`
is unchanged between baseline/fixed. Fixed log SHA is
`622C5F9CC493B4FD5A556BCE337268324F311456A75BFB72CD08196A9D5E8C61`;
related log SHA `0B1CB6D2AD872055F2537B904760198E595946A7E458A02DFDC3C55375998706`.
Final scoped lint passed; independent source review accepted the bounded diff.
These are React/jsdom/API fixtures, not real movie generation or Electron proof.
Source editing is complete and released to root serial integration; final-head
hosted checks and configured review remain pending. The compiled flow checks that
its fresh job says No movie selected while only writing, before the real 503.
Final diagnostic source SHA is
`33693E848BA2BCE1F774AEF4BB51AAE6DEE8307069855D26802788801FA09556`.

All lightweight tests use root's serial resource wrapper, minimum 1 GiB disk
and 0.5 GiB RAM, and read-only junctions after four matching dependency manifests.
Heavy local build/package/GUI jobs still require 5 GiB disk and 2 GiB RAM.
Hosted follow-up 387cf / matrix 37230292900 is retained as an unaccepted head:
Windows typechecking caught unsupported `exact` options in two new ByRole
assertions. Root removed those options; their string accessible names retain
exact matching. Product panel/main/diagnostic sources are unchanged. Actual
corrected unit E685C29E passed all 25 related tests, native code 0/signal null,
receipt `.kilo/studio-progress-related-1791144152250.json`, log SHA
`6828A3CCCD36EA762B1450698BE60A7BC64771D26D6C1C25B3206982F8D50747`.
The corrected test source needs another exact-head hosted typecheck/full CI,
configured review and compiled evidence before landing; prior runs stay preserved.

The configured f19c8 review completed and raised a second P2: a single render
job ID loses pending status when another job starts or an overlapping call
settles. Root kept PR468 draft/auto-merge off and reopened only the media pair.
Actual frozen 5DEC/7D624 baseline reproduced seven missing-status failures with
the existing 14 cases passing (native 1/null, 21 total), receipt
`.kilo/studio-overlap-baseline-1791144638345.json`, log SHA
`1C094164797F1D4A581ED9D13337691E7827D10256ED4CBFE6D7CD4182967C19`.
Immutable per-job render counts now increment/decrement only their own captured
render invocation; ordinary work does not clear another render. Counts preserve
two jobs, either completion order, and repeated scene regeneration for one job.
Panel SHA `90655EC9A090A9764BB30F2D898FC66AC7C96F11E5E8846D28A81D62AC8E83E8`
and unit SHA `7D6243724B8137AC1E78B88A3C495F2F0D699C343DAFB7DA6C1761BA420D9F5D`
froze across fixed 21/21 and related 32/32 passes (both native 0/null), receipts
`.kilo/studio-overlap-fixed-1791144677562.json` and
`.kilo/studio-overlap-related-1791144683683.json`; related log SHA
`B381941F294A92B48390F45529638F9CDBA60A4B8F1B6B303B8649B43C25A73E`.
Scoped two-file lint passed. Shutdown sources remain unchanged and bound to
the prior 36 passing related tests. Fresh final-head hosted checks/review remain
required; earlier single-job evidence is not acceptance of the changed source.
The previously verified Desktop 2a package remains unchanged. A source repair
or hosted result does not refresh that executable or prove complete app acceptance.
The read-only delivery audit binds the actual shortcut and launcher to 2a.
Dependencies can be reused without another install, but fresh compiled output
and an owned 385,531,938-byte model-cache copy are required. Retaining the heavy
floor gives a planning baseline of 7.063 GiB free disk plus unknown overhead;
available resources after the checks were 4.185 GiB disk / 1.850 GiB RAM.
Deduplication was assessed but not performed: equal runtime bytes alone cannot
cover the entry shortage, and model hardlinks introduce cross-stage write aliases.

## Windows process-ownership instrument correction

c6714's full widget CI passed 371 suites / 4,957 tests, with 11 suites / 33
tests skipped, plus typecheck/build/overlay checks. Configured review completed
without new findings; both earlier addressed P2 threads are resolved.
Matrix 37231291017 failed only Windows shard 1. All six Studio executions
completed functional stages and normal native exit, then failed line 319's
requirement that Electron main milestone PID equal app.process().pid.
The retained final retry evidence has shell/main pairs 1528/8360, 8124/5624
and 1704/7648, native exit 0/null and all four main quit milestones present.
Installed Playwright's Windows launch sets shell:true; Unix launches directly.
The correction must bind Electron's captured PID/PPID/platform to the owned
shell on Windows, and direct owned child on Unix. Check main quit/process-exit
code 0 independently of the owned child exit 0/null. Preserve real close,
transport controls, isolated stores, provenance and the original timeout.
Windows artifact 11314377795 SHA256
`0f08d53b15ddfd2a7d70ed8887dc494e675aa0ab05f5b3162e8bdb239a4dc3e3`
and job 111521278394 log SHA256
`cc90e69918285bce43d19fe125083d4b702bd3aeca13ceea61e4b647df1c3fb9`
remain failed evidence. PR468 is draft with auto-merge disabled. No historical
timeout cause, new-head acceptance or refreshed Desktop build is claimed.

Released diagnostic SHA256
`7919F80B926EA7215AC5A182D5370A566E940E28987740C78A70C1B583115997`
captures main PID/PPID/platform before close. Windows requires a distinct
main PID whose PPID equals the owned shell PID; Linux/Mac require direct PID
equality. Every lifecycle row must match main PID, observer-installed is
required, and quit/process-exit must each report code 0. The wrapper still
must exit 0 without a signal. Root's scoped ESLint and Playwright discovery
both exited 0/null at 20:36 UTC; discovery found exactly the one target test.
No local Electron launch or typecheck is claimed under the heavy resource
hold. Fresh hosted ancestry/runtime/whole-CI proof remains mandatory.
