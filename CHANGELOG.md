# Changelog

## Unreleased

- Atomic batch execution: tool batch precheck now verifies all required permissions before executing any tool, preventing partial side effects when some operations would be denied.
- Permission escalation: user-facing confirmation flow supports `Allow once` (transient) and `Always allow` (persisted) with safe re-execution semantics.
- Safety improvement: batch execution fails fast with `needs_confirmation` when permissions are missing, avoiding any tool-side partial effects.
