# FIX-STUDIO-SHUTDOWN-20261005

Fresh main: `c5e40cabc66440945d98faf4ac4b48239ece4793`.
Root owns serial integration/delivery. Release owns the bounded quit-barrier
repair and its existing tests; QA owns the existing Studio diagnostic.

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
exception. Its frozen source SHA is
`5DA40C9A833413B58C77F32D000EDE435B7CEA36ED9DB8D51B3AE56B69795969`.
Root scoped lint exited 0/no signal and actual Playwright discovery listed
exactly 1 test in 1 file; no local Electron was launched. This runtime proof
remains pending. Source edits are complete and released to root serial
integration for exact-head hosted checks, evidence review and configured review.

All lightweight tests use root's serial resource wrapper, minimum 1 GiB disk
and 0.5 GiB RAM, and read-only junctions after four matching dependency manifests.
Heavy local build/package/GUI jobs still require 5 GiB disk and 2 GiB RAM.
The previously verified Desktop 2a package remains unchanged. A source repair
or hosted result does not refresh that executable or prove complete app acceptance.
The read-only delivery audit binds the actual shortcut and launcher to 2a.
Dependencies can be reused without another install, but fresh compiled output
and an owned 385,531,938-byte model-cache copy are required. Retaining the heavy
floor gives a planning baseline of 7.063 GiB free disk plus unknown overhead;
available resources after the checks were 4.185 GiB disk / 1.850 GiB RAM.
Deduplication was assessed but not performed: equal runtime bytes alone cannot
cover the entry shortage, and model hardlinks introduce cross-stage write aliases.
