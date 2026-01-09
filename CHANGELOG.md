# Changelog

## v0.7.0 — Test Suite Maturity & Multi-Provider Validation

### Added
- **Comprehensive Test Suite**: 224 passing tests with 100% pass rate
  - Provider tests for all LLM backends (OpenAI, Anthropic, Google, Ollama)
  - E2E test suite with deterministic app readiness
  - Pre-processor and response-formatter test coverage
  - Component and integration tests
- **CI/CD Automation**: Full GitHub Actions workflow with artifact retention
  - Playwright traces, videos, and reports on failures
  - Branch protection with E2E regression gate
  - Multi-platform testing (Linux, Windows, macOS)
- **E2E Readiness System**: Deterministic app initialization for reliable automation
  - `waitForAppReady` helper with DOM and hydration checks
  - App readiness signals (`data-testid`, global flags)
  - Stable test selectors throughout UI
- **Test Infrastructure**: Jest configuration and mocking improvements
  - Asset import mocks for images and styles
  - Test discovery fixes and flakiness resolution
  - 139 new tests added this release

### Improved
- **Architecture**: Extracted focused modules for better maintainability
  - `src/main/routing/pre-processor.ts` - Intent detection & routing
  - `src/main/routing/response-formatter.ts` - Result formatting
- **Quality**: Fixed 2 null-handling bugs and resolved test flakiness
- **Developer Experience**: Enhanced CI debugging with full artifact retention

### Fixed
- Jest asset import errors in renderer tests
- Test discovery issues with empty test files
- E2E timing flakiness with app readiness
- Response formatter strict equality checks

### Testing
- **Unit Tests**: 224 passing (0 failures)
- **E2E Tests**: Stable execution (~1.8s)
- **Provider Tests**: All backends validated with streaming
- **CI Coverage**: Automated regression testing on all PRs

## Unreleased

- Atomic batch execution: tool batch precheck now verifies all required permissions before executing any tool, preventing partial side effects when some operations would be denied.
- Permission escalation: user-facing confirmation flow supports `Allow once` (transient) and `Always allow` (persisted) with safe re-execution semantics.
- Safety improvement: batch execution fails fast with `needs_confirmation` when permissions are missing, avoiding any tool-side partial effects.

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
