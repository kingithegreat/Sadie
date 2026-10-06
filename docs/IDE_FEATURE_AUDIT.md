# HomeBot IDE feature audit

Audited 7 October 2026 (NZ), against main `79ffc3866d27530e2243706ea4d2790366832754` and the separate compiled app at `C:/Users/adenk/.homebot/cleanup-build-20261007/app`.

**Verdict: useful code workspace, not a feature-complete everyday IDE.** Basic editing, search, local Git operations, package tasks and AI review are present. File safety and project context need attention before adding more AI capability. This audit does not claim that every possible developer preference must become a feature.

Scope: the human-accessible Code mode, its IPC/preload/backend paths, the canonical Drive plan and current IDE roadmap. The comparison baseline is common editing, project, terminal, Git, debugging and AI workflows described by [VS Code](https://code.visualstudio.com/docs/editing/getting-started/overview), [its language services](https://code.visualstudio.com/docs/editing/intellisense), [terminal documentation](https://code.visualstudio.com/docs/terminal/basics) and [Cursor Agent](https://cursor.com/docs/agent/overview). Priorities below are recommendations for HomeBot, not assertions that it must clone either product.

## Evidence and limits

- A fresh isolated Electron profile exercised the actual compiled app. Nine recorded observations completed; native closure and exit code 0 were retained. The screenshot was inspected.
- Reproduced in the app: hidden project files, inability to create a file through Save, external edits overwritten by Ctrl+S, loss of visible assistant history on closing/reopening, missing selection/terminal context choices, and inability to type input into a running terminal command. Owned terminal Stop worked.
- The review-root finding also uses the real `shouldReviewEdit` implementation with a stubbed settings adapter and a positive control. It does not claim a real model executed an unreviewed edit during this audit.
- AI streaming used the existing deterministic E2E mock. Real model quality, latency, cloud/local parity, MCP server execution, accessibility with assistive technology and all three supported operating systems were not certified here.
- A planned run of 16 existing focused suites was refused before launch: free RAM 1.689 GiB, below the standing 2 GiB guard. No new suite pass is claimed. Earlier green CI and earlier Code acceptance are historical evidence, not replacements for this missing run.
- Initial harness failures are retained: an unscoped Send locator matched both chat and IDE controls. The corrected run scoped the assistant control. Those failures are not product bugs.
- No product source or delivered build was modified. No model, extension or provider download was performed.

Local evidence directory: `C:/Users/adenk/.homebot/ide-audit-20261007`.
Successful run: `runtime-1791316910698/proof.json`, `workspace.png` and `audit-runtime.cjs`.
Resource refusal: `focused-1791316998910.json` and corresponding log.

Statuses in the inventory: **Present** means a reachable implementation was traced; it does not automatically mean it was runtime-tested today. **Partial** identifies a specific limitation. **Missing** means no implementation or user route was found in the inspected Code surface. **Unverified** is used for behavior requiring additional execution.

## Confirmed defects, ranked by user cost

| Priority / ID | User-visible problem | Evidence | Acceptance criterion for a fix |
|---|---|---|---|
| P0 SAFE-1 | Save can silently erase a newer edit made by another program. | Actual editor: open file, edit buffer, externally change disk, Ctrl+S; disk became the old buffer with no conflict prompt. `workspace-ipc.ts` SAVE writes without an expected version. | Save compares the version read with the current disk version. A conflict preserves both versions and offers explicit reload/compare/overwrite; ordinary save acknowledgement still preserves typing during a pending save. |
| P0 SAFE-2 | The displayed project is not the authoritative AI review scope. A handoff can display project B while settings still identify A; edits to B then miss the proposal gate. Without a configured project, review is disabled. | `WorkspaceShell` keeps its own root; assistant requests do not carry structured root authority. `workspace-proposals.ts:77–92` reads settings only. Real predicate probe: configured A reviewed=true; displayed B reviewed=false. | Validate and bind workspace context per request/session in main. Editing the displayed project must always create a proposal. Chat/project switches and two concurrent streams must not retarget one another. Context text alone is insufficient. |
| P1 AI-1 | Closing/reopening the assistant makes its visible transcript disappear. | Actual streamed conversation disappeared on reopening; panel owns local `turns` and is unmounted on close. Backend history may still exist, which makes an empty UI particularly misleading. | Reopening shows the same transcript; switching projects isolates histories; restart behavior is explicit. Streams must finish or cancel consistently with their visible state. |
| P1 FILE-1 | Important project files cannot be discovered in Explorer. | Actual listing showed only `.env` and `app.ts`, omitting existing `.gitignore`, `.env.example` and `.github`. `workspace-ipc.ts:199` hides all dot names except `.env`. | A reachable hidden-files control exposes configuration files/directories, with expensive/dependency directories still excluded or separately controlled. |
| P1 SYNC-1 | Open buffers are not reconciled after AI Apply, search replacement or branch switching. | Source-confirmed: `openFile` focuses an already-open tab without reloading; Changes Apply calls that path. Replace and checkout mutate disk without a buffer reconciliation path. No watcher/version model found. Not reproduced as a separate native scenario in this audit. | Clean buffers refresh after external operations; dirty buffers never silently clobber either version. The editor, search results, SCM and accepted AI changes agree on current bytes. |
| P1 AI-2 | Inline AI acceptance uses old numeric selection offsets while the document remains editable. | Source-confirmed: `CodeEditor.tsx` captures `{from,to,text}` and later dispatches those unchanged offsets. No intervening-edit check or position mapping. Native stale-selection reproduction remains pending. | Moving/replacing the target during generation either remaps a still-valid target or rejects a stale result; never replaces unrelated code. Undo remains one coherent action. |

An additional native screenshot shows the initial terminal cwd at the isolated home while Explorer is at its `project` child. Source explains the timing risk: Terminal creates a session before the asynchronous root is ready and then keeps it. A subsequent targeted rerun was resource-refused. Track **P1 TERM-1** for a regression test and fix: the first terminal must start in the displayed project, and a user-entered `cd` must survive unrelated renders. This observation is narrower than a complete terminal-root reproduction.

## Feature inventory

| Workflow / expected capability | Status | What a user can do, or what remains |
|---|---|---|
| Discover/open Code mode and return to HomeBot | Present | Mode/dashboard routes and visible Back; dirty state survives leaving the view. |
| Browse folders and open existing text files | Present | Lazy Explorer; editor refuses binary/over-2-MiB files. |
| Open/change a project from within IDE; recent projects | Missing | Settings/handoffs can supply a root, but no IDE folder picker/recent-project control. |
| Create files/folders; Save As | Missing | Save explicitly requires an existing file. No Explorer creation controls. |
| Rename/move/delete/copy paths/reveal in OS Explorer | Missing | No human file-management actions in FileTree. Tools/terminal are different interfaces. |
| Show hidden configuration and refresh changed trees | Partial | Dot files mostly hidden; loaded children cached; no tree refresh/watch path. |
| Project outside the home directory | Partial | Existing sandbox rejects other drives/paths; requires a deliberate trusted-folder design to expand. |
| Multi-root workspace | Missing | One root; not essential for the first dependable release. |
| Editable tabs and dirty-tab close confirmation | Present | Confirm before discarding a tab; Ctrl+S save. |
| Reopen tabs/dirty recovery after crash or restart | Missing | Buffers and editor sessions are in-memory, without durable recovery. Leaving the view is not restart recovery. |
| Conflict detection and synchronized open buffers | Missing | SAFE-1 and SYNC-1. |
| Encoding/BOM/EOL controls and atomic durable saves | Partial | UTF-8 read/write only; no explicit controls, version guard or atomic-save implementation. Preserve existing bytes where possible. |
| Syntax highlighting | Partial | JS/TS/JSX/TSX, Python, JSON, CSS, HTML, Markdown, SQL, YAML, Rust, Java, Go, shell, PowerShell, INI, C#. Some returned language IDs have no editor pack; Lua/Luau maps to plaintext. |
| Folding, brackets, multiple cursors, undo/redo | Present | CodeMirror basicSetup and keymaps. |
| Find/replace in current file | Present | CodeMirror Ctrl+F/search replacement. |
| Project search/replace with preview and stale-line checks | Present | Ctrl+Shift+F, regex/case/filter controls, preview and guarded line replacement. Dirty-buffer reconciliation still missing. |
| Quick Open, command palette, symbol navigation | Missing | No Ctrl+P/Ctrl+Shift+P route or project-symbol surface found. |
| Split editors, breadcrumbs and adjustable panel layout | Missing | Single editor, fixed workspace panel structure; not needed to solve file safety first. |
| Semantic autocomplete, hover, signatures, definitions, references | Missing | Document completions exist; no language-service/LSP integration. Syntax coloring is not semantic IntelliSense. |
| Rename-symbol refactoring and quick fixes | Missing | No language-aware refactoring path. |
| Format document/on-save; configurable indentation | Partial | Basic indentation and fixed tab size 2; no formatter/settings surface. |
| Streaming terminal output/history/Stop/ANSI display | Present | Real command execution, cwd `cd` support, Ctrl+C/Stop and capped output. Root timing caveat TERM-1. |
| Interactive terminal stdin/PTY, shell profiles, multiple terminals | Missing | One child per command; UI input disabled while it runs. REPLs, interactive CLIs and prompt responses do not work. Windows shell is cmd. |
| Send terminal output to AI inside the IDE | Missing | TerminalPanel supports a Send-to-chat callback elsewhere, but WorkspaceShell supplies no callback. No @terminal attachment. |
| List and run package.json tasks | Present | IDE-11 is already implemented; confirmation shows npm lifecycle commands. |
| Click diagnostics to file/line | Present | TS/ESLint task-output diagnostics route into the editor. |
| Live task output, user Stop, long-running dev servers | Partial | Task results returned after completion; no Stop control in Problems; hard maximum 120 seconds. Abort-on-window-close exists. |
| Integrated debugger/breakpoints/stepping/watch/call stack | Missing | Tasks and terminal execution are not a debugger. |
| Test discovery, run/debug one test, coverage UI | Missing | Tests can be invoked as commands/tasks, without dedicated discovery. |
| Docked browser for preview | Present | Real browser panel, address/back/forward/reload; actual navigation not exercised in this audit. |
| Git status/stage/unstage/commit/switch existing branch | Present | Human SCM controls and real git argument-array implementation. |
| View ordinary Git diffs/stage individual hunks | Missing | SCM rows open files. AI Changes diffs do not represent arbitrary Git changes. |
| Clone/init/fetch/pull/push/create branch/history/blame/stash | Missing in SCM UI | Some operations can be done through tools or terminal; no native SCM controls. |
| Resolve merge conflicts with ours/theirs/base comparison | Missing | Conflicted status letter exists; no merge editor. |
| Docked AI chat with open unsaved file context | Present | Real chat IPC; attachments use current buffers; shares app model/provider settings. |
| @file/@folder/@selection/@terminal/@codebase | Partial | Only open-file attachments and root folder name listing. No selection, terminal or semantic codebase attachment. |
| Repository instruction/rules files | Missing | No Code loader for AGENTS.md/CLAUDE.md/.cursor/rules/.cursorrules. General HomeBot skills are a separate mechanism. |
| AI inline edit with preview/accept/reject/undo | Partial | Ctrl+K implemented; AI-2 needs stale-target protection. No real provider quality proof here. |
| Multi-file agent review before write, per-hunk selection | Partial | Changes proposal gate exists for write_file/edit_file inside configured root. SAFE-2 scope defect; append is explicitly excluded, and terminal/CLI writes are not universally mediated by this gate. |
| Persistent checkpoints and safe rollback of agent edits | Missing | IDE-4 remains open; change log/proposals are in-memory. Never implement blind folder-wide restore. |
| Approve a plan before agent execution | Missing | IDE-12 remains open. Per-tool permissions/review are not an approved plan workflow. |
| AI Tab/ghost-text completion | Missing | IDE-6 still requires model/capacity evaluation; do not add a large background model to this PC. |
| Local semantic indexing with save/delete freshness | Missing | IDE-7 open; existing document RAG is not a codebase index. |
| MCP tools and IDE activity visibility | Partial / Unverified | Shared router/tool registry supports MCP; shell exposes transient tool activity and existing permission modals. Dedicated server health/activity timeline and actual IDE MCP execution were not demonstrated. Do not report all MCP plumbing absent. |
| AI session history, cancellation/error recovery and project separation | Partial | Conversation IDs include root; visible transcript disappears on close; request rejection handling and stream lifecycle deserve tests. |
| Theme, font/keybindings and screen-reader/keyboard access | Partial / Unverified | App theme and labels exist. Tree offers Enter/Space, not full tree arrow-key navigation; configurable editor keys/font and dedicated accessibility verification missing. |
| Offline/privacy, folder trust and resource-aware operation | Partial / Unverified | Existing home sandbox, provider/privacy gates and task consent are shared; full adversarial workspace/online-off audit not performed. Make index/model costs visible. |
| Extensions, remote SSH/WSL/containers, collaboration/notebooks | Missing; optional | Explicitly later requirements, not prerequisites for a sound local IDE. |

## Checked and NOT defects

1. Code mode has a real front door. The earlier missing-Code-mode incident no longer describes current main.
2. The editor is CodeMirror, not just a textarea: search/replace, multiple cursors, folding, brackets and undo are implemented.
3. IDE-11 is already landed (#416). The stale local-pending line in USER_TESTING_PLAN is not authority for another implementation PR.
4. Source control is reachable. Its limited scope is the finding; the whole feature is not dead.
5. Changes holds configured-root proposals before write and guards changed disk contents on apply. It is not only an after-the-fact receipt. The root mismatch and bypass cases are distinct limitations.
6. Save acknowledgement preserves newer typing during a pending save (#458). SAFE-1 concerns another writer changing disk, a different case.
7. Leaving Code for HomeBot preserves dirty buffers and editor state within the process. Missing restart recovery must not be described as loss on ordinary Back navigation.
8. MCP is present in the shared tool path; absence of a dedicated IDE server panel is not absence of its entire backend.

## Known and deliberately not implemented during this audit

This is an evidence/report change. It does not silently turn the audit into a new language-server, native terminal or model-installation project. Prior plan deferral of Code expansion is superseded for this requested audit; individual feature implementations still need their own validated changes. Owner-sensitive IDE-4 restore/history design and the 4-GB-VRAM completion model remain explicit design/capacity choices. Held PRs and unrelated media/voice work are preserved.

Recommended implementation sequence (each item is independently reviewed and verified):

1. **File safety and authoritative project context:** SAFE-1, SAFE-2, SYNC-1 and AI-2. Demonstrate conflict preservation, review inside a handoff project and stale inline rejection with actual final bytes.
2. **Usable project/file workflow:** folder picker/recent roots, create/rename/delete with dirty safeguards, hidden-file controls, tree refresh, terminal initial cwd and durable dirty recovery.
3. **Daily coding support:** Quick Open/command palette, formatter, JS/TS language service first, Python and Lua/Luau as needed; definitions/references/refactorings and live diagnostics. Bound resource use.
4. **Run and ship:** real interactive terminal with explicit native packaging proof, task streaming/Stop, Git diffs/hunk stage/sync/history/conflicts; debugger and focused test discovery.
5. **Complete AI workflow:** visible session history, selection/terminal context, project rules, local codebase search, approved Plan, safe checkpoints/restore, MCP health/activity and then optional Tab completion.

The first next work item should be **SAFE-1: conflict-safe Save**. It prevents demonstrated data loss, has a bounded implementation, and does not need another model or service.

## Release acceptance

A dependable IDE release should demonstrate a fresh-profile flow: choose a project, create/rename/open files including configuration, edit/search/format, preserve external edits and unsaved buffers, run and stop a task/interactive command, open diagnostics, review/stage/commit a diff, ask AI with project/selection/terminal context, accept only the intended hunks, recover/restore safely, and reopen after restart without losing drafts. Run offline/privacy and keyboard checks, then repeat the applicable acceptance on the actual packaged Windows app. A green unit suite alone does not establish these outcomes.
