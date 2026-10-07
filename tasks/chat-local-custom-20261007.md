# Local and custom chat verification

Aden requested delegated verification and fixes for both local and custom model
chat. Three agents worked from main `ce53a7db` in separate worktrees; root owns
combined review, publication, hosted gates and delivery.

The integrated changes preserve fragmented JSON/SSE and UTF-8, surface stream
errors, close cancelled transports, coordinate multiple custom tool requests,
retain Retry's original user message after model switches/overlapping sends,
and preserve useful partial replies when attachments must be reattached. Stop
also prevents queued tools and post-confirmation handlers from starting. A tool
already executing can finish; cancellation does not undo its effects.

Test-first bounded source controls and a four-request real Axios loopback prove
specific regressions and corrections. Original failed results remain in each
private worktree. Root independently inspected the Stop controls: eight original
failures plus four positive controls became twelve passes after correction.
These controls are not the full compiler, Jest or native acceptance gate.

The dedicated `chat-native` workflow builds the actual checkout on a disposable
Windows runner. Its two production-mode cases use real Settings/Send/Retry/Stop,
six recorded HTTP requests per provider, isolated stores, split UTF-8, preserved
context, actual provider errors and socket cancellation. No owner credentials,
paid providers or E2E stream-event injections are used. Exact discovery, no
skips/retries, unchanged compiled/dependency hashes and owned native process
disappearance receipts are required. Native OS exit codes and provider answer
quality are separate from this fixture acceptance.

Full hosted widget/root suites, semantic TypeScript, lint, production build,
native chat and configured review are pending. The local PC has less than the
standing 5 GiB disk floor; no heavy local build or GUI launch is authorized by
these preparation results. Existing user profiles and dependency hubs remain
unchanged. Source fixes are released to root's serial integration branch
`claude/chat-integration-20261007`; no merge or updated installed app is claimed.
