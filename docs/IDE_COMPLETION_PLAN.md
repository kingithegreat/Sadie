# IDE completion work

User instruction: **"deploy agents finsh all of this"** after the HomeBot IDE feature audit.

Base: fresh main `79ffc386`, subsequently integrated through main `7951c205` (Studio playback #473). Root integrates on `claude/ide-finish-20261007`; independent agents work from the same merged baseline. The audit is preserved in draft #472 and `C:/Users/adenk/.homebot/ide-audit-source-20261007/docs/IDE_FEATURE_AUDIT.md`. This is implementation work, superseding prior deferral of core Code expansion. It does not reopen unrelated held media PRs.

## Ownership and delivery

| Track | Owner | Outcome | State |
|---|---|---|---|
| Conflict-safe Save, buffer synchronization, atomic/BOM/EOL writes | ide_files_safety | Another writer's edits and newer typing survive; user can compare/reload/explicitly overwrite | Integrated; focused tests pass; runtime pending |
| Project picker/recent roots, file/folder CRUD, hidden files, refresh, copy/reveal | ide_files_safety | Ordinary project/file workflows reachable in Explorer | Integrated; approved-folder/revocation tests pass |
| Dirty recovery, tabs, Quick Open/palette, split/breadcrumbs/layout/keyboard | ide_files_safety + editor contracts | Reopen drafts; navigate and arrange code without loss | Integrated; combined focus/restart acceptance pending |
| Authoritative AI project scope and write gating | ide_ai_workflows | Requests bind a validated project without global retargeting; proposed writes require review | Integrated; real HTTP authority tests pass |
| AI transcript, cancellation/errors, selection/terminal context, project rules | ide_ai_workflows | Context and visible history survive panel/project changes | Integrated; combined UI/runtime pending |
| Approved plans, durable checkpoints and conflict-safe restoration | ide_ai_workflows | User approval authorizes a concrete plan; later user edits are preserved | Grouped recovery and atomic writes integrated; focused tests pass |
| Semantic codebase search, MCP health/activity, optional bounded completion | ide_ai_workflows | Existing resources provide useful, transparent context; unsupported setup is explicit | Integrated; actual small FIM model unavailable; provider quality unclaimed |
| Inline stale-target protection, language intelligence, formatting/preferences | ide_editor_language | TS/JS project semantics and safe inline edits work with unsaved buffers | Integrated; 29 focused tests pass; combined runtime pending |
| Lua/Luau highlighting; language support boundaries | ide_editor_language | Language detection and editor packs agree; no false semantic capability claims | Integrated; TS/JS semantics only |
| Interactive terminals/profiles/tabs; task streaming/Stop/dev servers | ide_files_safety | User can answer input, run and stop owned processes in the actual project | Integrated; native PTY and actual npm process-tree Stop pass; GUI pending |
| Git diffs/hunk staging/remotes/history/conflict resolution | ide_editor_language | Inspect, stage and synchronize real Git changes through UI | Integrated; real local Git tests pass; GUI pending |
| Debugging and focused test discovery/run/debug | ide_editor_language | Breakpoints/stepping/results reach real processes and files | Integrated; actual Node stepping/tests/coverage pass; GUI pending |
| Privacy/trust, keyboard/accessibility and resource behavior | Root + feature owners | Fresh-profile end-to-end and boundary checks, measured on delivered build | Integration gate |
| IPC/preload/shared contracts, serial integration, CI and launchable build | Root | Combined features reachable, tested and delivered without changing existing preview | Active |
| Extensions, remote SSH/WSL/containers, collaboration, notebooks, multi-root | Root scope coordination | Optional-platform scope question pending; not silently counted as complete | Pending scope clarification |

## Integration rules

- Root owns existing preload/index.ts, shared/types.ts, main/index.ts registrations, generated API docs and project trackers.
- Files agent owns WorkspaceShell/FileTree/workspace-ipc and new filesystem/recovery modules. Editor owns CodeEditor/language modules. AI owns assistant/Changes/proposals/context and minimal router/registry/filesystem-tool changes.
- Agents send exact APIs and coordinate shared component props before editing. New feature type modules may be owned with their feature; existing shared types remain root-owned.
- Only one guarded test/build at a time. Use the standing 5 GiB disk/2 GiB RAM guard. Never kill another session or weaken the threshold. Continue source preparation when blocked.
- Never install/rebuild through shared dependency junctions. Runtime TypeScript and native terminal packaging require real private dependency and delivered-app proof.
- Review patches and meaningful tests before integration. No placeholder controls or passing constant-only probes. Preserve original failure receipts.
- Keep draft publication until the final combined scope is coherent. Merge only with current required checks present/successful and content verified; regenerate the delivered build afterward.

## Acceptance

Reproduce the audit's data-loss/root/history defects, fix them, and prove final bytes/visible state. Then exercise a fresh-profile project flow: choose/create/rename/open configuration, edit/search/format, preserve external and dirty changes, run/stop interactive commands/tasks, navigate diagnostics and symbols, review/stage/commit/synchronize Git changes, ask AI with rules/selection/terminal context, approve a plan, accept intended changes, restore without discarding later edits, reopen after restart, and use actual debugging/test results. Repeat supported packaged Windows flows with private stores/native dependencies. Report remaining provider/model/platform limitations explicitly.

## Current evidence

Draft implementation PR: https://github.com/kingithegreat/Sadie/pull/474. The hosted full widget unit suite at `7908308` passed 398 active suites and 5,170 tests (11 suites/33 tests explicitly skipped). Its subsequent overlay acceptance failed on Escape; the complete required widget job is therefore red. Ubuntu/macOS shard 2 exposed the same failure. All required current-head CI contexts and all nine OS shards must finish successfully before merge.

Full TypeScript and the frozen 79-file build passed at `34e29df`; the real Explorer accessibility test also passed. Scoped lint at `7908308` had zero errors and five advisory React refs warnings. After the retained local full-suite failures, all 25 affected suites/404 tests passed; these are separate receipts, not a claim that the failed run passed. The built AI request then exposed saved model context being skipped when the first new turn was appended before hydration. The regression failed first and passed with the correction, alongside conversation privacy and workspace AI tests (three suites/32 tests).

Actual built Windows file runs have exercised Explorer CRUD/hidden files/refresh, BOM/CRLF Save, external-writer conflicts, Compare/confirmed Reload, Save As without clobbering, Quick Open focus, external buffer refresh, dirty restart recovery, xterm input/TTY geometry/Interrupt and Close. The built editor run has exercised real Git first-hunk staging with unchanged working bytes and a real Node breakpoint/watch/step/owned Stop. Final combined file/task, language/test/theme and assistant/plan/recovery acceptance remain pending.

The standalone direct-spawn Electron 42.8.1 native probe passed interactive input/resize, early Stop, natural-exit worker disposal, and a retry that stopped a captured child after its original root had exited, preserving an unrelated process. Its native OS exit was zero and all owned PIDs were absent. This proves native terminal behavior, not installer acceptance. One later GUI run refused quit because terminal tree exit could not be confirmed; its failure and exact-identity forced cleanup remain failed evidence. Windows Playwright's process handle was found to represent a launcher wrapper, so revised GUI probes identify and independently observe the actual Electron main as well as wrapper and owned children. Earlier wrapper-only exit claims are insufficient.

Original failures and corrected receipts are retained in the team worktrees and sibling `ide-finish-20261007-proof` directory. The existing owner preview, cleaned-main delivery and shared native dependencies remain protected. Only one guarded heavy job runs at a time; the 5 GiB disk/2 GiB RAM floor remains in force. A fresh merged-main launchable build and packaged Windows acceptance are still required; no installer claim is made. Provider/model quality and optional extension/remote/collaboration platforms remain unclaimed.
