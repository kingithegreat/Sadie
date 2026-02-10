# SADIE Testing Matrix

This document outlines SADIE's comprehensive testing strategy, including unit tests, E2E tests, and validation procedures.

## Testing Overview

SADIE employs a multi-layer testing approach:
- **Unit Tests**: Individual component validation
- **E2E Tests**: Full application workflow testing
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
| `ipc-registration.test.ts` | IPC handler registration, idempotency, `sadie:check-connection`, `sadie:get-env` | Channel security, environment info |
| `message-router-helpers.test.ts` | Message routing helper functions | Correct tool selection |
| `permissions-smoke.test.ts` | Permission-allowed batch execution | CI smoke coverage |
| `tools-batch.test.ts` | Atomic batch execution with permission preflight | Partial side-effect prevention |
| `tools-alias.test.ts` | Tool alias resolution | Correct tool mapping |
| `system-prompt-authority.test.ts` | System prompt integrity | Prompt not tampered |
| `sports.test.ts` | Sports data tool routing | Correct API handling |
| `runtime-nba-smoke.test.ts` | NBA query end-to-end smoke | Data parsing |
| `routing-gating.test.ts` | Intent-to-tool routing gates | Correct gating logic |
| `preprocess.test.ts` | Message preprocessing | Input sanitization |

#### Renderer Tests (`src/renderer/__tests__/`)

| Test File | Purpose | Key Assertions |
|-----------|---------|----------------|
| `cancel-flow.test.tsx` | Cancel button calls `cancelStream`, shows Cancelled badge, unmount cleanup | UI state transitions, unsubscribe on unmount |
| `stream-chunks.test.tsx` | Message grows chunk-by-chunk, finalizes on stream end | Content accumulation, cancel button removed on finish, Copy button appears |
| `stream-end-error.test.tsx` | `onStreamEnd` marks finished, `onStreamError` marks error and stops updates | Copy button on finish, Retry button on error, no further chunk updates after error |
| `stream-cancel-confirmation.test.tsx` | Cancel during streaming, confirmation flow | State transitions |
| `markdown-renderer.test.tsx` | Fenced code blocks, inline code, bold, italic, links, headings, lists | Correct DOM output, code block copy button |
| `copy-response.test.tsx` | Copy full response button in message footer | Clipboard API called, visual feedback |
| `retry-flow.test.tsx` | Retry button on error state re-sends message | Stream re-subscription, content reset |

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
| **Total** | **4 tests** | **~47s** |

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
- **Unit Tests:** 80%+ code coverage
- **E2E Tests:** 100% user workflows
- **Security:** All attack vectors tested

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