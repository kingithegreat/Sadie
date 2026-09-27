# FINISH-MCP-SHUTDOWN-1

Branch: claude/finish-mcp-shutdown-20260927. Base: 3b425f86c4b1c2281ebce559853c9f87c4b87a09 (fresh origin/main after #422). Root owns Drive, integration and the release lane. No push or merge performed here.

## Reachable defect and evidence

Normal tool initialization seeds default MCP configurations and fires initializeMcpServers without awaiting it. The MCP client previously tracked only connections whose handshake and tool discovery finished. before-quit called shutdown asynchronously without delaying native quit, and startup retries had no shutdown cancellation.

The release agent's retained native-quit diagnostic shows the native app gone while owned Node/conhost descendants remained and spawned further descendants. Those events establish a real lifecycle symptom, but do not identify whether pending startup, unawaited cleanup or Windows shell descendants caused that run. This source fix does not claim the diagnostic symptom eliminated.

The controlled SDK test executes actual mcp-client code with mocked SDK/config dependencies only. Its baseline had **six failures and one passing normal-connection control**:

- Pending handshake and pending discovery were not closed (zero close calls).
- Startup retry continued after shutdown, constructing six clients across two servers.
- Empty-tool discovery kept retrying after shutdown and reported connection success.
- A new request after shutdown constructed a transport and connected.
- A nonsettling close kept shutdown unbounded.

Baseline log: widget/mcp-shutdown-red.log. Positive control registered a real bridge definition in the supplied registry callback and closed its completed client. Deferred operations later resolve in the final tests to prove they cannot register or restore connected status after cancellation.

## Change

Ownership now begins before client.connect can start its transport, independently of the connected-only UI status list. A permanent process shutdown signal cancels handshakes, discovery and retry delays. Checks before allocation and after awaits prevent new startup attempts, replacement connections and late tool registration. Underlying promises remain observed after cancellation; completed operations clear their timers/listeners.

All owned clients close concurrently through an idempotent promise. Each close has a five-second bound, slightly longer than the SDK's ordinary two-plus-two-second direct-child cleanup sequence. Failure/timeout logs a generic warning and allows quit; it does not prove an unresponsive transport terminated. No process enumeration or kill was added. New connections remain disabled for the rest of this process.

The actual main entry's before-quit handler prevents the initial quit, runs the existing assistant/browser/global shortcut/service/supervisor cleanup once, awaits bounded MCP cleanup, then resumes app.quit. Repeated quit/window-close requests share the barrier. Noncritical service exceptions cannot strand connector cleanup. No workspace-task or privacy policy changes; held IDE drafts remain separate.

The existing MCP tests now load a fresh module per fixture instead of treating final shutdown as a reusable reset. External configuration discovery also uses the fixture's disposable home. An initial affected run exposed the old fixture's attempted creation of the owner's .cursor directory; sandbox EPERM blocked it, and that failed run is preserved in widget/mcp-shutdown-focused-1.log. Subsequent discovery operates entirely within its isolated home.

## Verification

- Final affected/adjacent suite: **82/82 tests, nine suites, no skips or retries**, widget/mcp-shutdown-final-tests.log. Includes unfinished handshake/discovery, cancellation of both retry ladders, replacement-after-await, idempotent concurrent bounded close, normal startup retry/next-server controls, actual main quit-handler wiring, connector catalog/UI, IPC registration and confirmation/permission guards.
- Widget TypeScript --noEmit passed, widget/mcp-shutdown-final-type.log.
- Full widget lint passed: zero errors, seven existing renderer hook warnings, widget/mcp-shutdown-lint.log. Final changed-file ESLint passed with no output, mcp-shutdown-final-eslint.log.
- Root docs:check in sync: 247 preload methods, 182 renderer-to-main, 33 main-to-renderer channels; git diff --check passed. No IPC contract was added.

The quit wiring tests transpile and execute the exact main entry shutdown section in a VM with controlled Electron callbacks; they do not launch Electron. All connector tests use controlled SDK clients, never default npx or real provider/server processes. No install, native rebuild, owner profile/config write, key/account, provider request, process kill, build or live lane was used. Root must coordinate actual built acceptance and full-suite/current-head CI separately.

## Remaining boundary

Installed SDK 1.30.0 StdioClientTransport closes stdin, waits, and kills only its direct process. Defaults use cmd /c npx on Windows. Properly awaiting its close may be sufficient for ordinary servers, but the source alone does not prove descendant cleanup. If a controlled disposable child fixture demonstrates descendants surviving completed SDK cleanup, that needs separately owned Windows tree cleanup and identity controls. This task deliberately adds no name-based or global kill.
