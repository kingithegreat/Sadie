# SADIE Testing Matrix

Comprehensive test suite inventory covering unit tests, E2E tests, and integration validation.

---

## Testing Overview

| Metric | Value |
|---|---|
| **Unit Test Suites** | 120 |
| **Individual Unit Tests** | 1,872 |
| **E2E Scenarios** | 12+ (Playwright) |
| **Test Framework** | Jest (unit), Playwright (E2E) |
| **Zero Tolerance** | All tests must pass on every commit |

---

## Test Infrastructure

| Component | Technology | Purpose |
|---|---|---|
| **Unit Testing** | Jest + ts-jest | TypeScript-native unit tests |
| **E2E Testing** | Playwright | Full Electron app automation |
| **Mocking** | jest.mock, jest.fn | Dependency isolation |
| **Test Isolation** | Unique `SADIE_E2E_USER_DATA_DIR` per E2E run | No cross-test contamination |
| **Coverage** | Jest --coverage | Branch and line coverage |

### Running Tests

```bash
cd widget

# All unit tests
npx jest --config jest.config.ts --no-coverage

# With coverage report
npx jest --config jest.config.ts --coverage

# Specific file
npx jest --config jest.config.ts vision-tools --no-coverage

# Watch mode
npx jest --config jest.config.ts --watch

# E2E tests
npm run e2e

# E2E with Playwright UI
npx playwright test --ui
```

---

## Unit Test Suites — Main Process

### Core Routing and LLM

| Test File | Purpose | Key Assertions |
|---|---|---|
| `message-router-helpers.test.ts` | Message routing helper functions | Correct tool selection, `looksLikeToolJson` |
| `message-router-coverage.test.ts` | clearHistory, ensureHydrated, uncensored mode | 20 tests across 7 routing scenarios |
| `message-router-stream-failure.test.ts` | Stream failure handling | Error recovery, telemetry events |
| `stream-from-llm.test.ts` | Custom LLM, Code API, Ollama routing | 12 tests, image fallback, abort, tool passthrough |
| `model-prompt-selection.test.ts` | isSmallModel / getSystemPromptForModel | 36 cases, small/large model classification |
| `context-budget.test.ts` | Context budget caps for small models | Capped history, digest, memory recall limits |
| `small-model-optimizations.test.ts` | Optimisations for 3B–8B models | Token budget enforcement |
| `system-prompt.test.ts` | Prompt generation for different models | Compact vs full prompt variants |
| `system-prompt-authority.test.ts` | System prompt integrity | Prompt not tampered in transit |
| `preprocess.test.ts` | Message preprocessing | Input sanitisation |
| `routing-gating.test.ts` | Intent-to-tool routing gates | Correct gating logic |
| `enrichment.test.ts` | Message enrichment pipeline | Context injection |
| `synthesis-guard.test.ts` | Synthesis output safety | No data leakage |
| `synthesis-prompt.test.ts` | Synthesis prompt generation | Correct formatting and anti-hallucination |
| `env.test.ts` | Environment detection | isE2E, isRelease flags |
| `custom-llm-client.test.ts` | Cloud LLM client routing | API key management, provider selection |

### Tool System

| Test File | Purpose | Key Assertions |
|---|---|---|
| `tool-definitions.test.ts` | Tool definition shape validation | Schema compliance |
| `new-tool-definitions.test.ts` | New tool definition registration | API structure verification |
| `tools-batch.test.ts` | Atomic batch execution with permission preflight | Partial side-effect prevention |
| `tools-alias.test.ts` | Tool alias resolution | Correct alias mapping |
| `tool-helpers-extract.test.ts` | Tool helper extraction utilities | Argument parsing |
| `permissions-smoke.test.ts` | Permission-allowed batch execution | CI smoke coverage |
| `permission-requester.test.ts` | Permission request flow | Escalation logic |
| `skills-loader.test.ts` | Skills loader system | Dynamic skill loading |

### Tool Handlers

| Test File | Purpose | Key Assertions |
|---|---|---|
| `filesystem.test.ts` | File system operations | Path validation, CRUD, traversal protection |
| `search-tool.test.ts` | File search tool | Pattern matching |
| `api-tool.test.ts` | API request tool | SSRF protection, allowlist enforcement |
| `browser-tool.test.ts` | Browser content extraction | URL validation, content parsing |
| `calendar-tools.test.ts` | Calendar event CRUD | Event creation, listing, deletion |
| `clipboard-tool.test.ts` | Clipboard read/write | Content transfer |
| `code-runner-tool.test.ts` | Code execution sandbox | Output capture, timeout enforcement |
| `contacts-tool.test.ts` | Contacts management | CRUD operations |
| `diff-tool.test.ts` | Text diff comparison | Unified diff output |
| `document-tools.test.ts` | Document processing | PDF, Word, text extraction |
| `email-tool.test.ts` | Email tool handlers | Send/read validation |
| `git-tool.test.ts` | Git operations | Commit, status, message sanitisation |
| `image-generate-tool.test.ts` | Image generation | Pollinations/Horde fallback chain |
| `news-tool.test.ts` | News feed parsing | RSS extraction |
| `notification-tool.test.ts` | Toast notifications | XML sanitisation (CVE-safe) |
| `planning-tool.test.ts` | Planning agent | Task breakdown, persistence |
| `process-manager-tool.test.ts` | Process management | PID validation, kill safety |
| `rag-tools.test.ts` | RAG index/query/list/clear | 31 tests, chunking, TF-IDF scoring |
| `reminder-tool.test.ts` | Reminder CRUD | Persistence, trigger timing |
| `system-tools.test.ts` | System info (disk, memory, network) | Platform detection |
| `vision-tools.test.ts` | Vision describe/query | 16 tests, home-dir guard |
| `voice-tools.test.ts` | Voice/TTS handlers | Start/stop, format validation |
| `web-fallback.test.ts` | Web search fallback chain | Provider cascade ordering |

### Sports Intelligence

| Test File | Purpose | Key Assertions |
|---|---|---|
| `sports.test.ts` | Sports tool routing | Correct API handler selection |
| `nba.test.ts` | NBA data parsing and formatting | Score/standings rendering, table output |
| `nba-fallback.test.ts` | NBA fallback when API fails | Graceful degradation |
| `nba-http.test.ts` | NBA HTTP path validation | Correct ESPN endpoint routing |
| `nba-nz-timezone.test.ts` | NZ/AU timezone edge cases | Previous-day fallback logic |
| `runtime-nba-smoke.test.ts` | NBA query end-to-end smoke | Data parsing verification |

### Infrastructure

| Test File | Purpose | Key Assertions |
|---|---|---|
| `config-manager.test.ts` | Settings persistence, path resolution | Data integrity, graceful degradation |
| `ipc-registration.test.ts` | IPC handler registration | Channel security, idempotency |
| `ipc-handle-patch.test.ts` | IPC handle duplicate prevention | No double-registration |
| `logger.test.ts` | Logging system | File output, rotation, buffer caps |
| `memory-manager.test.ts` | Memory persistence layer | Store/retrieve/search |
| `memory-tools.test.ts` | Memory tool handlers | JSON store operations |
| `memory-manager.system-prompt.test.ts` | Memory-aware prompts | Context injection |
| `scheduler.test.ts` | Scheduler/reminders | Persistence, cron triggers |
| `mcp-client.test.ts` | MCP server client | Connection management, tool discovery |
| `n8n.integration.test.ts` | n8n integration | Workflow execution, document payload expansion before forwarding |
| `n8n-workflow-schema.test.ts` | n8n workflow validation | Schema compliance |
| `persistence.integration.test.ts` | Persistence integration | Cross-session data integrity |
| `stream-proxy-client.test.ts` (main) | Stream proxy client | Connection, chunk handling |
| `window-manager.test.ts` | Window management | Create, show, hide lifecycle |
| `json-export.test.ts` | JSON export functionality | Conversation export format |

---

## Unit Test Suites — Renderer

| Test File | Purpose | Key Assertions |
|---|---|---|
| `cancel-flow.test.tsx` | Cancel button during streaming | UI state transitions, unsubscribe on unmount |
| `stream-chunks.test.tsx` | Message grows chunk-by-chunk | Content accumulation, cancel button removal |
| `stream-end-error.test.tsx` | Stream end/error states | Copy button on finish, Retry on error |
| `stream-cancel-confirmation.test.tsx` | Cancel confirmation flow | State machine transitions |
| `markdown-renderer.test.tsx` | Markdown rendering (code, bold, links, lists) | Correct DOM output, copy button |
| `copy-response.test.tsx` | Copy full response button | Clipboard API, visual feedback |
| `retry-flow.test.tsx` | Retry on error re-sends message or requests reattach | Stream re-subscription, content reset, document reattach guard |
| `first-run-modal.test.tsx` | Onboarding modal | Display, dismissal, persistence |
| `action-confirmation.test.tsx` | Dangerous action confirmation dialog | Allow/deny, permission escalation |
| `permission-modal.test.tsx` | Permission modal flow | Allow-once / always-allow |
| `model-selector.test.tsx` | Model dropdown selection | Model list, default selection |
| `image-generator.test.tsx` | Image generation UI | Progress indicator, display |
| `image-utils.test.ts` | Image utility functions | MIME detection, base64 |
| `conversation-sidebar.test.tsx` | Sidebar conversations list | Timestamps, badges, rename |
| `conversation-pinning.test.tsx` | Conversation pinning | Pin/unpin, sort order |
| `conversation-archiving.test.tsx` | Conversation archiving | Archive/restore lifecycle |
| `conversation-tags.test.tsx` | Conversation tagging | Tag CRUD, filtering |
| `conversation-sort.test.tsx` | Conversation sort options | Multiple sort criteria |
| `context-menu.test.tsx` | Right-click context menus | Menu rendering, action dispatch |
| `date-separators.test.tsx` | Date separator rendering | Day boundaries |
| `focus-mode.test.tsx` | Focus mode toggle | UI element visibility |
| `input-char-counter.test.tsx` | Input character counter | Count display, limit warning |
| `message-editing.test.tsx` | Message editing | Edit/save/cancel |
| `message-density.test.tsx` | Message density toggle | Compact/comfortable layouts |
| `message-reactions-readtime.test.tsx` | Reactions and reading time | Emoji picker, time estimates |
| `message-timestamps-bookmarks.test.tsx` | Timestamps and bookmarks | Relative time, bookmark toggle |
| `message-list-scroll-bookmarks.test.tsx` | Auto-scroll and bookmark list | Scroll behaviour, bookmark navigation |
| `notification-preferences.test.tsx` | Notification preferences | Sound/visual toggles |
| `rag-panel.test.tsx` | RAG panel UI | Index button, drag-drop |
| `response-time.test.tsx` | Response time display | Latency indicator |
| `sidebar-filter.test.tsx` | Sidebar filter/search | Text matching, category filter |
| `shortcuts-panel.test.tsx` | Keyboard shortcuts panel | Shortcut listing, key display |
| `theme-switcher.test.tsx` | Theme switcher | Dark/light/system toggle |
| `toast-container.test.tsx` | Toast notification container | Show/dismiss, stacking |
| `telemetry-consent-modal.test.tsx` | Telemetry consent modal | Opt-in/out persistence |
| `telemetry-dashboard.test.tsx` | Analytics dashboard | Event counts, metrics display |
| `token-counter.test.tsx` | Token counter component | Token display |
| `tools-panel.test.tsx` | Tools panel listing | Tool availability display |
| `automation-center.test.tsx` | Automation center UI | Workflow listing |
| `persistence-send.test.tsx` | Send uses correct conversation ID and preserves first-send attachments | No stale ID bugs, document payload included on first stream request |
| `stream-proxy-client.test.ts` (renderer) | Stream proxy client | Connection handling |

---

## Unit Test Suites — Shared

| Test File | Purpose | Key Assertions |
|---|---|---|
| `system-prompt.test.ts` | Shared system prompt utilities | Prompt formatting |
| `logger.test.ts` | Shared logging utilities | Log level, formatting |

---

## Unit Test Suites — Other

| Test File | Purpose | Key Assertions |
|---|---|---|
| `i18n.test.tsx` | Internationalisation foundation | Locale loading, key resolution, fallback |

---

## SSE Proxy Tests

| Test File | Purpose | Key Assertions |
|---|---|---|
| `admin.test.ts` | Admin endpoints | Access control |
| `auth.test.ts` | Authentication | Token validation |
| `cancel-stream.test.ts` | Stream cancellation | Cleanup |
| `encryption.test.ts` | Data encryption | Security |
| `rate-limit.test.ts` | Rate limiting | Throttle enforcement |
| `stream-integration.test.ts` | End-to-end streaming | Full pipeline |
| `ws.test.ts` | WebSocket connections | Protocol handling |

---

## E2E Tests (Playwright)

| Test File | Purpose | Runtime |
|---|---|---|
| `first-run.e2e.spec.ts` | Onboarding flow | ~10s |
| `streaming.e2e.spec.ts` | Real-time streaming responses | ~15s |
| `permission-flow.e2e.spec.ts` | Permission escalation flow | ~12s |
| `document-summary.e2e.spec.ts` | Document upload and summarisation | ~10s |
| `persistence-ui.e2e.spec.ts` | Settings persistence across restart | ~12s |
| `conversation-sidebar.e2e.spec.ts` | Conversation management | ~10s |
| `mode-switching.e2e.spec.ts` | Mode switching (normal/uncensored) | ~10s |
| `status-and-theme.e2e.spec.ts` | Status indicators and theme switching | ~10s |
| `settings-panel.e2e.spec.ts` | Settings panel interactions | ~10s |
| `system-prompt.e2e.spec.ts` | System prompt customisation | ~10s |

### E2E Test Prerequisites

- Ollama must be running with test models pulled.
- `SADIE_E2E=true` environment variable must be set.
- Each test uses an isolated temp profile via `SADIE_E2E_USER_DATA_DIR`.
- Video recording captures failures automatically.

---

## Test Categories by Security Concern

| Security Area | Test Files |
|---|---|
| **SSRF Protection** | `api-tool.test.ts` |
| **Path Traversal** | `filesystem.test.ts` |
| **XSS / Output Safety** | `synthesis-guard.test.ts`, `notification-tool.test.ts` |
| **Permission Escalation** | `permission-requester.test.ts`, `permissions-smoke.test.ts` |
| **Prompt Injection** | `system-prompt-authority.test.ts`, `preprocess.test.ts` |
| **PID Injection** | `process-manager-tool.test.ts` |
| **Git Message Injection** | `git-tool.test.ts` |
| **IPC Security** | `ipc-registration.test.ts`, `ipc-handle-patch.test.ts` |
| **Input Sanitisation** | `preprocess.test.ts`, `routing-gating.test.ts` |

---

## Debugging Failed Tests

### Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| `Test timeout of 5000ms exceeded` | Slow machine or unresolved promise | Increase timeout or check async code |
| `Cannot find module` | Missing dependency or wrong path | `npm install` or check import path |
| `ENOENT` in filesystem tests | Missing test fixtures | Create required fixture files |
| `E2E hangs on launch` | Ollama not running | Start Ollama: `ollama serve` |
| `Multiple configurations` | Wrong jest invocation | Always use `--config jest.config.ts` |

### Test Isolation

- Unit tests mock all external dependencies (Ollama, filesystem, network).
- E2E tests use isolated `userData` directories per run.
- No test modifies shared state or production config files.
- `SADIE_E2E=true` gates all test-only code paths.
