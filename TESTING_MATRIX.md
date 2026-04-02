# SADIE Testing Matrix

This document outlines SADIE's comprehensive testing strategy, including unit tests, E2E tests, and validation procedures.

## Testing Overview

SADIE employs a multi-layer testing approach:
- **Unit Tests**: 87 Jest suites / 1339 tests covering main process, renderer, tools, and shared utilities
- **E2E Tests**: 12+ Playwright scenarios for full application workflows
- **Integration Tests**: Component interaction validation
- **Security Tests**: Runtime hardening verification

## Test Infrastructure

### Test Frameworks
- **Jest**: Unit testing framework
- **Playwright**: E2E testing with browser automation
- **Electron Test Runner**: Main process testing

### Test Isolation
- Playwright uses isolated userData directories
- Environment variables control test modes
- Mock services for external dependencies

## Unit Tests

### Test Categories

#### Main Process Tests (`src/main/__tests__/`)

| Test File | Purpose | Key Assertions |
|-----------|---------|----------------|
| `config-manager.test.ts` | Settings persistence, path resolution, error recovery | Data integrity, cross-platform paths, graceful degradation |
| `ipc-registration.test.ts` | IPC handler registration, idempotency | Channel security, environment info |
| `message-router-helpers.test.ts` | Message routing helper functions | Correct tool selection |
| `message-router-coverage.test.ts` | clearHistory, ensureHydrated, uncensored mode, routing | 20 tests across 7 routing scenarios |
| `message-router-stream-failure.test.ts` | Stream failure handling | Error recovery, telemetry events |
| `stream-from-llm.test.ts` | Custom LLM, Code API, Ollama routing | 12 tests, image fallback, abort, tool passthrough |
| `permissions-smoke.test.ts` | Permission-allowed batch execution | CI smoke coverage |
| `tools-batch.test.ts` | Atomic batch execution with permission preflight | Partial side-effect prevention |
| `tools-alias.test.ts` | Tool alias resolution | Correct tool mapping |
| `tool-definitions.test.ts` | Tool definition shape validation | Schema compliance |
| `tool-helpers-extract.test.ts` | Tool helper extraction utilities | Correct parsing |
| `new-tool-definitions.test.ts` | New tool definition registration | API compliance |
| `system-prompt-authority.test.ts` | System prompt integrity | Prompt not tampered |
| `system-prompt.test.ts` | Prompt generation for different models | Compact vs full prompt |
| `model-prompt-selection.test.ts` | isSmallModel / getSystemPromptForModel | 36 cases, small/large classification |
| `context-budget.test.ts` | Context budget caps for small models | Capped history, digest, memory recall |
| `sports.test.ts` | Sports data tool routing | Correct API handling |
| `runtime-nba-smoke.test.ts` | NBA query end-to-end smoke | Data parsing |
| `nba.test.ts` | NBA data parsing and formatting | Score/standings rendering |
| `nba-fallback.test.ts` | NBA fallback when API fails | Graceful degradation |
| `nba-http.test.ts` | NBA HTTP path validation | Correct endpoint routing |
| `nba-nz-timezone.test.ts` | NZ/AU timezone edge cases | Previous-day fallback |
| `preprocess.test.ts` | Message preprocessing | Input sanitization |
| `routing-gating.test.ts` | Intent-to-tool routing gates | Correct gating logic |
| `synthesis-guard.test.ts` | Synthesis output safety | No leakage |
| `synthesis-prompt.test.ts` | Synthesis prompt generation | Correct formatting |
| `enrichment.test.ts` | Message enrichment pipeline | Context injection |
| `env.test.ts` | Environment detection | isE2E, isRelease flags |
| `logger.test.ts` | Logging system | File output, rotation |
| `filesystem.test.ts` | File system tool handlers | Path validation, CRUD |
| `process-manager-tool.test.ts` | Process management | PID validation, kill |
| `search-tool.test.ts` | File search tool | Pattern matching |
| `api-tool.test.ts` | API request tool | SSRF protection, allowlist |
| `planning-tool.test.ts` | Planning agent | Task breakdown, persistence |
| `memory-manager.test.ts` | Memory persistence | Store/retrieve/search |
| `memory-tools.test.ts` | Memory tool handlers | JSON store operations |
| `memory-manager.system-prompt.test.ts` | Memory-aware prompts | Context injection |
| `custom-llm-client.test.ts` | Cloud LLM client | API key routing |
| `mcp-client.test.ts` | MCP server client | Connection, tools |
| `scheduler.test.ts` | Scheduler/reminders | Persistence, triggers |
| `reminder-tool.test.ts` | Reminder tool handlers | CRUD operations |
| `vision-tools.test.ts` | Vision describe/query | 16 tests, home-dir guard |
| `rag-tools.test.ts` | RAG index/query/list/clear | 31 tests, chunking, TF-IDF |
| `voice-tools.test.ts` | Voice/TTS tool handlers | Start/stop, format |
| `document-tools.test.ts` | Document processing | PDF, Word, text |
| `email-tool.test.ts` | Email tool handlers | Send/read validation |
| `calendar-tools.test.ts` | Calendar tool handlers | Event CRUD |
| `contacts-tool.test.ts` | Contacts tool handlers | Contact management |
| `browser-tool.test.ts` | Browser automation | Content extraction |
| `clipboard-tool.test.ts` | Clipboard tool | Read/write |
| `code-runner-tool.test.ts` | Code execution tool | Sandbox, output |
| `diff-tool.test.ts` | Diff tool | Text comparison |
| `git-tool.test.ts` | Git tool | Commit, status |
| `news-tool.test.ts` | News tool | Feed parsing |
| `notification-tool.test.ts` | Notification tool | Toast XML safety |
| `image-generate-tool.test.ts` | Image generation | Pollinations/Horde fallback |
| `system-tools.test.ts` | System info tools | Disk, memory, network |
| `web-fallback.test.ts` | Web search fallback chain | Provider cascade |
| `window-manager.test.ts` | Window management | Create, show, hide |
| `ipc-handle-patch.test.ts` | IPC handle idempotency | Duplicate prevention |
| `n8n.integration.test.ts` | n8n integration | Workflow execution |
| `n8n-workflow-schema.test.ts` | n8n workflow validation | Schema compliance |
| `permission-requester.test.ts` | Permission request flow | Escalation logic |
| `persistence.integration.test.ts` | Persistence integration | Cross-session data |
| `stream-proxy-client.test.ts` | Stream proxy | Connection, chunks |

#### Renderer Tests (`src/renderer/__tests__/`)

| Test File | Purpose | Key Assertions |
|-----------|---------|----------------|
| `cancel-flow.test.tsx` | Cancel button calls `cancelStream`, shows Cancelled badge | UI state transitions, unsubscribe on unmount |
| `stream-chunks.test.tsx` | Message grows chunk-by-chunk, finalizes on stream end | Content accumulation, cancel button removed |
| `stream-end-error.test.tsx` | `onStreamEnd` marks finished, `onStreamError` marks error | Copy button on finish, Retry on error |
| `stream-cancel-confirmation.test.tsx` | Cancel during streaming, confirmation flow | State transitions |
| `markdown-renderer.test.tsx` | Code blocks, inline code, bold, italic, links, headings, lists | Correct DOM output, copy button |
| `copy-response.test.tsx` | Copy full response button in message footer | Clipboard API, visual feedback |
| `retry-flow.test.tsx` | Retry button on error state re-sends message | Stream re-subscription, content reset |
| `first-run-modal.test.tsx` | First-run onboarding modal | Display, dismissal, persistence |
| `action-confirmation.test.tsx` | Dangerous action confirmation dialog | Allow/deny, permission escalation |
| `permission-modal.test.tsx` | Permission modal flow | Allow-once / always-allow |
| `model-selector.test.tsx` | Model dropdown selection | Model list, default selection |
| `image-generator.test.tsx` | Image generation UI | Progress indicator, display |
| `image-utils.test.ts` | Image utility functions | MIME detection, base64 |
| `conversation-sidebar.test.tsx` | Sidebar conversations list | Timestamps, badges, rename |
| `rag-panel.test.tsx` | RAG panel UI | Index button, drag-drop |
| `telemetry-consent-modal.test.tsx` | Telemetry consent modal | Opt-in/out |
| `telemetry-dashboard.test.tsx` | Telemetry dashboard display | Event counts, metrics |
| `token-counter.test.tsx` | Token counter component | Token display |
| `tools-panel.test.tsx` | Tools panel UI | Tool listing |
| `automation-center.test.tsx` | Automation center UI | Workflow display |
| `persistence-send.test.tsx` | Send uses correct conversation ID | No stale ID |
| `stream-proxy-client.test.ts` | Stream proxy client | Connection handling |

#### SSE Proxy Tests (`tools/sse-proxy/src/__tests__/`)

| Test File | Purpose | Key Assertions |
|-----------|---------|----------------|
| `admin.test.ts` | Admin endpoints | Access control |
| `auth.test.ts` | Authentication | Token validation |
| `cancel-stream.test.ts` | Stream cancellation | Cleanup |
| `encryption.test.ts` | Data encryption | Security |
| `rate-limit.test.ts` | Rate limiting | Throttle enforcement |
| `stream-integration.test.ts` | End-to-end streaming | Full pipeline |
| `ws.test.ts` | WebSocket connections | Protocol handling |

### Running Unit Tests

```bash
# Run all unit tests
npm test

# Run specific test file
npm test -- env.test.js

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## E2E Tests

SADIE's E2E test suite validates complete user workflows using Playwright.

### Test Environment Setup

E2E tests require:
- `SADIE_E2E=true` environment variable
- Ollama running with test models
- Isolated userData directory per test

### Test Suite Overview

| Test File | Purpose | Runtime |
|-----------|---------|---------|
| `src/renderer/e2e/first-run.e2e.spec.ts` | Validate onboarding flow | ~10s |
| `src/renderer/e2e/streaming.e2e.spec.ts` | Test real-time streaming responses | ~15s |
| `src/renderer/e2e/permission-flow.e2e.spec.ts` | Permission escalation flow | ~12s |
| `src/renderer/e2e/document-summary.e2e.spec.ts` | Document upload and summarization | ~10s |
| `src/renderer/e2e/persistence-ui.e2e.spec.ts` | Settings persistence across restart | ~12s |
| `src/renderer/e2e/vision.e2e.spec.ts` | Vision tool integration | ~10s |
| `src/renderer/e2e/web-services.e2e.spec.ts` | Embedded web panel | ~12s |
| `src/renderer/e2e/rag.e2e.spec.ts` | RAG indexing and search | ~10s |
| **Total** | **12+ scenarios** | **~100s+** |

### Detailed Test Specifications

#### First Run Modal Test
**File:** `src/renderer/e2e/first-run.e2e.spec.ts`
**Purpose:** Ensure new users see proper onboarding
**Steps:**
1. Launch app with clean userData
2. Verify modal appears
3. Accept terms and conditions
4. Verify modal disappears
5. Confirm settings are saved

**Validation:**
- Modal triggers on first launch
- Terms acceptance works
- Config persistence
- No duplicate modals

#### Streaming Chat Test
**File:** `src/renderer/e2e/streaming.e2e.spec.ts`
**Purpose:** Validate real-time AI interactions
**Steps:**
1. Send chat message
2. Verify streaming response starts
3. Monitor response chunks
4. Confirm complete response
5. Test interruption handling

**Validation:**
- Ollama integration works
- Streaming protocol correct
- Error handling for connection issues
- Response formatting

#### Permission Flow Test
**File:** `src/renderer/e2e/permission-flow.e2e.spec.ts`
**Purpose:** Validate permission escalation flow
**Steps:**
1. Simulate Ollama disconnection
2. Send message during outage
3. Verify error message display
4. Restore connection
5. Confirm recovery

**Validation:**
- Error UI appears correctly
- No app crashes
- Recovery after service restoration
- User feedback clarity

#### Document Summary Test
**File:** `src/renderer/e2e/document-summary.e2e.spec.ts`
**Purpose:** Ensure document upload and summarization works
**Steps:**
1. Launch app
2. Modify settings (theme, model)
3. Restart application
4. Verify settings retained
5. Test invalid config handling

**Validation:**
- Settings save to disk
- Cross-session persistence
- Default value fallbacks
- Config file integrity

### Running E2E Tests

```bash
# Run all E2E tests
npm run e2e

# Run specific test
npx playwright test first-run-modal.spec.js

# Run with UI mode (debug)
npx playwright test --ui

# Generate traces for debugging
npx playwright test --trace on

# Run in headed mode
npx playwright test --headed
```

### Test Isolation Strategy

#### Playwright Configuration
- Each test uses unique userData directory
- Browser context isolation
- Video recording for failures
- Screenshot capture on errors

#### Mock Services
- Message router provides test doubles
- Streaming mocks for offline testing
- Config mocks for persistence testing

#### Environment Control
- `SADIE_E2E=true` enables test hooks
- `NODE_ENV=test` for test-specific behavior
- Isolated Ollama instances (future)

## Integration Tests

### Component Integration
- IPC communication between main/renderer
- Config manager with IPC handlers
- Web tools with network layer
- AI integration with local models

### Running Integration Tests
```bash
# Run integration suite
npm run test:integration
```

## Security Validation Tests

### Gating Logic Tests
- Verify test code excluded from production
- Confirm diagnostic logs gated
- Validate environment sanitization

### Network Security Tests
- URL validator against SSRF attempts
- Private network blocking
- Timeout and rate limiting

### Running Security Tests
```bash
# Security test suite
npm run test:security
```

## Test Coverage

### Coverage Goals
- **Unit Tests:** 87 suites / 1339 tests (80%+ code coverage)
- **E2E Tests:** 12+ user workflow scenarios
- **Security:** All attack vectors tested (SSRF, path traversal, injection)

### Coverage Report
```bash
npm run test:coverage
# Generates HTML report in coverage/
```

## CI/CD Integration

### Automated Testing
GitHub Actions runs:
1. Unit tests on every PR
2. E2E tests on main branch
3. Security scans pre-release
4. Coverage reporting

### Test Results
- JUnit XML for CI integration
- Playwright HTML reports
- Coverage badges
- Failure notifications

## Debugging Failed Tests

### Common Issues

#### E2E Timeout
```
Test timeout of 5000ms exceeded
```
**Solutions:**
- Check Ollama is running
- Verify `SADIE_E2E=true`
- Review trace screenshots
- Increase timeout for slow systems

#### Modal Not Appearing
```
expect(modal).toBeVisible() failed
```
**Solutions:**
- Clear userData directory
- Check first-run logic
- Verify config persistence

#### Streaming Fails
```
Response timeout
```
**Solutions:**
- Check Ollama model loaded
- Verify network connectivity
- Review mock fallbacks

### Debug Tools

```bash
# Run with debug logging
DEBUG=* npm run e2e

# Playwright debug mode
npx playwright test --debug

# Inspect app during test
npx playwright test --headed --slowMo 1000
```

## Test Maintenance

### Adding New Tests
1. Create test file in `src/renderer/e2e/` (E2E) or `src/main/__tests__/` / `src/renderer/__tests__/` (unit)
2. Follow existing patterns
3. Add to CI configuration
4. Update this matrix

### Test Data Management
- Use factories for test data
- Mock external services
- Clean up after tests
- Avoid hardcoded values

## Performance Benchmarks

### Test Execution Times
- Unit tests: < 30 seconds
- E2E tests: < 2 minutes
- Full suite: < 5 minutes

### Resource Requirements
- 2GB RAM minimum
- Ollama with 1GB model
- Fast storage for traces