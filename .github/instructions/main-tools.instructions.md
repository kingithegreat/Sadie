---
applyTo: "widget/src/main/tools/**"
---

# Adding or changing a model-facing tool

## Every tool needs a permission entry

`__tests__/tool-permissions-parity.test.ts` is the gate: every native tool needs
either a permission entry or `requiresConfirmation`, and every permission key
needs a tool. It exists because `navigate_to_mode` shipped with neither and
executed via `assertPermission`'s `!requiresConfirmation` default.

Adding a tool means touching `main/config-manager.ts` defaults and the
user-facing copy in `renderer/components/settings/useSettingsState.tsx` in the
same change. The parity test will tell you if you missed one — run it.

## Reuse the boundary utils

Path and URL confinement live in `main/utils/home-boundary.ts` and
`main/utils/url-boundary.ts`. Use them. Five hand-rolled `startsWith` guards had
already drifted apart before they were replaced, and a sixth is how the next
escape ships. Do not re-derive "is this path safe" locally.

## Shell out via argv, never a shell string

`grep_code` and the git tools run through `execFile` with an argv array. That is
what removed the `cmd.exe` injection surface in `file_pattern` and the commit
path. Keep it.

## Ask what reaches it

The defect this codebase produces is **unreachable capability**: code that
exists, is exported, is unit-tested, and that no production path ever calls.
`getLastAnthropicUsage` was exported "for Diagnostics" and never wired to
Diagnostics; `git_commit` was missing from the bridge allowlist; category routing
was disabled by a cap set below the core-tool count. Every gate was green for all
three.

A unit test calls your function directly and cannot tell whether anything else
does. Before finishing, trace outward until you land on something a person can
click, type or say. `npm run audit:dead` sweeps for the shape (advisory, not a
gate).

## Credentials are not yours

Never enter an API key, create an account, or rotate a token — flag it and stop.
Never bypass the privacy kill-switch (`useCustomLLM` / `allowCloud`); it fails
closed by design.
