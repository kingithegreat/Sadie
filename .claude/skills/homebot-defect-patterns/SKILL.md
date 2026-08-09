---
name: homebot-defect-patterns
description: Repo-specific defect patterns for HomeBot/SADIE that pass every automated check and only fail in a built, running app — dead IPC channels, relative require() in the bundled main process, silent config fallbacks, duplicated boolean gates, and unmounted UI. Use when adding an IPC channel, a settings-driven feature, a renderer panel, or anything routed between local and cloud models; and when asked why something "works in tests but not in the app".
---

# HomeBot defect patterns

Five failure shapes found in this codebase, all of which pass `tsc`, pass Jest,
build green, and still do nothing in the real app. Each is recorded because it
already shipped at least once — three of them shipped twice.

They share one root cause: **the automated checks verify the pieces, not the
wiring between them.** A test imports a module directly; a bundler resolves an
import that a runtime `require` will not; a renderer hydrates a value the main
process never sees. Nothing is red, and the feature is dead.

## Before you finish any change here, ask

1. **Can a human reach this?** Trace from a click to the code. If no path
   exists, it does not ship.
2. **Does the built bundle behave like the source?** Especially for the main
   process, which is bundled into one file.
3. **If this silently falls back, does anyone find out?**
4. **Is this decision already computed somewhere else?**

---

## 1. Relative `require()` never survives bundling

**Shape.** `electron-vite` bundles the whole main process into one
`out/main/index.js`. A static `import` is inlined by rollup. A runtime
`require('./thing')` is emitted verbatim, and at runtime there is no `./thing`
beside the bundle — `MODULE_NOT_FOUND`.

**Why nothing catches it.** `tsc` resolves the path. Unit tests import the
module directly. The build emits no warning. It fails only in a built app.

**How it presented.** Four instances shipped, three of them *silently* because
the `require` sat inside a `try/catch` that fell back to a default:

| Site | Symptom |
|---|---|
| `index.ts` | Morning briefing threw on every launch — listed as "Shipped", had never run |
| `permission-requester.ts` | Prompt timeout pinned to 60 s, silently disabling a configurable setting |
| `tools/vision.ts` | User's `visionModel` and `ollamaUrl` ignored |
| `tools/system.ts` | `open_in_browser` threw outright |

`tools/vision.ts` is the tell: it *already* imported from the same module
statically two lines above. The lazy `require` bought nothing and broke
everything.

**Rule.** Never use a relative `require()` in `widget/src/main/`. Node builtins
(`require('fs')`, `require('electron')`) are fine — they resolve at runtime.
Guarded by `widget/src/main/__tests__/bundle-integrity.test.ts`; if you think
you need an exception, you are re-introducing this bug.

---

## 2. Capability with no surface

**Shape.** Working, tested code that nothing can reach.

**Instances.** CRM had 20 tools and zero UI. Batch preview was fully
implemented with no call sites. `homebot:assistant-tool-activity` was emitted
from main with no preload whitelist entry and no listener. The terminal panel
was mounted behind a header that widget mode hides with
`display: none !important`.

**Rule.** When auditing "is X done", **grep for callers, not implementations.**
A new IPC channel is not done until it exists in *all four* places:

```
main: ipcMain.handle / webContents.send
  → preload: ALLOWED_CHANNELS entry
    → preload: bridge method
      → renderer: a component that calls it
```

If you cannot finish the chain, delete the orphan half or leave the control
hidden — never ship a dead button. `TerminalPanel`'s "Send to chat" is
deliberately hidden for exactly this reason.

---

## 3. Silent fallback hides misconfiguration

**Shape.** A feature is configured but unusable, so the code quietly does
something else. No error, no log the user reads, wrong behaviour forever.

**Instance.** Cloud chat: `useCustomLLM` was true with a Gemini model selected,
but the API key lived in the `geminiApiKey` vault while the router read
`customLLM.apiKey`. The gate evaluated false and every message went to local
qwen. The code's own comment read `// Silently fall back to Ollama`.

**Rule.** Distinguish *inactive by choice* from *intended but broken*. Only the
first is silent. If the user turned something on and it cannot run, say so on
the surface they are looking at — `resolveCloudLLM()` returns a
`misconfiguration` string precisely so callers cannot swallow it.

---

## 4. The same decision, computed in many places

**Shape.** One boolean expression copied across files, drifting apart.

**Instance.** "Is cloud chat active?" existed as **eleven** hand-rolled
expressions across `message-router.ts` and `ipc-handlers.ts`, with subtly
different logic — and none did the key hydration the renderer did. Same class:
the "direct path" logged `Cloud LLM active` then called a **local-only**
wrapper, so cloud requests ran on the local model with no badge and no error.

**Rule.** A routing decision gets exactly one function. When you find a copy,
replace all of them and delete any helper whose name invites misuse — the
local-only `streamFromOllama` wrapper was removed with a tombstone comment,
because leaving it next to cloud call sites is how the bug returns.

---

## 5. Renderer-only hydration (split brain)

**Shape.** The renderer massages a value for display; the main process reads
the raw one. The UI shows a configured feature that the backend considers
unset.

**Instance.** `SettingsPanel` filled `customLLM.apiKey` from the per-provider
key vault when rendering. The router never did. Settings displayed Gemini as
connected while routing ignored it.

**Rule.** Normalisation belongs in a **pure module under `widget/src/shared/`**
that both processes import (`cloud-llm.ts` is the worked example). If you write
a fallback in a component, ask what the main process sees.

---

## Verification standard

`tsc` + Jest + a green build is the floor, not proof.

- **Run the app** for anything user-facing, and read the startup log. Today's
  most valuable finding — a "Shipped" feature that had never executed — came
  from launching it once, not from any test.
- **Honesty A/B**: reintroduce the bug and confirm the new test fails, then
  restore it. A test that cannot fail proves nothing.
- **Prove the symptom is gone in the artefact that ships** — grep
  `out/main/index.js`, not just the source.
- **Test against real state** where it exists. The routing fix was verified by
  running the resolver against the user's actual `user-settings.json`.
- **Label the verification level**, and say plainly when something has not been
  seen by a human.

## Sandbox conventions

Human-facing surfaces reuse the guards written for the model-facing tools —
never a second copy:

- Path sandbox: `validatePath` from `tools/filesystem.ts` (Explorer, editor).
- Destructive commands: `isDestructiveCommand` from `tools/terminal.ts`.
- Permission gate: `executeTool()` — `assertPermission` + `requestConfirmation`.

One deliberate divergence, documented at the call site: the natural-language
heuristic that stops the *model* posting prose into a shell is **not** applied
to human terminal input, because it would reject `where python` and `help`.

External agents (Claude Code) get HomeBot's tools over the loopback MCP bridge
rather than their own — measured: in `-p` mode Claude Code runs its native
tools with `permission_denials: 0`, i.e. no approval step exists.
