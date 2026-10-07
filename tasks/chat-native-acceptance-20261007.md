# Production local/custom chat acceptance

## Empty SSE heartbeat review correction

Configured review of `14a31cc8` identified that valid empty SSE data events were
sent to JSON parsing and stopped otherwise healthy custom, Anthropic and Gemini
replies. Three provider regressions reproduced the error before the fix. The
shared SSE dispatcher now ignores only assembled payloads with no non-space
data. Nonempty malformed frames still fail. All 93 cases across transport,
custom-client and tool-round-trip suites pass after the correction. Native custom
chat now writes three actual empty heartbeat events before its fragmented first
answer and records/requires their count; all six user turns and the exact title
request remain required. Widget/chat acceptance TypeScript and scoped lint pass.

The original local full-suite long-HOME failure is retained. Its short native
HOME rerun passed all 87 cases in the three affected media suites and recovered
every one of the 41 originally failing names. The original launcher was lost
during the sandbox-mode transition before root/docs receipts completed; native
process inspection confirmed both its guard and qualifier gone, and only its
exact stale lock was removed. The separate root/docs continuation passed 232
tests in 18 suites and docs drift checks.

Previous hosted CI had all 25 checks green (5,361 widget and 232 root tests,
14 overlay cases), plus 2/2 chat and 4/4 setup native acceptance. Those results
remain historical after this source change. Fresh published-head CI, native
acceptance, configured review and delivery remain required; auto-merge is held.

## Native acceptance contract

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
Full native qualification remains pending; local heavy checks are paused under
the shared RAM floor and active-owner resource lock.

## Hosted first-attempt evidence and corrections

Run `37609494020`, job `112752998668`, branch head `7738834da949cf195e05ceedd4598f50fd754f4c`
built successfully, then executed exactly two native cases and failed both.
The exercised PR merge checkout was `8891ef801337a96144fc7dfd96b32d12a804242c`
(tree `41f0fe6a0e0dde3c6a97d670c53215d4fa9a360e`); this is deliberately distinct
from the branch head. Proof artifact `11476407895` and compiled artifact
`11476437813` retained screenshots and strict shutdown receipts. Earlier run
`37607692233` / job `112752532026` remains separate failure evidence.

The local screenshot showed an unavailable `qwen2.5:7b` and fallback
`gemma4:e4b`, while the fixture advertised and accepted only `qwen2.5:3b`.
Startup hardware detection replaced the already chosen seed because it lacked
a hardware profile. Chat-only seeds now represent an already configured 4 GB
PC; ordinary first-user hardware detection remains unchanged. Custom stopped
at Connect, where the unscoped locator also matched multiple service connector
buttons. The locator now identifies the main cloud provider section. Nested
assertions and close failures are retained in `chat-failures.json` and included
in the reporter error; request proof preserves failures known before shutdown.

The first recorded local POST also proved a production defect: its exact current
user turn appeared twice. The IPC chat route records the turn before provider
assembly appends it. Its explicit `currentUserInHistory` option now omits only
the matching final entry for local/custom/Code API assembly, preserving earlier
repeated prompts and direct-call behavior. Native provider callbacks assert
that each current user turn appears exactly once.

Lightweight actual-source controls reproduced the duplicate against `7738834d`:
local 15 passed / 1 failed and cloud 1 passed / 1 failed. Corrected source passed
local 16 / 16 and cloud 2 / 2, including intentional repeated-prompt controls.
These are isolated transpilation controls, not full Jest or native success.
Playwright discovery still requires the exact two titles without executing
their test bodies. The remote manifest now retains the raw checkout commit
object, merge parents, PR head/base and workflow SHA alongside the tree and
compiled hashes.

## 2026-10-08 - integrated production native checkpoint

Run `37683605405` executed both native cases once on PR head `e91bf02e`;
the actual merge checkout was `7f2dc119`, with parents `69075fe5` and that
PR head. The downloaded proof archive `11510617242` matched its authenticated
SHA-256 digest before extraction. Local chat passed all six user requests,
fragmented UTF-8, context, partial error/Retry, actual socket Stop and resume.
Both cases retained positive native/launcher disappearance and no forced
cleanup; this does not prove native OS exit code zero.

Custom chat failed its request-count assertion after reaching those controls:
its seven recorded POSTs include six user chat requests and the ordinary
automatic first-exchange title request. The title request reached the exact
owned custom endpoint but the fixture rejected its prompt. This is retained
failure evidence, not custom-chat acceptance.

The fixture now recognizes only the exact first-exchange title transcript,
records that auxiliary request separately, serves a bounded title, and checks
its saved conversation title. Both the native test and runner still require
exactly six ordinary chat turns and account for every actual provider POST.
Production app code, request/Stop assertions and transport guards are unchanged.
Acceptance TypeScript, runner syntax and diff checks pass; fresh hosted native
and whole-head qualification remain required before landing or delivery.
