# Changelog

## v0.7.0 — External Models & Pre-Processing

### Added
- **External Model Support**: Use OpenAI, Anthropic (Claude), or Google (Gemini) APIs instead of local Ollama
  - Per-provider API key configuration in Settings
  - Model selector dropdown for each provider
  - Automatic tool integration for all providers
- **Pre-Processing Pipeline**: Deterministic tool routing bypasses LLM for known patterns
  - NBA queries (50+ team names recognized)
  - Weather queries with location extraction
  - Time/date queries
  - Calculator expressions
  - System info queries
  - File operations (read, list directory)
  - Clipboard queries
  - Web search fallback
- **Tool Picker UI**: Manual tool selection for users who want explicit control

### Improved
- NBA query formatting: Direct result formatting with real team names from ESPN API
- Settings panel: Cleaner UI with provider-specific help links
- Thinking indicator: Changed to "✨ Thinking..." animation

### Fixed
- Tool prefix `[USE TOOL: ...]` now hidden from chat display
- Word-breaking CSS for long messages
- Debug messages removed from production builds

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
