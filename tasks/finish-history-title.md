# FINISH-HISTORY-TITLE-1

Opening a saved one-reply conversation after restart sent another title request
and overwrote an edited title. The installed ChatGPT subscription reproduced the
extra request on packaged main 82c19c4e after a real reply. No further account
calls were used for this fix's controls.

Loading a saved completed assistant reply now marks that conversation's title
as handled before updating renderer state. The active-conversation IPC finishes
before the ID and loaded messages change together. Fresh replies still generate
titles; conversations without a completed reply are not marked as handled.

## Verification

- Production-built Electron, disposable HOME/profile/projects and empty MCP.
  A real local Node CLI subprocess supplied synthetic replies through the
  normal Codex protocol. No test router hook, account, model or network used.
- Baseline `history-title-baseline-1790817219855/evidence.json`: visible sidebar
  selection made one title request and overwrote `Owner edited title`.
- Fixed `history-title-fixed-1790817339353/evidence.json`: saved title/messages
  preserved, zero history requests; fresh visible chat made one chat and one
  title request; restart/sidebar selection preserved bytes with zero extra
  requests. Both native closes passed. Screenshot inspected.
- Production build, widget TypeScript, scoped ESLint (zero errors; two existing
  warnings), docs sync and 108 memory/custom-LLM tests passed.
- Retained failed probe `history-title-fixed-1790817274005`: asynchronous IPC
  inside `page.waitForFunction` was treated as a truthy Promise before the title
  request completed. Corrected to explicitly await IPC results and poll them.
- The real-subscription probe independently reached and displayed its saved
  reply after restart, then failed by polling main-process instrumentation in
  the renderer. Those failures are harness failures, not complete test passes.

Evidence folders are under `.kilo/` in this worktree. Exact-head CI,
landed-content verification and refreshed packaging remain root's next steps.
