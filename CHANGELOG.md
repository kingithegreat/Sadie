# Changelog

## Unreleased — Automation from chat + monetization + audit hardening

### Added
- **Offline Pro licensing** (`src/licensing/signedLicense.ts`, `signingKey.ts`, `scripts/licensing/*`): sell Pro with no third-party account or server. The vendor mints Ed25519-signed license keys per sale; the app verifies them offline against an embedded public key. Customers paste a key into Settings → HomeBot Pro to unlock. See `docs/SELLING_AND_LICENSING.md`.
- **Pro gate enforced end-to-end**: the Automation Center CRUD IPC channels (`homebot:create/update/run-automation`) and the chat automation tools are now fenced at the handler layer; Free users get a clear in-app upgrade prompt instead of silently using a paid feature.
- **Chat-driven automations** (`tools/automation.ts`): the assistant can now create, list, run, update, and delete Automation Center automations directly from chat (`create_automation` with `run_now` to create and fire in one step), backed by the same store and execution engine as the UI.

### Fixed
- **Scheduled automations never fired** (`ipc-handlers.ts`): the 60s resync destroyed and recreated every timer before it could elapse; timers are now diffed by signature so a running schedule survives resyncs.
- **Automations JSON corruption/races** (`ipc-handlers.ts`, `tools/automation.ts`): writes are now atomic (temp file + rename) and a corrupt store is backed up rather than silently discarded.
- **Automation run status** (`ipc-handlers.ts`): success/failure is tracked explicitly instead of sniffing for an `Error:` prefix, and `lastStatus` is persisted.

### Security
- **License cache tamper-resistance** (`licensing.ts`): the cached entitlement is HMAC-signed and bound to a machine fingerprint; hand-edited/unsigned or copied caches resolve to Free.
- **Document read path traversal** (`ipc-handlers.ts`): `parse-document` is now confined to the home directory like `write-document`.
- **n8n SSRF guard** (`n8n-api.ts`): the web-fetch workflow validates the target URL and blocks loopback/private/link-local hosts before fetching.
- **Local service exposure** (`docker-compose.yml`): n8n/Qdrant/Ollama ports bind to `127.0.0.1`, and the shared hardcoded n8n encryption key default was removed.

## 1.1.0 — Full codebase sweep, credential management, dolphin-mistral, docs refresh

### Added
- **Document Viewer RAG and Chat integration** (`DocumentViewer.tsx`, `App.tsx`): "Add to RAG" button indexes the open document for semantic search; "Send to Chat" button switches to chat mode with the document attached as context for immediate Q&A.
- **n8n credential management** (`AutomationCenter.tsx`): "Credentials" and "n8n Dashboard" buttons open the n8n credential manager and workflow editor in the system browser via `openExternalUrl` IPC bridge.
- **`homebot:open-external-url` IPC channel** (`ipc-handlers.ts`, `preload/index.ts`, `types.ts`): protocol-validated (http/https) external URL opener exposed through the preload bridge.

### Fixed — Full Codebase Sweep (32 issues across 20 files)
- **CSS light theme** (`chatgpt-theme.css`): fixed dangling selector, double `.widget-mode` nesting, undefined CSS variables, gold-to-blue accent migration, dead pseudo-element selectors, duplicate keyframes, and vendor prefix ordering.
- **Stale keyboard handler** (`App.tsx`): `Ctrl+N` new conversation used stale closure; fixed with ref pattern.
- **Ollama toast accumulation** (`App.tsx`): repeated online/offline toggles stacked unlimited toasts; now tracks and dismisses the previous toast.
- **Model selector dropdown** (`ModelSelector.tsx`): portal click-outside detection used the wrong ref, causing immediate close on open.
- **Garbled emoji** (`SettingsPanel.tsx`): `🔑 LLM API Keys` rendered as `�`; fixed with Unicode escape.
- **Settings API URL overwrite** (`SettingsPanel.tsx`): `buildLocalSettings` overwrote custom API URLs with provider defaults.
- **Reaction picker leak** (`MessageBubble.tsx`): no click-outside handler; picker stayed open.
- **ARIA role mismatch** (`MessageBubble.tsx`): `listbox`/`option` → `menu`/`menuitem` for reaction picker.
- **TTS error swallowed** (`MessageBubble.tsx`): unhandled rejection on TTS failure; added `.catch()`.
- **Quiz "about undefined"** (`QuizPanel.tsx`): missing topic fallback in quiz header.
- **Invalid HTML nesting** (`ImageGenerator.tsx`): `<a><button>` → styled `<a>` for download link.
- **Toast double-dismiss** (`ToastContainer.tsx`): close button click propagated to container `onClick`.
- **Voice auto-send stale** (`InputBox.tsx`): `voiceAutoSend` not in `startListening` deps.
- **Voice panel restart** (`VoiceConversation.tsx`): continuous mode restarted after panel was closed.
- **Preload listener leak** (`preload/index.ts`): `onPermissionRequest` cleanup didn't remove debug listener.
- **openUrl false success** (`tools/system.ts`): `Promise.allSettled` swallowed `shell.openExternal` rejections.
- **Hardcoded Ollama URL** (`ipc-handlers.ts`): quiz generation used `localhost` instead of configured URL (2 instances).
- **Scheduler interval leak** (`ipc-handlers.ts`): outer interval not stored for cleanup; added `app.on('before-quit')` cleanup.
- **50 MB document parse limit** (`ipc-handlers.ts`): added file size guard to `homebot:parse-document`.
- **Conversation digest unbounded** (`message-router.ts`): rolling digest capped at 4000 chars with smart truncation.
- **PowerShell injection** (`tools/contacts.ts`): contact search queries now strip shell metacharacters.
- **Vision file size DoS** (`tools/vision.ts`): added 20 MB file size check before `readFileSync`.
- **HTTP redirect loop** (`tools/web.ts`): redirect chain capped at 5 hops.
- **NBA timeout hang** (`tools/nba.ts`): added 15 s timeout to `httpsGet` requests.
- **StatusIndicator sync** (`StatusIndicator.tsx`): listens for `homebot:uncensored-mode-changed` custom event.

### Changed
- **Default uncensored model** (`config-manager.ts`): changed from `qwen2.5:7b` to `dolphin-mistral:7b` across all hardware profiles — a genuinely uncensored Mistral 7B fine-tune with alignment removal.

### Tests
- All 120 test suites / 1,883 tests pass.
- Updated `config-manager.test.ts` assertions for `dolphin-mistral:7b`.

### Documentation
- Updated README, architecture, setup guide, API reference, and changelog to reflect credential management, dolphin-mistral default, image generation backends, and security additions.

---

## Previous Unreleased — n8n automation deployment, quiz fix, fresh-chat UX

### Added
- **n8n workflow deployment from Automation Center** (`n8n-api.ts`, `ipc-handlers.ts`, `AutomationCenter.tsx`): automations can now be deployed as n8n workflows directly from HomeBot — generates webhook-triggered workflows, imports them via Docker CLI, activates them in SQLite, and restarts the container. No n8n UI interaction required.
- **"Deploy to n8n" toggle** in the Automation Center create form with auto-generated webhook URLs and an "n8n" badge on deployed automations.
- **Agentic tool-calling loop for automations** (`ipc-handlers.ts`): automations without an n8n webhook now execute via a local multi-round Ollama tool-calling loop (max 6 rounds) instead of routing through the old message-router path.
- **Fresh chat on startup** (`App.tsx`): HomeBot always opens a new conversation on launch; chat history remains accessible via the sidebar.

### Fixed
- **Quiz score double-counting** (`QuizPanel.tsx`): `handleNext` no longer re-adds the current answer's score on top of the already-updated `totalCorrect`, which inflated scores by up to 2x.
- **Automation Center raw JSON output**: automations no longer return raw JSON from compound pseudo-tools; the new agentic loop produces formatted markdown responses.

---

## Previous Unreleased — Document-aware routing, launch hardening, and test/doc alignment

### Fixed
- **Ollama IPv6 resolution failure** (`ipc-handlers.ts`, `moa.ts`): changed hardcoded `localhost` references to `127.0.0.1` to prevent Node.js 18+ from attempting to connect to Ollama over IPv6 (`::1`), which caused false-offline errors.
- **Hallucinated document intents** (`message-router.ts`): intent regex checks now strip embedded `=== document: ... ===` content before evaluating the user message, preventing the LLM from falsely triggering tools (like `get_weather` or file writing) based on the uploaded document's text.
- **Document forwarding on non-stream requests** (`message-router.ts`, `n8n.integration.test.ts`): requests with `documents[]` are now expanded before routing and before forwarding to n8n, so upstream logic receives extracted document context instead of only `[Document attached: ...]` markers.
- **Document retry safety** (`App.tsx`, `MessageBubble.tsx`, `retry-flow.test.tsx`): failed turns that originally included uploaded documents now instruct the user to reattach the file instead of retrying with a marker-only replay.
- **Small-model classification** (`small-model-optimizations.test.ts`): `gemma2:2b` remains a compact-model candidate, while `gemma2:9b` is no longer misclassified as small.
- **Electron E2E profile isolation** (`index.ts`, `memory-manager.ts`, `launchElectron.ts`, `persistence-ui.e2e.spec.ts`, `streaming.e2e.spec.ts`): Playwright launches now pass a temp profile via `HOMEBOT_E2E_USER_DATA_DIR`, preventing shared state leaks and avoiding broken Chromium CLI flag handling.

### Changed
- **Widget dev/start scripts** (`widget/package.json`, `widget/scripts/electron-dev.js`): `npm run dev` and `npm start` now clear `ELECTRON_RUN_AS_NODE` before launching Electron so integrated terminals do not boot the app in Node-only mode.
- **First-run and provider polish** (`FirstRunModal.tsx`, `WebServicesPanel.tsx`): Google AI Studio onboarding now defaults to `gemini-2.5-flash`, and web-service descriptions were refreshed for current ChatGPT, Claude, and Gemini branding.
- **Renderer/E2E reliability docs** (`README.md`, `docs/*`, `DEVELOPER_BUILD_GUIDE.md`, `TESTING_MATRIX.md`): canonical documentation now reflects current document routing, retry behavior, model defaults, and launch workflow.

## v1.1.0 — Release readiness, routing hardening, and cloud default safeguards

### Fixed
- **Attachment routing fallback** (`message-router.ts`): document-attached requests now route through the embedded-content-aware preprocessing path, preventing false "couldn't access" responses when document content is present.
- **Coding query cloud gating** (`message-router.ts`, `stream-from-llm.test.ts`): code-oriented prompts no longer jump to a cloud code API just because credentials exist; cloud routing now requires explicit enablement.
- **Settings provider switching safety** (`SettingsPanel.tsx`, `settings-cloud-default.test.tsx`): switching cloud providers now clears stale model state, disables cloud-by-default, and forces a reconnect before activation.
- **Image generation panel parity** (`ipc-handlers.ts`): the automation panel now delegates to the same hardened `image_generate` handler used in chat instead of maintaining a separate backend cascade.

### Changed
- **RAG parity on cloud path** (`message-router.ts`, `InputBox.tsx`): cloud-model requests now receive the same document-context injection path as local routing, and attached documents are opportunistically indexed for later retrieval.
- **Release metadata** (`widget/package.json`): current widget package version is `1.1.0` with the GitHub repository already configured for packaging and updater resolution.

---

## v0.10.0 — Agentic tool loops, morning briefing, hybrid RAG, and provider expansion

### Added — Agentic Tool Loop Engine
- **Multi-step request detection** (`agentic-loop.ts`): new `looksMultiStep()` heuristic detects compound requests using sequence words ("then", "after that"), "first…then" patterns, numbered steps, and multiple action domains.
- **Agentic system prompt injection**: when a multi-step request is detected, an agentic system prompt is injected instructing the LLM to plan and execute tools step-by-step, with a safety cap of 6 agentic rounds.
- **Streaming progress indicators**: during agentic execution, the UI shows per-step progress ("🔄 Step 1: Searching the web…" / "✅ web_search done") so users see what's happening.
- **Full tool access in agentic mode**: bypasses the small-model 12-tool cap so the LLM can chain any of the 85+ tools.
- 13 new unit tests for `looksMultiStep`, `buildAgenticSystemPrompt`, and `formatStepProgress`.

### Added — Proactive Morning Briefing
- **Daily briefing on first interaction** (`morning-briefing.ts`): on the first user message each calendar day, HomeBot proactively generates a weather + calendar + reminders summary using parallel tool calls.
- **Time-aware greeting**: "Good morning" / "Good afternoon" / "Good evening" with formatted date.
- **Opt-out setting**: `settings.morningBriefing = false` disables the briefing.
- **State persistence**: briefing state tracked in `memory/json-store/briefing-state.json` so it survives app restarts.
- 4 new unit tests for `shouldOfferBriefing`, `markBriefingDelivered`, and `generateBriefing`.

### Added — Hybrid RAG (Semantic + Keyword Search)
- **Embedding at index time** (`rag.ts`): chunks now get `nomic-embed-text` 768-dim vector embeddings via Ollama's `/api/embeddings` endpoint, with concurrent batching (4 parallel, 100 chunk cap).
- **Reciprocal Rank Fusion (RRF)**: `rag_query` combines TF-IDF keyword rankings and semantic embedding cosine similarity using RRF (k=60) for best-of-both-worlds retrieval.
- **Graceful fallback**: if Ollama or `nomic-embed-text` is unavailable, TF-IDF still works as before — no breaking changes.
- **Embedding warmup**: `ragSearchWarmup()` pre-computes query embeddings before the synchronous `ragSearch` auto-injection path.
- **Backward compatible**: existing `rag-index.json` files without embeddings load fine; new indexes include embeddings alongside TF-IDF data.

### Added — Cloud Provider Expansion
- **3 new cloud LLM providers** (`custom-llm-client.ts`): Groq (free tier, fast inference), DeepSeek (GPT-4 class at 20x lower cost), Google AI Studio (Gemini models with free tier).
- **Curated model lists with cost hints**: each provider shows model descriptions plus cost hints (e.g. "~$0.27/1M in", "Free tier") in the model picker.
- **Auto-configured API URLs**: `PROVIDER_API_URLS` map auto-fills canonical base URLs for each named provider.
- **Auto-detect provider from model name**: `detectProvider()` now recognises DeepSeek and Gemini model names.

### Added — Hardware Profile Auto-Detection
- **First-run VRAM detection** (`index.ts`): on first launch, auto-detects GPU VRAM via `nvidia-smi` and applies 4 GB / 8 GB / 16 GB+ model profile.
- **Profile-based model defaults** (`config-manager.ts`): `HARDWARE_PROFILE_DEFAULTS` maps each profile to optimal chat/vision/uncensored models.
- **One-time toast notification**: renderer shows a brief toast confirming the detected GPU and applied profile.

### Changed — 5 GB VRAM Model Stack
- **Default chat model**: `llama3.2:3b` → `phi4-mini` (best reasoning in 3-4B range, 2.5 GB).
- **Default vision model**: `llava` (4.7 GB) → `moondream` (1.7 GB) — fits on 4 GB cards.
- **Default uncensored model**: `dolphin-llama3:8b` (4.7 GB) → `dolphin-phi:2.7b` (1.6 GB).
- **MoA presets updated**: balanced preset drops from ~13 GB to ~6.5 GB VRAM.
- **`isSmallModel()` expanded**: now recognises decimal VRAM tags (`:1.5b`, `:2.7b`), moondream, dolphin-phi, gemma2:2b.

### Changed — Follow-Up Routing Improvements
- **Expanded topic-shift detection**: `isNewTopicPhrase` regex now catches imperative phrases (`give me`, `show me`, `describe`, `define`, `search for`, `look up`, `find`) with length-based thresholds.
- **Domain-mismatch guard**: follow-ups >30 chars with zero lexical overlap to the previous tool's domain (NBA, weather, surf) are treated as new topics.
- **Player availability routing**: "is curry playing?" now routes to `web_search` (with player name guard) instead of `nba_query` for injury/lineup data.
- **Greeting detection**: greetings now clear stale intent so the LLM handles them fresh.

### Changed — Calendar Integration
- **Google Calendar ICS support** (`calendar.ts`): private ICS URL parsing with 5-minute cache — no OAuth or Google Cloud project needed.
- **3-tier fallback**: ICS feed → n8n Google Calendar webhook → Outlook COM → local JSON.
- **`CalEvent.source` type**: expanded from `'outlook' | 'local'` to `'outlook' | 'local' | 'google'`.

### Changed — Ollama Health Banner
- **Startup health check** (`index.ts`): pings `/api/tags` on launch and sends status to renderer.
- **Persistent warning toast**: if Ollama isn't running, a non-dismissible warning banner appears with the configured URL.

### Changed — IPC & Export
- **Conversation export**: new `exportConversation` IPC handler supports Markdown and JSON formats.
- **`exportConversationAsJSON`**: added to memory-manager exports.
- **Hardware profile push event**: `homebot:hardware-profile-applied` IPC event for renderer toast.
- **Ollama status push event**: `homebot:ollama-status` IPC event for health banner.

### Tests
- Test count: 1,604 → 1,716 (112 → 115 suites).
- New test files: `agentic-loop.test.ts` (13 tests), `morning-briefing.test.ts` (4 tests).
- Updated: `preprocess.test.ts` (player availability routing), `rag-tools.test.ts` (embedding mock), `moa.test.ts`, `small-model-optimizations.test.ts`, `config-manager.test.ts`.

---

## v0.9.0 — Smart error recovery + hardware-aware MoA

### Fixed — Conversation Context & Streaming Reliability
- **Conversation history on all streaming paths** (`message-router.ts`): assistant responses are now saved to `conversationHistory` on the n8n/`streamFromLLM` path, the proxy path, and the proxy→n8n fallback path — follow-up messages now have full context instead of each question acting like a new conversation.
- **Removed duplicate user-history entries**: three redundant `addToHistory(convId, 'user', …)` calls removed — user message is now recorded exactly once before routing.
- **Tool-call leak guard** (`message-router.ts`): `scheduleFlush()` now checks the unflushed chunk (not just the full buffer) for `tool_call` patterns, preventing raw `tool_call web_search "…"` text from leaking into the chat mid-stream.

### Fixed — Opinion Guard on Tool Routes
- **All tool routes** (`message-router.ts`): opinion, analysis, and conversational follow-up questions (e.g. "what do you think about today's game?") are now detected before tool routing and sent to the LLM instead of being dispatched to external APIs.
- **NBA-specific guard** (`message-router.ts`): questions like "will the Lakers win tonight?" no longer hit the schedule API — they go to the LLM for a reasoned response.
- 18 new unit tests for opinion-guard logic across all tool categories. Test count: 1,604 → 1,622 (112 suites).

### Fixed — TTS Voice Selection
- **Async voice loading** (`voice.ts`): `speechSynthesis.getVoices()` returns `[]` on first call in Chromium; TTS now waits for the `voiceschanged` event before selecting a voice, with a 2-second safety timeout that falls back to the system default.
- **Female voice priority list**: Jenny → Aria → Zira → Google UK Female → Google US → Samantha → Karen → Moira, with English-language fallback chain.

### Added — Smart Error Recovery UX
- **Error classification engine** (`message-router.ts`): new `classifyError()` function categorises stream errors into `ollama` (connection), `model` (not found), `n8n` (upstream), `timeout`, and `unknown` — each with actionable `RecoveryHint`.
- **Rich recovery banners** (`MessageBubble.tsx`): error messages now show service-specific icons (🔌 Ollama, 📦 Model, ⚙️ n8n), user-friendly guidance, and contextual action buttons instead of generic "Error" text.
- **In-chat model pull** (`PullModelButton`): when a model is missing, users can pull it directly from the chat with a single click — wired through `homebot:pull-model` IPC handler.
- **Recovery hints on all stream-error emissions**: ~10 error sites in message-router.ts now attach `recoveryHint` to the `homebot:stream-error` payload.
- 11 new unit tests for `classifyError()`. Test count: 1,593 → 1,604 (111 → 112 suites).

### Added — Hardware-Aware Model Recommendations
- **GPU VRAM detection** (`ipc-handlers.ts`): new `homebot:detect-gpu-vram` IPC handler detects GPU via `nvidia-smi` and reports available VRAM.
- **Recommendation engine** (`moa.ts`): `recommendConfig(vramGB)` returns optimal setup — MoA presets for ≥ 8 GB, single-model + RAG guidance for < 8 GB, with `MOA_MIN_VRAM_GB = 8` threshold.
- **Settings panel integration** (`SettingsPanel.tsx`): GPU detection button above MoA checkbox, VRAM display, recommendation text with one-click Apply.
- 60 new unit tests for recommendation logic and GPU detection. Test count: 1,533 → 1,593.

---

## v0.8.0 — Documentation overhaul

### Documentation
- **Complete documentation rewrite**: all 15+ project documentation files rewritten from scratch with professional formatting, accurate statistics, and comprehensive detail.
- All documentation now reflects current state: 110 test suites / 1,533 tests, 20+ tool handlers, Electron 28 / TypeScript 5.9.3 / electron-vite build system.
- Removed all outdated references to Webpack, incorrect test counts, and stale feature lists.
- New files: standardised tables, diagrams, and cross-references across all documents.

---

## v0.7.10 — Full-season NBA fetch fix

### Fixed
- **Full-season NBA data** (`nba.ts`, `message-router.ts`): "give me all this season's NBA results" previously returned only ~9 games. Three-layered fix:
  - `wantsSeason` regex detects full-season intent.
  - `computeDateRange()` returns `'season'` value for season-wide queries.
  - New `fetchSeasonEvents()` uses ESPN date-range API (`?dates=YYYYMMDD-YYYYMMDD`) to fetch the complete season.
- 10 new unit tests for season detection, date range, and fetch logic. Test count: 1,523 → 1,533.

---

## v0.7.9 — File creation fix + table format fix

### Fixed
- **File creation filename extraction**: LLM-generated filenames are now correctly extracted from tool call arguments, fixing cases where the file was created with a mangled name.
- **NBA table formatting**: queries containing "in a table" now correctly produce Markdown table output instead of plain text. Intent detection updated to recognise table formatting requests.
- 10 new unit tests. Test count: 1,513 → 1,523.

---

## v0.7.8 — Model readiness audit + UX feature batches

### Added — Model Readiness
- **New models in MODEL_METADATA** (`constants.ts`): Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku, GPT-4o Mini — each with correct `maxTokens` and provider mapping.
- **Native token limits**: cloud API calls now use `MODEL_METADATA.maxTokens` instead of hardcoded 2000, enabling full context windows for capable models.
- **Anti-hallucination directive**: synthesis prompt now includes explicit instruction to avoid fabricating information.

### Added — UX Features (8 batches)
- **Analytics dashboard**: usage metrics, response times, tool usage charts with local-only data.
- **Voice polish**: improved Whisper integration, speech recognition race condition fix.
- **Response time indicators**: per-message latency display.
- **Keyboard shortcuts system**: `Ctrl+N` (new conversation), `Ctrl+/` (shortcuts panel), `Ctrl+Shift+F` (focus mode), `Escape` (cancel stream).
- **Toast notification system**: non-blocking notifications with stacking and auto-dismiss.
- **Sidebar filter**: text search and category filtering across conversations.
- **Theme switcher**: dark/light/system toggle with smooth transitions.
- **Conversation pinning**: pin important conversations to the top of the sidebar.
- **Context menus**: right-click menus on conversations and messages.
- **Message timestamps**: relative and absolute time display.
- **Auto-scroll with bookmarks**: smart scroll behaviour and bookmark navigation.
- **Date separators**: visual day boundaries in message list.
- **Conversation archiving**: archive/restore with hidden archive section.
- **JSON export**: export conversations as structured JSON.
- **Message reactions**: emoji picker for per-message reactions.
- **Conversation tags**: tag-based organisation and filtering.
- **Reading time estimates**: word-count-based reading time per message.
- **Message editing**: edit previously sent messages with re-generation.
- **Focus mode**: distraction-free chat (hides sidebar and non-essential UI).
- **Notification preferences**: sound and visual notification toggles.
- **Input character counter**: character count with limit warning.
- **Conversation sort options**: sort by date, name, or pinned status.
- **Message density toggle**: compact and comfortable display modes.
- **i18n foundation**: locale loading framework for future multi-language support.
- **Performance tuning**: log buffer caps, dead code removal.

### Tests
- 160+ new tests across 8 feature batches. Test count: 1,339 → 1,513 (87 → 110 suites).

---

## v0.7.7 — UI polish, documentation refresh, workflow cleanup

### UI Polish
- **Futuristic accent animations** (`chatgpt-theme.css`): 15+ CSS keyframe animations — `headerScan`, `titleShimmer`, `connectedGlow`, `msgSlideIn`, `avatarRingSpin`, `voiceNeonPulse`, `welcomeFloat`, `activeCardGlow`. Glass morphism on settings/modals. `@media (prefers-reduced-motion: reduce)` accessibility guard.
- **User avatar upgrade** (`MessageBubble.tsx`, `chatgpt-theme.css`): replaced plain 👤 with ⚡ icon; gradient background, animated conic-gradient glow ring, bouncy entrance animation, hover scale effect.

### Documentation
- Comprehensive refresh of 9 documentation files: CHANGELOG, README, SUBMISSION_OVERVIEW, TESTING_MATRIX, DEMO_SCRIPT, DEVELOPER_BUILD_GUIDE, ENVIRONMENT_STATUS, FINAL_ARCHITECTURE_DIAGRAM, PROJECT_PLAN — all updated to reflect v0.7.5–v0.7.6+ changes.

### Chores
- Tracked 4 previously untracked n8n tool workflows: `archive-ops.json`, `browser-automation.json`, `file-manager.json`, `memory-manager.json`.
- Fixed UTF-8 BOM in `file-manager-hardened.json` that caused 20 test failures.

---

## v0.7.6 — Tool recursion cap, light theme, global hotkey, auto-update, log buffer caps

### Added
- **Tool recursion cap** (`message-router.ts`): `MAX_TOOL_ROUNDS = 10` constant prevents infinite tool-call loops. `processResponse()` now accepts a `round` parameter; at round ≥ 10 the LLM receives a user-facing warning and halts.
- **Light / dark / system theme** (`chatgpt-theme.css`, `App.tsx`, `types.ts`): full `[data-theme="light"]` CSS overrides + `@media (prefers-color-scheme: light)` for system mode. Theme selector added to settings (`'light' | 'dark' | 'system'`).
- **Global hotkey** (`index.ts`): `Ctrl+Shift+Space` toggles HomeBot's window via `globalShortcut.register()`. Unregistered on `before-quit`.
- **Auto-updater** (`auto-updater.ts`): new module using `electron-updater`. Checks 5 s after startup; sends IPC events `homebot:update-available`, `homebot:update-progress`, `homebot:update-downloaded`. Skipped in E2E/test mode.
- **Log buffer caps** (`index.ts`, `message-router.ts`): both main-process and router log buffers capped at 500 entries via `pushMainLog()` and `pushRouter()` helpers to prevent memory growth.

---

## v0.7.5 — Fix all partial/incomplete features

### Fixed
- **Reminder persistence** (`scheduler.ts`): reminders now survive app restart — saved to and loaded from `userData/memory/json-store/reminders.json`.
- **Browser content extraction** (`web.ts`): `fetch_url` / content extraction no longer silently fails; added retry logic and improved HTML-to-text pipeline.
- **Image generation direct fallback** (`web.ts`): when Pollinations.ai is down, immediately tries Stable Horde instead of returning an error.
- **ESPN stats integration** (`sports.ts`): live NBA stats now pull from ESPN endpoints with proper response parsing.
- **Whisper TODO cleanup**: removed stale TODO comments related to Whisper integration that were already implemented.

---

## v0.7.4 — Security hardening, context budget, dead workflow cleanup

### Security Fixes
- **IPC path traversal** (`ipc-handlers.ts`): `homebot:open-file` and `homebot:show-in-folder` now restrict paths to the user's home directory using `path.resolve()` checks — previously could open/reveal arbitrary files.
- **PID injection** (`process-manager.ts`): `kill_process` now validates PID as a positive integer before passing to `Stop-Process`, preventing PowerShell command injection.
- **Toast XML injection** (`notification.ts`): notification title and body are now XML-entity-encoded (`<`, `>`, `&`, `"`) and PS-sanitised before insertion into toast XML template.
- **Git commit message injection** (`git.ts`): commit messages now use a character whitelist instead of just escaping double-quotes, preventing shell metacharacter injection.
- **Custom LLM SSRF** (`ipc-handlers.ts`): `homebot:list-custom-llm-models` now validates URL protocol (HTTP/HTTPS only) before making requests.
- **Dependency vulnerabilities**: `npm audit fix` applied — 0 production vulnerabilities remaining (dev-only `tar` vuln in electron-builder noted).

### Added
- **Context budget for small models** (`message-router.ts`): `llama3.2:3b` and other ≤3B models now get scaled-down context injection — 12 history turns (vs 50), 500-char digest cap, 300-char memory recall cap — preventing silent context overflow on 4096-token models.
- **Permission defaults** (`config-manager.ts`): added default permission entries for 23 tools routed by `preProcessIntent()` that previously had no defaults, causing silent denials.
- **Context budget unit tests** (`context-budget.test.ts`): tests verifying small models get capped history, digest, and memory recall.

### Fixed
- **Stream URL** (`message-router.ts`): corrected chat stream endpoint from `/webhook/homebot/tools/file-manager/stream` to `/webhook/homebot/chat/stream`.
- **CODING_QUERY_PATTERN** (`message-router.ts`): removed bare words like "function", "class", "api" that false-positived on normal conversation.
- **Speech recognition tmp file** (`ipc-handlers.ts`): temp PS1 file now uses unique filename with random suffix to prevent race conditions.

### Removed
- **Dead n8n tool workflows**: removed 13 vestigial workflow JSONs from `n8n-workflows/tools/` that were never called from HomeBot (all tools execute locally via TypeScript handlers). Kept only the 3 workflows that are actually used: `core/chat-orchestrator.json`, `core/safety-validator.json`, and `tools/image-generate.json`.
- **`tool-allowlist.json`**: annotated as documentation-only (never loaded at runtime).

---

## v0.7.3 — Final polish: streamFromLLM tests, path portability, workflow cleanup

### Added
- **`streamFromLLM` unit tests** (`stream-from-llm.test.ts`): 12 tests covering all three routing paths (Custom LLM, Code API, Ollama default), image-attachment fallback, AbortController cancel, tool-definition passthrough, and edge cases. Test count: 1313 → 1325 across 86 suites.

### Fixed
- **Hardcoded forward-slash paths in workflows**: `patch-workflow-paths.js` now replaces both `C:\…` (JSON-escaped) and `C:/…` (forward-slash) path variants and scans `n8n-workflows/core/` in addition to `tools/`.
- **`validateJson` node replaced** (`file-manager-hardened.json`): swapped `n8n-nodes-base.validateJson` (community node, may not be installed) with an inline Code node that performs the same required-field + type checks.
- **Start-node workflows converted to webhooks**: `api-tool.json` and `archive-ops.json` now use Webhook Trigger → Auth Guard → … instead of the passive `n8n-nodes-base.start` node, making them callable from HomeBot and consistent with all other tool workflows.
- **BOM stripped** from `file-manager-hardened.json` (caused JSON parse failures in schema tests).

---

## v0.7.2 — n8n webhook auth enforcement (workflow side)

### Added
- **Auth Guard injection** (`scripts/inject-auth-guard.js`): programmatic, idempotent script that inserts an Auth Guard Code node between each webhook trigger and its first downstream node in all 15 webhook-based n8n workflow JSONs. Validates `X-HOMEBOT-Auth` header against `HOMEBOT_WEBHOOK_SECRET` env var; skips validation when env var is unset (local dev mode).
- **Reference auth-guard snippet** (`n8n-workflows/_shared/auth-guard.js`): standalone reference for manual n8n Code node use.

### Fixed
- **Dead code removed**: gutted `api-client.ts` (renderer-side unauthenticated direct POST to n8n, never imported anywhere) — replaced with deprecation stub.

---

## v0.7.1 — Security hardening sweep

### Fixed
- **Silent catch blocks killed** (`message-router.ts`): added `safeSend()` helper for resilient IPC sends with console warnings instead of swallowed errors.
- **Preload `invoke()` locked to E2E mode** (`preload/index.ts`): arbitrary IPC invoke from renderer now gated behind `isE2E()` check.
- **React ErrorBoundary** (`ErrorBoundary.tsx`): catches render crashes; wraps `<App />` in `index.tsx`.
- **System prompt unified** (`system-prompt.ts`): marked as single source of truth with sync comment; eliminated dual-source drift risk.
- **Portable workflow paths** (`scripts/patch-workflow-paths.js`): replaces hardcoded `C:\Users\adenk\Desktop\homebot` in n8n JSON files with `HOMEBOT_ROOT` at startup.
- **`webviewTag` disabled** in Electron `webPreferences` (was enabled but unused).

### Added
- **Webhook auth — Electron side** (`webhook-auth.ts`): generates and persists a 256-bit shared secret per install; `homebotWebhookHeaders()` helper attaches `X-HOMEBOT-Auth` header to all n8n POST calls in `message-router.ts` (3 sites) and `ipc-handlers.ts` (2 sites).
- **`docker-compose.yml`**: passes `HOMEBOT_WEBHOOK_SECRET` env var to n8n container.
- **`start-homebot.ps1`**: reads persisted secret and exports as `$env:HOMEBOT_WEBHOOK_SECRET`.
- **Message-router unit tests** (`message-router-coverage.test.ts`): 20 tests covering `clearHistory`, `ensureHydrated`, `setUncensoredMode`/`getUncensoredMode`, `analyzeAndRouteMessage` (7 scenarios), and `isSmallModel` edge cases.

---

## v1.0.4 — Embedded web services, test coverage 1293, context & routing fixes, quality improvements

### Added
- **Embedded web services panel**: access ChatGPT, Claude, and Gemini directly inside HomeBot via subscription — each service opens in a sandboxed `BrowserWindow` with correct Chrome UA, `allowpopups`, and a pre-injected preload that clears `navigator.webdriver` before page scripts run, defeating Cloudflare bot-detection.
- **Conversation full-text search**: search across all conversation history with incremental results as you type.
- **Per-conversation Markdown export**: export any conversation to a clean `.md` file from the sidebar.
- **Test suite 522 → 1293** (+771 tests across 15 batches): system-tools, custom-llm-client, scheduler, enrichment, document-tools, calendar-tools, voice-tools, ActionConfirmation, TelemetryConsentModal, stream-proxy-client, FirstRunModal, imageUtils, window-manager, TelemetryDashboard, ImageGenerator, ModelSelector, AutomationCenter, ToolsPanel, ConversationSidebar, RagPanel, PermissionModal, NBA utils, logger, contacts, system-prompt, sports-report, TokenCounter, memory-manager, code-runner, shared logger, mcp-client, env, scheduler, NBA HTTP paths, vision edge-cases, filesystem, process-manager.

### Fixed
- **Context hydration on startup** (`App.tsx`): startup boot loaded messages to the UI but never called `setActiveConversation`, so `ensureHydrated` never ran and the LLM had empty `conversationHistory` after every app restart. Fixed by calling `setActiveConversation` in the startup `useEffect`.
- **Cloud model routing** (`message-router.ts`):
  - MCP memory recall/memorize now runs in the cloud LLM path (previously only ran for Ollama).
  - Code API path now builds `codeSystemPrompt` from the configured code model instead of the chat model.
  - Title generation (`ipc-handlers.ts`) now respects `settings.chatModel` instead of being hardcoded to `llama3.2:3b`.
  - Duplicate coding-query regex consolidated into a single `CODING_QUERY_PATTERN` constant.
- **Cloudflare bot-detection bypass**: web service panels inject a preload to clear `navigator.webdriver`; correct `Chrome/` User-Agent set per session partition.
- **Webview auth**: permission request handler added; `did-attach-webview` sets UA and enables popup windows; login pages no longer silently fail.

### Improved
- **Digest compression** (`compressTurns`): strips search result blocks, code blocks, and image placeholders, then extracts the first sentence (topic/intent) and last sentence (conclusion/answer) instead of blindly truncating at 200 chars. Rolling context window now carries meaningful summaries.
- **Search context unification**: `formatWebSearchResult` now delegates to `buildSearchContext` (4000-char budget), removing ~60 lines of duplicate source-formatting code.
- **File manager workflow hardening**: added `file-manager-hardened.json` with full n8n safety pipeline (Validate Input → Security Check → Guard Error → Execute PowerShell → IF exitCode → Format Output → Envelope → Schema Validate → Respond to Webhook), `-LiteralPath` usage, file size guard, and confirmation guard.
- **Workflow validator**: added `validate-workflow.ps1` in repo root for static n8n JSON checks (unique v4 UUIDs, required nodes, connection integrity, schema type, error path reachability, FILE_SIZE_LIMIT guard, start-time capture).
- **RAG relevance filter** (`rag_query`): chunks scoring below `MIN_RELEVANCE_SCORE = 0.05` are filtered out. When all chunks fall below the threshold, the single best result is returned with a `low_confidence: true` flag rather than silently returning noise.

---

## v1.0.3 — NBA intent guard + YouTube music links

### Fixed
- **NBA intent guard**: tightened sport-query detection to eliminate false positives where non-sports messages were incorrectly routed to the NBA/sports handler.
- **YouTube music links**: corrected link construction for YouTube music search results.

---

## v1.0.2 — Auto-generate conversation titles

### Added
- **Automatic conversation titles**: after the first exchange HomeBot generates a short descriptive title for the conversation using the configured chat model. Titles appear immediately in the sidebar without requiring manual rename.

---

## v1.0.1 — Code quality hardening and conversation coherence fix

### Fixed
- **Conversation coherence bug** (`App.tsx`): first message in every new conversation used stale `conversationId` React state instead of freshly created `activeConvId`, silently scattering context across disconnected IDs. All turns in a conversation now share the correct `conversation_id`.
- **`tsc --noEmit` clean**: resolved 9 TypeScript compiler errors not surfaced by VS Code's language server:
  - `ipc-handlers.ts`: 5 `ToolHandler` call sites missing required second `context` argument (`rag_index`, `rag_list`, `rag_clear`, `tts-speak`, `tts-stop`)
  - `tool-helpers.ts`: `closer` variable declared but unused — now correctly used in depth tracking instead of hardcoded `}`/`]` chars
  - `types.ts` (`ElectronAPI`): 8 members missing from the interface (`readTelemetryEvents`, `showInFolder`, `openFile`, `mcpListServers`, `mcpGetStatus`, `mcpAddServer`, `mcpRemoveServer`, `mcpToggleServer`)
- **Inline styles eliminated** across `InputBox`, `MessageBubble`, `StatusIndicator`, `Header`, `ImageGenerator`, `TokenCounter`, `TelemetryDashboard`, `TitleBar`, `ToolsPanel`, `git.ts` — moved to CSS classes for linter compliance.
- **`TokenCounter.tsx`**: replaced JSX `style` prop with `ref + useEffect` to set CSS custom properties, removing the inline-style lint warning.
- **`ChatInterface.tsx`**: removed dead `result` capture that spammed `Promise { <pending> }` to the console on every sent message.

### Added
- **Regression test** (`persistence-send.test.tsx`): asserts `sendStreamMessage` always uses `activeConvId`, not the stale `'default'` fallback. Test count: 521 → 522.
- **`tsconfig` hardening**: `noUnusedParameters`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` enabled; `browserslist` added for CSS compat targeting.
- **`-webkit-user-select` prefix** on `.token-counter` CSS for full cross-engine coverage.
- **`aria-label="Edit conversation title"`** on the rename button in `ConversationSidebar`.
- **Category union extensions** in `types.ts`: `'communication'` and `'vision'` added to the tool category union.

## v1.0.0 — Vision: image analysis & in-chat image thumbnails

### Added
- **`vision_describe` tool**: HomeBot can now read a local image file and describe its contents in detail (colours, objects, text, layout) using the configured Ollama multimodal model (`llava` by default).
- **`vision_query` tool**: ask any specific question about a local image — extract text from a screenshot, count objects, identify colours, etc. Sends the image as base64 to Ollama `/api/generate`.
- **Image thumbnails in user message bubble**: when a user attaches image(s) and sends a message, the image previews now render inline in the user's chat bubble (max 220 × 160 px, rounded corners).
- **`ChatMessage.images`** field on the renderer type — stores preview URLs (objectURL / dataURL) alongside the message so thumbnails survive re-renders.
- **16 unit tests** (`__tests__/vision-tools.test.ts`): covers home-dir guard, missing file, directory path, unsupported extension, Ollama success, Ollama error, multi-chunk NDJSON streaming, prompt passthrough, and tool definition shape.

## v0.9.9 — RAG drag-and-drop UI

### Added
- **RAG index button (📎)** in the chat input toolbar: click to pick any file (PDF, Word, code, text) and index it into the RAG engine. Shows a live "⏳ indexing…" spinner on the button while work is in progress, then a green "✅ Indexed …" status banner (auto-dismisses after 6 s).
- **Drag-and-drop to RAG**: files dropped onto the input area that aren't images or chat-attachable documents are automatically forwarded to `rag_index` so users can drag a `.ts`, `.py`, `.log`, or similar file straight onto the chat window.
- **`homebot:rag-index` IPC channel**: direct bridge from renderer → main process `ragToolHandlers.rag_index` so the UI never needs to go through the full message router.
- **`ElectronAPI.ragIndex`** type and preload exposure so the call is fully typed and sandbox-safe.

## v0.9.8 — RAG: local document semantic search

### Added
- **`rag_index` tool**: indexes any local file (PDF, Word, plain text, code, CSV, Markdown) into overlapping 200-word chunks stored in `userData/memory/rag-index.json`. Index persists between sessions.
- **`rag_query` tool**: TF-IDF cosine similarity search across all indexed documents (or one specific doc via `doc_id`). Returns top-k most relevant excerpts ranked by relevance score. Works offline, no model download.
- **`rag_list` tool**: lists all indexed documents and their chunk counts.
- **`rag_clear` tool**: removes a specific document from the index.
- **31 unit tests** (`__tests__/rag-tools.test.ts`) covering chunking, tokenisation, cosine similarity, all four handlers, home-dir access guard, re-index deduplication, and edge cases.

## v0.9.7 — NBA NZ/AU timezone tests + installer + docs sync

### Added
- **NBA NZ/AU timezone edge-case tests** (`__tests__/nba-nz-timezone.test.ts`): 5 tests covering the `wantsResults` previous-day fallback — fires when today's games are all pre-game, skips when `wantsResults=false`, falls back gracefully when yesterday also has no finished games or network fails, and does not fire when live games are in progress.
- **Windows NSIS installer** (`dist-electron/HomeBot Setup 0.9.6.exe`, 148 MB): `npm run dist` now correctly passes `--config ../electron-builder.yml`; per-user install, custom directory chooser, desktop + start menu shortcuts.

### Fixed
- `widget/package.json` and root `package.json` version bumped to `0.9.6` (were `0.8.1`).
- ASSESSOR_SUMMARY test counts synced to 463/463.

## v0.9.6 — isSmallModel tests + phi regex fix

### Added
- **`isSmallModel` / `getSystemPromptForModel` unit tests** (`__tests__/model-prompt-selection.test.ts`): 36 cases covering small/large model classification, compact vs full prompt selection, and guidelines injection.

### Fixed
- **Latent regex bug in `isSmallModel`**: `phi[- ]?[123]` matched the family prefix regardless of downstream size tag, so `phi3:14b` was incorrectly treated as small. Pattern updated to `phi[- ]?[0-9]?[- ]?mini` so only explicit mini variants qualify; `:3b` size-tag rule still catches `phi3:3b`.

## v0.9.5 — Model-aware prompts and memory path fix

### Fixed
- **Memory path hardcoding** (`tools/memory.ts`): JSON fallback stores (`memories.json`, `conversation-history.json`) were written to `~/Desktop/homebot/memory/json-store` unconditionally. Now uses the same dev/prod split as `memory-manager.ts`: dev → project root `memory/json-store`; packaged → Electron `userData` folder. Uses lazy `require('electron')` (with `catch` fallback) so Jest tests continue to work without the Electron binary.

### Added
- **Model-aware system prompt** (`shared/system-prompt.ts`, `message-router.ts`): `HOMEBOT_SYSTEM_PROMPT_COMPACT` (~400 tokens) added alongside the full ~1500-token prompt. `isSmallModel()` detects <=3B models by name pattern (`:1b`, `:3b`, `phi-3`, `gemma:2b`, `tinyllama`, etc.). `getSystemPromptForModel()` selects the appropriate variant and appends user guidelines. Both `streamFromLLM` and `streamFromOllamaWithTools` now use it, giving `llama3.2:3b` ~1100 extra tokens of usable context per turn.

---

## v0.9.4 — Image UX polish and Pollinations availability cache

### Fixed
- **Progress line persists after image arrives**: `MessageBubble.tsx` now strips any line starting with `⏳ Generating image` from the text segment before the `__HOMEBOT_IMAGE__:` token, so the finished message shows only the image (and any real caption text).

### Changed
- **Pollinations.ai availability cache** (`web.ts`): After any HTTP failure from Pollinations.ai, the result is cached for 5 minutes (`POLLINATIONS_BACKOFF_MS`). Subsequent `image_generate` calls skip the HTTPS round-trip entirely and go straight to Stable Horde. The cache clears on success so the service is transparently retried when it recovers.

---

## v0.9.3 — Image generation: Stable Horde backend, API key, progress indicator

### Fixed
- **`image_generate` permission denied**: `image_generate` was missing from `DEFAULT_SETTINGS.permissions`, causing `assertPermission` to return `false` and `executeToolBatch` to short-circuit with a permission-denied result. The stale `'n8n webhook not reachable'` default was shown because the result shape had a `.reason` field (not `.error`). Fixed both by adding `image_generate: true` to defaults and checking `r?.reason` alongside `r?.error` in the error extraction.
- **Wrong image MIME type**: `MessageBubble.tsx` hardcoded `data:image/png;base64,…` for all generated images. Stable Horde returns WebP. Fixed with magic-bytes detection (`UklGR` → `image/webp`, `/9j/` → `image/jpeg`, else `image/png`).

### Added
- **Stable Horde backend** (`web.ts`): `tryStableHorde()` submits a job to the free community-powered Stable Horde network, polls `/check/{id}` every 6 s until done, then fetches the base64 image from `/status/{id}`. Wired into `imageGenerateHandler` after Pollinations.ai in the fallback cascade.
- **Stable Horde API key setting** (`SettingsPanel.tsx`, `types.ts`, `ipc-handlers.ts`, `web.ts`): New "Image Generation" settings section with a password field for the Stable Horde API key. Without a key the anonymous queue (~60-120 s) is used; a free registered key drops generation time to ~10-20 s.
- **Image generation progress indicator** (`message-router.ts`): Sends `⏳ Generating image, please wait…` as a stream chunk immediately after the `image_generate` intent is detected, before the `executeToolBatch` call, so the UI doesn't appear frozen during Stable Horde generation.

### Changed
- **Conversation / system-prompt test fixes**: `conversationSystemPrompt` added to `handleSendMessage` `useCallback` deps (stale closure fix); `getMemoryStorePath` dev path corrected from 4 to 3 levels up; `persistence-ui.e2e.spec.ts` waits 1 s after new-chat click to let async IPC settle.
- **Test count**: 422/422 unit tests (up from 418), 12/12 E2E tests.

---

## v0.9.2 — n8n workflow activation: all 16 workflows live

### Fixed
- **All 16 n8n workflows now activate on startup**: Replaced `n8n-nodes-base.start` (ignored by
  `checkIfWorkflowCanBeActivated`) with `n8n-nodes-base.webhook` (typeVersion 1.1) as the trigger
  node in all 10 tool workflows.
- **Switch node schema mismatch** (`memory-manager`, `vision-tool`): Upgraded `n8n-nodes-base.switch`
  typeVersion 1 → 3 in both `workflow_entity` and `workflow_history`. The v1 schema's
  `getNodeParameters` threw "Could not find property option" for v3-format parameters stored in the
  DB, preventing the Workflow constructor from completing.
- **WorkflowHistoryService crash**: Added `N8N_WORKFLOW_HISTORY_ENABLED=false` to `docker-compose.yml`
  to prevent the history service from crashing on startup.

### Changed
- All 10 tool workflow source JSONs in `n8n-workflows/tools/` updated to match the working DB state
  (webhook triggers, correct Switch typeVersion).

---

## v0.9.1 — Phase 6 hardening: search refactor, docs, UX polish

### Changed
- **`web_search` provider registry** (`web.ts`): replaced the 4-branch ad-hoc cascade with a
  typed `SearchProvider` interface + `SEARCH_PROVIDERS` registry (Tavily → Serper → DDG Instant →
  DuckDuckGo → Google → Brave). Single `for` loop replaces ~80 lines of duplicated `if` blocks.
- **`isE2E` isolation fix** (`env.ts`): removed `NODE_ENV === 'test'` from the `isE2E` constant.
  The flag now only activates when `HOMEBOT_E2E=1|true` is explicitly set (all Playwright specs
  already do this). Unit tests no longer see `isE2E=true`, so the n8n probe fires correctly →
  418/418 unit tests now pass (was 417/418 pre-existing failure).
- **Permission toggles** (`SettingsPanel.tsx`): dangerous tools (`delete_file`, `move_file`,
  `launch_app`, `screenshot`) now show a ⚠ amber icon inline in the label and render their
  description text in amber. Tooltip (`title` attr) gives hover / screen-reader context.
- **Telemetry label** (`SettingsPanel.tsx`): updated from "required, anonymous" → "anonymous,
  opt-in". A privacy hint is added below: clarifies events are stored locally only, nothing
  leaves the device, and consent can be reviewed/revoked in the Telemetry Consent Log.

### Added
- **`docs/api-reference.md`**: full reference for the IPC channel surface (~50 channels), all
  tool schemas (filesystem, web, system, memory, voice, sports/NBA, documents) with parameter
  tables and return shapes, the permission system (persistent settings, confirmation-gated tools,
  allow-once / always-allow, batch fail-fast), safety rules / path restrictions, and all shared
  TypeScript types.

### Fixed
- **E2E streaming suite** (12/12 pass): n8n probe guard, hydration race, async write-queue dedup,
  auto-title clobber, write-through cache, and inline conversation prompt — all stabilised in the
  preceding session (committed `1728ba0`).

---

## v0.9.0 — Search, Planning & API Tools

### Added
- **`search_files` tool**: Find files and folders on the local filesystem by name pattern. Uses Everything Search (`es.exe`) when available for instant results, falls back to PowerShell `Get-ChildItem -Recurse`. Supports wildcards (`*.pdf`, `report*`). Searches within the user home directory tree; path-traversal is blocked.
- **`plan_task` tool**: Break a complex goal into a numbered list of ordered steps and save the plan locally (`~/homebot-plans.json`). Call this when the user asks to "make a plan" or "what steps do I need to…". Plans survive across sessions.
- **`get_plans` tool**: Retrieve recently saved plans by ID, goal, and step count.
- **`api_request` tool**: Make HTTPS GET or POST requests to an approved allowlist of public API hosts (weather, finance, sports, GitHub, etc.). Full SSRF protection — private IPs, loopback, `.local`/`.internal` domains, non-https URLs, and non-allowlisted hosts are all blocked. The allowlist can be extended via `config/api-allowlist.json`.
- **42 new tests** covering all three tools (50 total suites / 418 tests).

### Changed
- Intent routing in `preProcessIntent` extended with patterns for file-search queries, planning requests, and plan-list queries.
- Result formatting extended with rendering for search hits (🔍), saved plans (📋), plan lists, and API responses (🌐).

---

## v0.8.1 — Synthesis Cloud Routing & Voice Button Fix

### Added
- **Synthesis cloud routing**: Web-search synthesis (web queries, surf reports, news fallback) now routes through the configured cloud LLM (`useCustomLLM` + `customLLM` settings) when active. Falls back to local Ollama when no cloud LLM is configured.

### Fixed
- **Voice mic button now always visible in Electron**: The microphone button was previously hidden because it only checked `window.SpeechRecognition` (absent in Electron's renderer). It now also checks for `electron.startSpeechRecognition` (Windows SAPI), so the button appears in all Electron builds.

### No-op
- Scheduler UI for reminders/tasks was already fully wired in v0.8.0 — no changes required.

---

## v0.8.0 — Word Documents, Code Cloud API & UI Polish

### Added
- **`create_docx` tool**: HomeBot can now generate real Microsoft Word (`.docx`) files using the `docx` package. Supports `# Heading`, `## Subheading`, `### Sub-subheading`, paragraphs, and an optional document title. Files go anywhere under the home directory. Requires confirmation before writing.
- **Code cloud API routing**: Settings panel now has a "Code model — Cloud API" section. Set a provider (OpenAI / Anthropic / OpenRouter / Custom), an API key, and an optional base URL. Coding queries are automatically routed to the cloud model instead of Ollama when the key is present.
- **`qwen2.5-coder:3b` added to model picker** with "Best for your GPU" label and set as the default code model.
- **Uncensored mode amber border**: The input box gets an amber glow when uncensored mode is active (cross-component sync via `CustomEvent` bus — no prop-drilling).
- **Sidebar timestamps & message count badges**: Conversation list shows granular relative times ("just now", "5m ago", "Yesterday", weekday) and a pill badge with the message count.
- **Image thumbnail strip**: Attached images render as 72×72 cover thumbnails with an overlay × button (no filename clutter beneath).

### Fixed
- `write_file` / `codeApiKey` fields now correctly trimmed/cleaned in `handleSave` — previously the spread could leave stale values on save.
- Unused `AxiosError` and `OpenAITool` imports removed from `custom-llm-client.ts`.
- Missing `os` import added to `ipc-handlers.ts` (prevented `os.homedir()` call in telemetry path from compiling).
- Undefined `message` reference in `message-router.ts` image-caption line fixed to `request.message`.

### Removed
- Root-level temp/debug artefacts: `tmp_chat.json`, `tmp_tool_call.json`, `tmp_database.sqlite`, `execution.log.jsonl`, `run-*.json`, `tmp/`, `widget/tmp/` — none were referenced by any build step.

---

## v0.7.1 — IPC hardening, stream diagnostics & telemetry dashboard

### Added
- Local telemetry events log (`telemetry-events.log`) and an in-app **Telemetry Dashboard** (Settings → Telemetry) showing recent events and stream-failure counts. ✅
- `stream-metrics` helper script to summarize local telemetry events (`npm run stream-metrics`).

### Fixed
- Prevent crashes from duplicate `ipcMain.handle` registrations during dev/hot-reload cycles by making handler registration idempotent.
- Improved `homebot:stream-error` payloads with richer diagnostics (url, httpStatus, n8nResponded, errorText) and recorded local telemetry events for stream failures.

---

## v0.7.0 — UI Polish, Markdown Rendering & Developer Cleanup

### Added
- **Retry button** wired up: error-state assistant messages now have a functional "↻ Retry" button that re-sends the preceding user message.
- **Copy full response** button: finished assistant messages show a "📋 Copy" button that copies the entire response to clipboard with visual feedback.
- **Auto-title conversations**: the first user message automatically sets the conversation title (truncated to 40 characters) instead of "New Conversation".
- **Custom markdown renderer** in MessageBubble: fenced code blocks with copy button, inline code, bold, italic, links, headings, lists — zero external dependencies.
- **`homebot:get-env` IPC handler**: new IPC channel for retrieving environment info from the main process.

### Fixed
- **Vite dev server loading**: `window-manager.ts` now correctly loads from `ELECTRON_RENDERER_URL` in dev mode, enabling HMR and live code changes.
- **Duplicate CSS removed**: deleted ~55 lines of conflicting message-bubble overrides in `chatgpt-theme.css` that silently shrank bubbles, stripped borders/shadows, and broke text colors.

### Removed
- Dead code cleanup: removed `_appendAssistantIfMissing`, `_handleHomeBotReply`, `_cancelStream` (~100 lines) and all `@ts-expect-error` suppressions from `App.tsx`.

## v0.6.1 — Tool Routing Hardening and NBA Query Robustness

### Improved
- Tool routing hardening for more reliable intent-to-tool matching.
- NBA query robustness with better sports data handling.
- Serper.dev search integration (working) alongside Tavily (key-dependent).
- Search API keys UI in Settings panel.
- Web search upgraded: Tavily → Serper → DDG → Google → Brave fallback chain.
- System prompt updated for code generation support.

## v0.6.0 — Permissions & Batch Execution

### Added
- Atomic tool batch execution with preflight permission checks.
- Permission escalation flow with **Allow once** and **Always allow** options.
- Tool-level `requiredPermissions` and execution-scoped `overrideAllowed` support.

### Improved
- Prevented partial side effects when a batch contains disallowed tools.
- Standardized path resolution across Electron, Jest, and CI via `resolveUserPath`.

### Testing
- Added CI smoke coverage for permission-allowed batch execution.
- Stabilized Playwright E2E permission flow tests.
