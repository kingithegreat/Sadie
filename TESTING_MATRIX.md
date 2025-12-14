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

#### Environment Detection (`env.test.js`)
| Test | Purpose | Validation |
|------|---------|------------|
| Runtime mode detection | Verify NODE_ENV parsing | Correct mode identification |
| E2E flag detection | Check SADIE_E2E variable | Proper test mode gating |
| Packaged build detection | Validate app.isPackaged | Release vs dev detection |
| Environment sanitization | Test sanitizeEnvForPackaged | Variable removal in production |

#### Configuration Management (`config-manager.test.js`)
| Test | Purpose | Validation |
|------|---------|------------|
| Settings persistence | Save/load config files | Data integrity |
| Path resolution | UserData directory handling | Cross-platform paths |
| Error handling | Invalid config recovery | Graceful degradation |
| Diagnostic logging | Release gating | Log suppression in prod |

#### IPC Handlers (`ipc-handlers.test.js`)
| Test | Purpose | Validation |
|------|---------|------------|
| Message validation | Input sanitization | Security boundaries |
| Config operations | IPC channel security | Permission model |
| Error responses | Exception handling | User feedback |

#### Web Tools (`web.test.js`)
| Test | Purpose | Validation |
|------|---------|------------|
| URL safety validation | SSRF prevention | Network security |
| HTML parsing | Content extraction | Data processing |
| Cache functionality | Performance optimization | Memory management |
| Search engine integration | External API handling | Reliability |

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

| Test File | Tests | Purpose | Runtime |
|-----------|-------|---------|---------|
| `first-run-modal.spec.js` | 1 test | Validate onboarding flow | ~10s |
| `streaming-chat.spec.js` | 1 test | Test real-time responses | ~15s |
| `upstream-error-handling.spec.js` | 1 test | Error recovery validation | ~8s |
| `config-persistence.spec.js` | 1 test | Settings durability | ~12s |
| **Total** | **4 tests** | **Complete workflow coverage** | **~45s** |

### Detailed Test Specifications

#### First Run Modal Test
**File:** `e2e/first-run-modal.spec.js`
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
**File:** `e2e/streaming-chat.spec.js`
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

#### Upstream Error Handling Test
**File:** `e2e/upstream-error-handling.spec.js`
**Purpose:** Test graceful failure modes
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

#### Config Persistence Test
**File:** `e2e/config-persistence.spec.js`
**Purpose:** Ensure settings survive app restarts
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
1. Create test file in `e2e/` or `src/__tests__/`
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