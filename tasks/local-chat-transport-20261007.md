# Local chat transport verification

Local Ollama chat previously parsed each network Buffer as complete JSON. A split
record disappeared, split UTF-8 could corrupt text, provider errors were ignored,
and interrupted responses reported successful completion. Stop left idle streams
open and could rerun a tool after a pending permission resolved.

The neutral NDJSON reader retains record and UTF-8 state, requires an explicit
done record, surfaces provider/protocol/close failures, and destroys cancelled
streams. The production router clears its flush timer and checks cancellation
before tool execution and after asynchronous permission/results/reflection.
Separate tool records are retained in one batch and announced to the UI. Requests
which do not offer tools cannot execute hallucinated structured/inline calls.

Verification: initial real Jest run on unchanged product source discovered nine
cases: eight failed and one final-record control passed, native Node exit 1.
Under the standing disk/RAM floor, the final eleven committed cases were then
executed through actual-source TypeScript transpilation with isolated dependency
mocks: eleven passed, exit 0. The original nine retain the same eight/one A/B
result against main ce53a7db. This bounded runner is retained privately at
`.kilo/local-chat-bounded.cjs`; it is not full Jest/compiler/native acceptance.

Final full Jest, TypeScript and native visible local/custom chat acceptance are
root-owned and pending hosted execution. No owner profile, installed model,
credential, shared dependency, paid provider, push or merge was changed.

Integration review correction: custom and Code API providers receive a tool
execution callback only when this request actually offers tool definitions.
Local initial/rerun batches now receive the originating AbortSignal, so the
executor can stop between asynchronous confirmation and actual handlers. Local
done records destroy the remaining transport. A successful model failover
updates the model badge, keeps that model for following tool rounds, updates
its generation budget, and preserves conversation instructions. A quality retry
carries an explicit no-tools flag into its new request.

Bounded verification on integrated base b2d8c955: fourteen local product-path
cases pass, including the new open-done socket, originating signal, failover
badge/follow-up and quality-retry controls. A separate actual-router A/B proves
the cloud greeting no-tools gate: unchanged integrated source executes the
unoffered read_file and a follow-up; corrected source exposes no callback,
executes no tool and ends once. These are isolated source-transpilation checks,
not final Jest/compiler/native acceptance. The executor's optional signal type
and enforcement are root-owned integration changes.
