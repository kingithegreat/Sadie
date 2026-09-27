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

The quit wiring tests transpile and execute the exact main entry shutdown section in a VM with controlled Electron callbacks; they do not launch Electron. The initial source verification used controlled SDK clients, never default npx or real provider/server processes. No install, native rebuild, owner profile/config write, key/account, provider request, process kill, build or live lane was used for that initial verification. The subsequent coordinated actual proof follows below. Full-suite/current-head CI remains root's separate gate.

## Coordinated actual built acceptance

Root allocated the actual-app lane after reviewing production commit 44f3816e. Production remained unchanged throughout this acceptance. The initial sandboxed build failed on esbuild directory access and is retained in widget/mcp-live-build.log; the authorized isolated build succeeded in widget/mcp-live-build-authorized.log. No dependency install or native rebuild occurred.

The opt-in mcp-shutdown.live.e2e.spec.ts (HOMEBOT_MCP_SHUTDOWN_LIVE=1) executes one directly owned disposable Node MCP fixture through the **actual installed SDK stdio transport** in each fresh app. The fixture implements JSON-RPC initialize/tool discovery, delays the selected phase, and waits 450ms after stdin EOF before exiting. Its watchdog bounds fixture lifetime but did not fire. Explicit mcp-servers.json contains only this fixture; all other connectors are absent. Homes/profile/AP marker/projects contain no owner data or credentials.

An exclusive own entry shim installs startup transport guards before requiring the unchanged compiled main. Five network positive controls pass inside each launched main; startup inventory alone is a synthetic local fixture. Two startup axios requests were denied per launch and three inventory fixture responses supplied. No real provider, model process, default npx connector, download or account was used. Built freshness checks require the pending-ownership and awaited-quit code.

Installed Playwright launches Electron through cmd on Windows even with executablePath. The test records that launcher independently of native Electron and the SDK fixture, including PID/parent/creation identities without command lines. Actual public preload mcpListServers confirms the one fixture configuration; mcpGetStatus reports one real tool in the ready control and no connected entry during the two pending phases. The actual Electron app.quit invokes the real before-quit handler; no IPC or lifecycle implementation is replaced.

**First Electron attempt: 3/3 passed, zero skips/retries, 34.6s total.** Ready control, pending handshake and pending discovery all completed. Fixture EOF-to-exit delays were 454/463/465ms; native will-quit followed child exit by 34/30/26ms respectively. Native and launcher exit codes were both zero. Child/native creation identities were absent after exit. Pending phases sent no delayed response; fixture logs stayed unchanged for another 3.5s after native exit, with exactly one birth per launch. No watchdog or forced/global kill occurred. All assertion/teardown stages completed, exact own shims removed, and the lane was released to root.

Artifacts: .kilo/finish-20260927/mcp-shutdown-attempt-1.log, matching report/JUnit siblings, and phase-specific mcp-shutdown-evidence.json, fixture-events.jsonl, app-events.jsonl and stages.json under .kilo/finish-20260927/mcp-shutdown-attempt-1-results. JUnit records three real passes, zero failures/skips/errors. Actual compiled main SHA-256: 560a80d9584ae6de0be7257de69ab9b3b48f6df50982b6814c9334a21d21a6b3.

The exact executed live spec passed TypeScript and changed-file ESLint before launch; collection found three tests. Root docs:check and diff checks pass afterward. No broad suite was repeated for this test-only addition. The controlled direct-Node acceptance proves ownership/cancellation/awaited quit on that path; windowsShellDescendantsProved remains false in the evidence. It does not establish cleanup of the default cmd/npx descendant tree or installer/account/provider acceptance.

## Remaining boundary

FINISH-MCP-SHELL-PROOF-1 prepared follow-up: a separate opt-in mcp-shell-shutdown.live.e2e.spec.ts keeps the executed direct-Node spec unchanged. Its actual SDK configuration is cmd /c with this test's own Node executable and disposable fixture, never npx. Two cases cover ready and pending handshake. Pre-entry guards and the single-connector profile are retained. Record launcher cmd, native Electron, SDK cmd and fixture Node PID/parent/creation identities; preserve before/after snapshots before assertions. Failure cleanup waits only for those recorded identities and the fixture's own 25s watchdog, with no external/global kill. Two tests collect; source lint/type are checked before the coordinated launch. Preparation changes no product code or descendant claim; actual results are required before interpreting this boundary.

Root subsequently released the lane. **Shell first attempt passed 2/2, zero skips/retries, 33.7s total.** Actual ready and pending-handshake paths observed the complete Playwright cmd -> native Electron -> SDK cmd -> own Node chain by PID/parent/creation identity. The SDK shell and its Node descendant were both absent after launcher exit; Node EOF-to-exit took 462/460ms and native will-quit followed by 59/61ms. Native and launcher exit codes were zero; no events changed during another 3.5s observation, exactly one fixture birth occurred, and pending handshake never sent its delayed response. No watchdog, process kill, npx, provider, model or download occurred. Each app observed five startup transport controls, two denied startup axios calls and three local inventory responses.

There is no concrete failure warranting Windows product tree-kill code from this result. This is a cooperative controlled cmd/Node fixture; it proves the actual SDK's awaited cleanup handles that chain, while windowsDefaultNpxDescendantsProved remains false. Original three direct-Node proofs remain separate and untouched. Product code has zero delta from c6c42f0c and the compiled main hash stays 560a80d9584ae6de0be7257de69ab9b3b48f6df50982b6814c9334a21d21a6b3. No new build or unit suite was needed for the separate test-only shell fixture.

Shell artifact paths: .kilo/finish-20260927/mcp-shell-attempt-1.log, corresponding report/JUnit (two passes, zero failures/skips/errors), and phase-specific owned-identities.json, after-launcher-exit.json, mcp-shutdown-evidence.json, app/fixture events and stages under .kilo/finish-20260927/mcp-shell-attempt-1-results. Exact executed spec passed widget TypeScript (widget/mcp-shell-type.log), changed-file ESLint and collection before launch; docs/diff checks pass afterward. Actual lane released and follow-up claim closed.

Integration: fresh main c3d8c787 (#427 recovery fixture and #424 paid image routing) merged cleanly after the actual proof. The tested MCP production, entry quit wiring and all three MCP test files/live spec have zero diff from faf5e1c6. The three MCP suites plus changed IPC registration suite passed 44/44 with no skips/retries; widget typecheck and docs/diff checks pass. Logs: widget/mcp-main-integration-tests.log and widget/mcp-main-integration-type.log. No repeated build/live run was performed for unrelated incoming changes.

Installed SDK 1.30.0 StdioClientTransport closes stdin, waits, and kills only its direct process. Defaults use cmd /c npx on Windows. Properly awaiting its close may be sufficient for ordinary servers, but the source alone does not prove descendant cleanup. If a controlled disposable child fixture demonstrates descendants surviving completed SDK cleanup, that needs separately owned Windows tree cleanup and identity controls. This task deliberately adds no name-based or global kill.
