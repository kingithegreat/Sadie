# Changelog

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
