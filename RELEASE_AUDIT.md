# RELEASE_AUDIT.md

Release-control document for SADIE v1.1.0 demo/release preparation.

**Created:** 2026-06-08
**Target:** Demo-ready release within 8 days (by 2026-06-16)
**Branch:** `main`

---

## 1. Release Objective

Deliver a demo-ready, stable build of SADIE (Structured AI Desktop Intelligence Engine) within 8 days.

**Focus areas:** stability, packaging, setup clarity, documentation accuracy, demo reliability.

**Feature freeze is in effect.** No new feature development during this window. All effort goes toward hardening, packaging, testing, and documentation.

---

## 2. Repository Status

| Item | Value |
| --- | --- |
| Branch | `main` |
| Sync with origin | Up to date |
| Working tree | Clean |
| Latest commit | `7283f33` — `chore: ignore local Jest result artifact` |
| Widget version | `1.1.0` (from `widget/package.json`) |
| Root package version | `1.0.4` (`sadie-tool-registry`) |
| Build icon | `build/icon.ico` and `widget/build/icon.ico` present |
| Packaging target | Windows x64 NSIS installer via `electron-builder` |
| Extra branches | 14 feature/CI branches on remote (not merged to main) |

**Generated/ignored artifacts relevant to release:**
- `widget/out/` — electron-vite build output (gitignored)
- `widget/dist-electron/` — electron-builder package output (gitignored via `dist/`)
- `widget/test-results/`, `widget/playwright-report/`, `widget/trace-output/` — test artifacts (gitignored)
- `widget/jest-result.json` — Jest output (gitignored)
- `n8n-data/` — Docker volume data (gitignored)
- `out/` — root build output (gitignored)

---

## 3. Existing Audit Baseline

### From AUDIT_SUMMARY.md

- **Status:** SADIE is described as "100% functionally complete" at v1.1.0 with "full production readiness."
- **Test coverage:** 1,872 unit tests across 120 suites + 12+ E2E Playwright tests. All passing. 62% line coverage.
- **Architecture:** Electron + React + TypeScript. 138 TSX/TS source files. 70+ local TypeScript tools. 14 n8n tool workflows.
- **Safety:** Path whitelisting, blocked extensions, permission gating, confirmation for destructive actions.
- **Telemetry:** Off by default, opt-in only, with consent logging.

### From COPILOT_HANDOFF.md

- **Current slice:** "Codex handoff complete."
- **Open risks:**
  1. MCP server integration — fetch server unreliable due to upstream MCP SDK issue.
  2. Installer/auto-update — packaged-release validation pending before first GitHub Release.
- **Next recommended step:** Verify chat UI model switching works end-to-end.

### From CLAUDE_CODE_NEXT_STEPS.md

- Ollama is online at `http://127.0.0.1:11434` (host process, not Docker container).
- Ollama URL fix committed — dynamic resolution, no more stale module-level constant.
- Model switching support exists (ModelSelector component, local + cloud paths).
- Recommended work: verify model switching, test one cloud provider flow, clarify host vs Docker Ollama.

### Confidence Assessment

- **Confirmed:** Tests pass, build compiles, core chat loop works with Ollama, safety system enforced.
- **Unconfirmed:** Whether `npm run dist` produces a working installer. Whether the packaged app launches on a clean machine. Whether auto-updater is functional. Whether MCP fetch server is stable enough for demo.

---

## 4. Actual Commands

### Root (`package.json` — `sadie-tool-registry`)

| Script | Command | Purpose |
| --- | --- | --- |
| `smoke` | `npx ts-node src/test.ts` | Smoke test for tool registry |
| `test` | `npx jest` | Unit tests for tool registry |

### Widget (`widget/package.json` — `sadie-widget`)

| Script | Command | Purpose |
| --- | --- | --- |
| `start` | `node -e "..."` (launches `electron .`) | Start Electron app |
| `dev` | `node scripts/electron-dev.js` | Dev mode with reload |
| `test` | `jest --config=jest.config.ts --runInBand` | Unit tests |
| `test:smoke` | `jest ... --testPathPattern=permissions-smoke.test.ts` | Permissions smoke test |
| `test:file` | `jest ... --testPathPattern <pattern>` | Run specific test file |
| `build` | `electron-vite build` | Build main/preload/renderer |
| `dist` | `npm run build && electron-builder --config ../electron-builder.yml` | Package NSIS installer |
| `e2e:install` | `playwright install --with-deps` | Install Playwright browsers |
| `e2e` | `cross-env NODE_ENV=test SADIE_E2E=1 playwright test` | Run all E2E tests |
| `e2e:headed` | Same as `e2e` with `--headed` | E2E with visible browser |
| `e2e:live` | `cross-env ... playwright test live-sanity.e2e.spec.ts` | Live sanity E2E only |
| `release` | Preflight check → build → artifact scan → dist → integrity scan | Full release pipeline |
| `clean-tests` | `rmdir /s /q test-results ...` | Clean test artifacts |
| `capture-logs` | `node ./scripts/capture-diagnostics.js` | Capture diagnostic logs |
| `stream-metrics` | `node ./scripts/stream-metrics.js` | Stream performance metrics |

**Note:** There is no standalone `lint` or `typecheck` script. Type checking is handled implicitly by `electron-vite build` (TypeScript compilation). Linting is not configured as a package script.

---

## 5. Key App Areas

### Electron Main Process
- `widget/src/main/index.ts` — App entry point
- `widget/src/main/window-manager.ts` — Window lifecycle
- `widget/src/main/ipc-handlers.ts` — IPC channel registration
- `widget/src/main/config-manager.ts` — Persistent config (userData)
- `widget/src/main/auto-updater.ts` — Electron auto-update
- `widget/src/main/env.ts` — Environment variables
- `widget/src/main/permission-requester.ts` — Permission gating

### Preload Bridge
- `widget/src/preload/index.ts` — Context bridge API
- `widget/src/preload/index.d.ts` — Type declarations
- `widget/src/preload/webview.ts` — Webview preload

### React Renderer
- `widget/src/renderer/index.tsx` — React root
- `widget/src/renderer/App.tsx` — App shell
- `widget/src/renderer/components/` — 28 UI components including:
  - `ChatInterface.tsx`, `MessageBubble.tsx`, `MessageList.tsx`, `InputBox.tsx`
  - `ModelSelector.tsx`, `SettingsPanel.tsx`, `SettingsModal.tsx`
  - `FirstRunModal.tsx`, `TelemetryConsentModal.tsx`
  - `RagPanel.tsx`, `ToolsPanel.tsx`, `DocumentViewer.tsx`

### Tool Registry
- `widget/src/main/tools/index.ts` — Tool registration and dispatch
- `widget/src/main/tools/types.ts` — Tool type definitions
- `widget/src/main/tool-helpers.ts` — Extraction/routing helpers
- 28 tool files in `widget/src/main/tools/` (filesystem, web, nba, vision, voice, rag, calendar, email, etc.)

### Local Ollama / Model Routing
- `widget/src/main/message-router.ts` — Central message routing (Ollama, cloud, n8n)
- `widget/src/main/stream-proxy-client.ts` — Streaming proxy for Ollama
- `config/ollama-models.json` — Model metadata

### Cloud Provider Routing
- `widget/src/main/custom-llm-client.ts` — Cloud LLM client (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google, HuggingFace, Cerebras, SambaNova, Together, custom)
- `config/api-allowlist.json` — Allowed API endpoints

### RAG / Document Indexing
- `widget/src/main/tools/rag.ts` — RAG tool implementation
- `widget/src/main/tools/documents.ts` — Document parsing (PDF, DOCX, XLSX)
- `widget/src/renderer/components/RagPanel.tsx` — RAG UI

### Vision / OCR
- `widget/src/main/tools/vision.ts` — Vision tool (LLaVA via Ollama)
- `schemas/vision-request-schema.json` — Vision request schema

### Web Search
- `widget/src/main/tools/web.ts` — Web search (6 providers), URL fetch, weather
- `widget/src/main/web-services.ts` — Web service utilities

### NBA / Live Data
- `widget/src/main/tools/nba.ts` — NBA scores, schedules, standings
- `widget/src/main/tools/news.ts` — News aggregation
- `widget/src/shared/daily-content.ts` — Daily content feed

### Voice / TTS
- `widget/src/main/tools/voice.ts` — Voice tool definitions
- `widget/src/main/speech/offline-recognition.ts` — Whisper-based recognition
- Dependency: `msedge-tts` for text-to-speech, `whisper-node` for STT

### Scheduler / Reminders
- `widget/src/main/scheduler.ts` — Task scheduler
- `widget/src/main/tools/reminder.ts` — Reminder tool
- `widget/src/main/tools/calendar.ts` — Calendar tool
- `widget/src/main/morning-briefing.ts` — Proactive morning briefing

### Agentic Loop / MoA
- `widget/src/main/agentic-loop.ts` — Multi-step agentic execution
- `widget/src/main/moa.ts` — Mixture of Agents
- `widget/src/main/skills-loader.ts` — Skills system

### MCP Integration
- `widget/src/main/mcp-client.ts` — MCP client
- `config/mcp-servers.json` — MCP server configuration

### n8n Integration
- `widget/src/main/n8n-lifecycle.ts` — n8n start/stop lifecycle
- `n8n-workflows/core/` — Main orchestrator, safety webhook
- `n8n-workflows/tools/` — 7 tool workflows (archive-ops, browser-automation, file-manager, etc.)
- `config/n8n-endpoints.json` — n8n endpoint configuration

### Memory
- `widget/src/main/memory-manager.ts` — Conversation memory persistence
- `widget/src/main/tools/memory.ts` — Memory tools

### Tests
- `widget/src/main/__tests__/` — 76 unit test files (main process)
- `widget/src/renderer/__tests__/` — 43 unit test files (renderer)
- `widget/src/renderer/e2e/` — 11 E2E spec files + helpers
- `widget/src/__tests__/` — Shared tests
- `widget/jest.config.ts` — Jest configuration
- `widget/playwright.config.ts` — Playwright configuration

### Packaging / Build Config
- `electron-builder.yml` — Electron Builder config (NSIS, Windows x64)
- `electron.vite.config.ts` — Root Vite config
- `widget/electron.vite.config.ts` — Widget Vite config
- `widget/package.json` `build` section — Inline electron-builder config
- `build/icon.ico` — Application icon

### Documentation
- `docs/api-reference.md` — 818-line IPC/tool/permission reference
- `docs/architecture.md` — System architecture
- `docs/setup-guide.md` — Setup instructions
- `docs/permissions.md` — Permission model
- `docs/custom-llm-api.md` — Cloud LLM configuration
- `docs/n8n-integration.md` — n8n workflow integration
- `docs/powershell-scripts.md` — PowerShell tool docs
- `DEMO_SCRIPT.md` — Demo walkthrough script
- `DEVELOPER_BUILD_GUIDE.md` — Developer build guide
- `RELEASE_PROCESS.md` — Release process documentation

---

## 6. Release Blockers

**Confirmed blockers that must be resolved before demo:**

| # | Blocker | Source | Severity |
| --- | --- | --- | --- |
| 1 | **Packaging not validated.** `npm run dist` has not been confirmed to produce a working NSIS installer that launches on a clean-ish Windows machine. | COPILOT_HANDOFF.md, AUDIT_SUMMARY.md | Critical |
| 2 | **No lint or typecheck script.** There is no standalone `lint` or `typecheck` command. Type errors may be latent and only surface at build time. | package.json inspection | Medium |
| 3 | **Auto-updater unvalidated.** `electron-updater` is a dependency and `auto-updater.ts` exists, but no GitHub Release has been published to test against. | COPILOT_HANDOFF.md | Medium (can be deferred — not needed for demo if distributing manually) |

---

## 7. Non-Blocking Risks

| # | Risk | Notes |
| --- | --- | --- |
| 1 | **MCP fetch server instability.** Upstream `@modelcontextprotocol/sdk` issue causes unreliable fetch server. | Documented in COPILOT_HANDOFF.md. MCP-dependent features may fail intermittently. Workaround: avoid MCP-dependent demo paths. |
| 2 | **Ollama host vs Docker ambiguity.** Ollama runs as a host process, but `docker-compose.yml` defines an `ollama` service. Documentation references both. | Risk of confusion during setup on another machine. Clarify in demo script. |
| 3 | **Dependency deprecation warnings.** Node 24.x may emit deprecation warnings for some packages (e.g., older `punycode` usage). | Cosmetic; no functional impact. |
| 4 | **Test environment mocking.** E2E tests use `SADIE_E2E=1` mock mode; `live-sanity.e2e.spec.ts` is the only test that hits real services. | Test pass rate is valid for mocked paths; real-service paths need manual verification. |
| 5 | **MCP config parse warnings.** `mcp-servers.json` may log warnings if MCP servers are unreachable at startup. | Non-fatal; app continues without MCP. |
| 6 | **Optional service availability.** n8n, Qdrant, Docker services are optional but referenced in config/docs. | Demo should work without them (Ollama-only path), but docs should clarify what's required vs optional. |
| 7 | **Documentation drift.** AUDIT_SUMMARY.md, PROGRESS_REPORT.md, and other docs reference specific test counts and version numbers that may drift. | Sync during Day 6. |
| 8 | **14 unmerged remote branches.** Feature and CI branches remain on origin. | No impact on main, but clutters the remote. Consider cleanup post-release. |
| 9 | **No standalone lint configuration.** No ESLint config or lint script. Code style is enforced only by convention. | Low risk for demo; address post-release. |
| 10 | **`predist` depends on PowerShell icon generation.** `scripts/generate-icon.ps1` runs before `dist`. If it fails (e.g., missing ImageMagick), the build may break. | Verify icon generation works or ensure `build/icon.ico` is already correct. |

---

## 8. 8-Day Release Plan

### Day 1 (2026-06-08) — Release Audit
- [x] Create this document (RELEASE_AUDIT.md)
- [ ] Confirm feature freeze with all contributors
- [ ] Review DEMO_SCRIPT.md for accuracy against current app state

### Day 2 (2026-06-09) — Environment Validation
- [ ] Run `npm run test` in root (tool registry tests)
- [ ] Run `npm run test` in `widget/` (full unit suite — expect 1,872+ tests)
- [ ] Run `npm run e2e` in `widget/` (Playwright E2E — expect 12+ tests)
- [ ] Run `npm run build` in `widget/` (electron-vite build)
- [ ] Verify Ollama is reachable: `Invoke-RestMethod http://127.0.0.1:11434/api/tags`
- [ ] Launch app with `npm run dev` in `widget/`, send a test message, confirm response streams
- [ ] Document any test failures or warnings

### Day 3 (2026-06-10) — Packaging
- [ ] Run `npm run dist` in `widget/` — confirm NSIS installer is produced in `widget/dist-electron/`
- [ ] Install the produced `.exe` on the same machine (or a clean profile)
- [ ] Launch the installed app — confirm it reaches the chat UI
- [ ] Verify `build/icon.ico` appears correctly in taskbar/start menu
- [ ] Document installer size, install path, any signing warnings
- [ ] If `predist` icon generation fails, confirm existing `build/icon.ico` is sufficient

### Day 4 (2026-06-11) — Demo Script
- [ ] Walk through DEMO_SCRIPT.md end to end in the packaged app
- [ ] Test demo paths: chat, model switching, web search, file operations, NBA scores
- [ ] Test graceful degradation: Ollama not running, invalid API key, no internet
- [ ] Update DEMO_SCRIPT.md with any corrections
- [ ] Record timing for each demo section

### Day 5 (2026-06-12) — UI / Error Polish
- [ ] Fix any UI issues found during Day 4 demo walkthrough
- [ ] Ensure error states show user-friendly messages (not stack traces)
- [ ] Verify first-run onboarding flow in packaged app
- [ ] Test settings panel: permissions, telemetry toggle, model selection
- [ ] Confirm no console errors in DevTools during normal usage

### Day 6 (2026-06-13) — Documentation Sync
- [ ] Update README.md with current setup instructions for release
- [ ] Verify docs/setup-guide.md matches actual install/run steps
- [ ] Sync test counts and version numbers in AUDIT_SUMMARY.md if needed
- [ ] Ensure DEVELOPER_BUILD_GUIDE.md reflects current build process
- [ ] Review RELEASE_PROCESS.md and confirm it matches actual `dist` flow
- [ ] Add "Known Limitations" section to README if not present

### Day 7 (2026-06-14) — Release Candidate
- [ ] Final `npm run test` + `npm run e2e` pass
- [ ] Final `npm run dist` — produce RC installer
- [ ] Smoke test RC installer: install → launch → chat → tool call → close
- [ ] Tag commit as `v1.1.0-rc1` (do not push tag until Day 8 go/no-go)
- [ ] Update RELEASE_AUDIT.md with RC results

### Day 8 (2026-06-16) — Demo Rehearsal / Freeze
- [ ] Full demo rehearsal with RC build
- [ ] Go/no-go decision (see criteria below)
- [ ] If go: push tag, create GitHub Release with RC installer attached
- [ ] If no-go: document blockers, extend timeline
- [ ] Final RELEASE_AUDIT.md update with outcome

---

## 9. Go / No-Go Criteria

All of the following must be true before the demo is approved:

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Repository is clean (`git status` shows no uncommitted changes) | Pending |
| 2 | All unit tests pass (`npm run test` in root and widget) | Pending |
| 3 | All E2E tests pass (`npm run e2e` in widget) | Pending |
| 4 | Build succeeds (`npm run build` in widget) | Pending |
| 5 | Packaged NSIS installer is produced (`npm run dist` in widget) | Pending |
| 6 | Installed app launches to chat UI on Windows | Pending |
| 7 | Chat message with local Ollama model returns a streamed response | Pending |
| 8 | App handles Ollama-not-running gracefully (no crash, shows error message) | Pending |
| 9 | App handles missing/unavailable model gracefully | Pending |
| 10 | Demo script has been rehearsed end to end at least once | Pending |
| 11 | Known limitations are documented in README or DEMO_SCRIPT.md | Pending |
| 12 | RELEASE_AUDIT.md is updated with final results | Pending |

**Auto-updater is explicitly deferred** — not required for demo. Manual distribution of the installer is acceptable.

---

## Appendix: Files Inspected During Audit

- `package.json` (root)
- `widget/package.json`
- `electron-builder.yml`
- `.gitignore`
- `AUDIT_SUMMARY.md`
- `COPILOT_HANDOFF.md`
- `CLAUDE_CODE_NEXT_STEPS.md`
- `widget/src/main/` (full directory listing)
- `widget/src/renderer/` (full directory listing)
- `widget/src/preload/` (full directory listing)
- `widget/src/main/tools/` (28 tool files)
- `widget/src/renderer/components/` (28 component files)
- `widget/src/main/__tests__/` (76 test files)
- `widget/src/renderer/__tests__/` (43 test files)
- `widget/src/renderer/e2e/` (11 E2E specs)
- `config/` (7 config files)
- `schemas/` (4 schema files)
- `n8n-workflows/` (core + tools subdirectories)
- `scripts/` (setup, tools, utility scripts)
- `docs/` (10 documentation files)
- `build/icon.ico`
