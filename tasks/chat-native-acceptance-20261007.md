# Production local/custom chat acceptance

`Chat native acceptance` builds the exact workflow checkout on a disposable
Windows runner and exercises two native cases through real controls. It reuses
the first-user fixture's pre-entry transport/process guards, isolated HOME and
stores, empty MCP configuration, immutable compiled payload and dependency
receipts, and strict native/launcher creation-identity disappearance checks.
The existing first-user runner still discovers and requires four cases by
default; the explicit `--chat` option requires the two exact chat titles.

Each case sends six real provider requests: fragmented JSON/SSE and split UTF-8,
conversation context, visible partial output followed by an actual provider
error, visible Retry, an open provider response closed through visible Stop,
and a completed response afterward. The custom case uses the real Settings
provider selector, keyless loopback Connect/model discovery, Online privacy
checkbox and Save path before sending. No E2E mock mode, stream-event injection,
owner service, paid provider or real credential is permitted.

Fixtures record request bodies, screenshots, guard state, exact compiled-entry
hash and strict shutdown receipts. The runner rejects absent/extra cases,
skips/retries, wrong providers, missing socket cancellation, changed runtime
bytes/dependency manifests/binaries, and missing process disappearance receipts.
It makes no native OS exit-code-zero claim.

Local verification is discovery and syntax only: Playwright listed the exact two
chat titles with no errors; no test body, build or Electron runtime was launched.
The native runner and config pass `node --check`; `git diff --check` passes.
Hosted full compilation and native results remain pending because local free
disk is below the standing 5 GiB launch floor.
