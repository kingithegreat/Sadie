# IDE completion work

User instruction: **"deploy agents finsh all of this"** after the HomeBot IDE feature audit.

Base: fresh main `79ffc386`. Root integrates on `claude/ide-finish-20261007`; independent agents work from the same merged baseline. The audit is preserved in draft #472 and `C:/Users/adenk/.homebot/ide-audit-source-20261007/docs/IDE_FEATURE_AUDIT.md`. This is implementation work, superseding prior deferral of core Code expansion. It does not reopen unrelated held media PRs.

## Ownership and delivery

| Track | Owner | Outcome | State |
|---|---|---|---|
| Conflict-safe Save, buffer synchronization, atomic/BOM/EOL writes | ide_files_safety | Another writer's edits and newer typing survive; user can compare/reload/explicitly overwrite | Integrated; focused tests pass; runtime pending |
| Project picker/recent roots, file/folder CRUD, hidden files, refresh, copy/reveal | ide_files_safety | Ordinary project/file workflows reachable in Explorer | Integrated; outside-home trust follow-up active |
| Dirty recovery, tabs, Quick Open/palette, split/breadcrumbs/layout/keyboard | ide_files_safety + editor contracts | Reopen drafts; navigate and arrange code without loss | Recovery integrated; extended shell testing |
| Authoritative AI project scope and write gating | ide_ai_workflows | Requests bind a validated project without global retargeting; proposed writes require review | In-process safety integrated; HTTP bridge authority fix active |
| AI transcript, cancellation/errors, selection/terminal context, project rules | ide_ai_workflows | Context and visible history survive panel/project changes | Integrated; combined UI/runtime pending |
| Approved plans, durable checkpoints and conflict-safe restoration | ide_ai_workflows | User approval authorizes a concrete plan; later user edits are preserved | Per-file recovery integrated; grouped run restore active |
| Semantic codebase search, MCP health/activity, optional bounded completion | ide_ai_workflows | Existing resources provide useful, transparent context; unsupported setup is explicit | Integrated; tool activity follow-up active; real provider pending |
| Inline stale-target protection, language intelligence, formatting/preferences | ide_editor_language | TS/JS project semantics and safe inline edits work with unsaved buffers | Integrated; 29 focused tests pass; combined runtime pending |
| Lua/Luau highlighting; language support boundaries | ide_editor_language | Language detection and editor packs agree; no false semantic capability claims | Integrated; TS/JS semantics only |
| Interactive terminals/profiles/tabs; task streaming/Stop/dev servers | ide_files_safety | User can answer input, run and stop owned processes in the actual project | Active next wave |
| Git diffs/hunk staging/remotes/history/conflict resolution | ide_editor_language | Inspect, stage and synchronize real Git changes through UI | Active next wave |
| Debugging and focused test discovery/run/debug | ide_editor_language | Breakpoints/stepping/results reach real processes and files | Active next wave; Node runtime support |
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

Files core: 8 suites, 79 tests passed. AI core: 4 suites, 26 tests passed; actual HTTP bridge authority remains a separate follow-up. Editor: 3 suites, 29 tests passed including declared dependency types, nested configuration, stale selections and opt-in completion. Combined widget TypeScript passed after common IPC/preload wiring. No build/runtime/CI completion is claimed yet. Receipts are retained in the team worktrees and sibling ide-finish-20261007-proof directory.
